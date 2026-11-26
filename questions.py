import hashlib
import html
import json
import logging
import os
import random
import re
import time
import unicodedata
from collections import OrderedDict
from collections.abc import Collection
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from functools import lru_cache
from itertools import zip_longest
from pathlib import Path
from threading import Lock
from typing import NotRequired, TypedDict
from urllib.parse import urlsplit

import requests

import question_bank
from festmix_themes import FESTMIX_THEMES, festmix_theme
from quizzapi import QUIZZAPI_URL, reviewed_payload


logger = logging.getLogger(__name__)


class QuestionUnavailable(RuntimeError):
    pass


class InvalidQuestionSettings(QuestionUnavailable):
    pass


class NewQuestionsUnavailable(QuestionUnavailable):
    def __init__(self, available: int, *, message: str | None = None):
        self.available = available
        count = "1 ny fråga" if available == 1 else f"{available} nya frågor"
        super().__init__(message or (
            f"Jag hittade bara {count} med de här valen. "
            "Välj färre frågor, byt kategori eller svårighetsgrad, eller tillåt tidigare frågor."
        ))


class Question(TypedDict):
    key: str
    question: str
    correct: str
    incorrect: list[str]
    source: str
    source_url: NotRequired[str]
    explanation: NotRequired[str]


@dataclass(frozen=True)
class _Candidate:
    question: str
    correct: str
    incorrect: tuple[str, str, str]
    source: str
    language: str = "EN"
    category: str | None = None
    difficulty: str | None = None
    party_highlight: bool = False
    source_url: str | None = None


_OPENTDB_URL = "https://opentdb.com/api.php"
_TRIVIA_API_URL = "https://the-trivia-api.com/v2/questions"
_QUIZBASE_URL = "https://quizbase.runriva.com/api/v1/questions/random"
_TRIVIAAPI_GAMES_URL = "https://triviaapi.games/v1/questions"
_TRIVIAAPI_GAMES_SOURCE = "TriviaAPI.games"
_BANK_SOURCES = {"Open Trivia DB", "The Trivia API", "QuizBase (OpenTriviaQA)", "SciQ", "TriviaRoomQA"}
_PARTY_CATEGORY = "party"
MADE_UP_CATEGORY = "made-up"
MADE_UP_COUNT = 10
_MADE_UP_UNAVAILABLE = "Frågorna för Det låter påhittat kunde inte läsas."
_PARTY_SWEDISH_SOURCE = "FestQuiz · Källgranskat"
_PARTY_FRENCH_SOURCE = "OpenQuizzDB"
_PARTY_CATALOGS = (
    ("festmix_swedish.json", _PARTY_SWEDISH_SOURCE, "SV"),
    ("festmix_openquizzdb.json", _PARTY_FRENCH_SOURCE, "FR"),
    ("festmix_the_trivia_api.json", "The Trivia API", "EN"),
)
_PARTY_TAG_FILTERS = {
    "animal:animal-records": r"\b(?:gestation period|heaviest primates|largest eggs|largest species of penguin)\b",
    "science:inventions": (
        r"^(?:which|what)\b.*\b(?:device|appliance)\b.*\b(?:18|19|20)\d{2}\b|"
        r"\b(?:co-patented a pair of shoes|nursery rhyme did Thomas Edison|"
        r"William Morgan invent|Rubik.s Cube originally called)\b"
    ),
    "food:cocktails": r"\b(?:shares? (?:its )?name with a tool|main alcoholic ingredient)\b",
    "topic:world-records": r"\bvideo game character\b.*\b(?:19|20)\d{2}\b",
}
_TRIVIA_FILTERS = {
    "": {},
    "9": {"categories": "general_knowledge"},
    "11": {"categories": "film_and_tv"},
    "12": {"categories": "music"},
    "21": {"categories": "sport_and_leisure"},
    "15": {"tags": "topic:video-games"},
    "23": {"categories": "history"},
    "17": {"categories": "science"},
    "22": {"categories": "geography"},
    "modern": {"tags": "era:21st-century"},
    _PARTY_CATEGORY: {"tags": ",".join(_PARTY_TAG_FILTERS)},
}
_QUIZBASE_CATEGORIES = {
    "": "",
    "9": "general-knowledge",
    "11": "film",
    "12": "music",
    "21": "sports",
    "15": "video-games",
    "23": "history",
    "17": "science-and-nature",
    "22": "geography",
}
_OPENTDB_CATEGORY_NAMES = {
    "General Knowledge": "9",
    "Entertainment: Film": "11",
    "Entertainment: Music": "12",
    "Entertainment: Video Games": "15",
    "Science & Nature": "17",
    "Sports": "21",
    "Geography": "22",
    "History": "23",
}
_TRIVIA_CATEGORIES = {entry["categories"]: code for code, entry in _TRIVIA_FILTERS.items() if "categories" in entry}
_QUIZBASE_CATEGORY_CODES = {slug: code for code, slug in _QUIZBASE_CATEGORIES.items() if slug}
_QUIZZAPI_CATEGORIES = {"": "", "9": "culture_generale", "17": "science", "22": "geographie", "23": "histoire"}
_QUIZZAPI_DIFFICULTIES = {"": "", "easy": "facile", "medium": "normal", "hard": "difficile"}
_QUIZZAPI_CACHE: tuple[float, list[dict]] | None = None
_QUIZZAPI_LOCK = Lock()
_DIFFICULTIES = {"", "easy", "medium", "hard"}
_CACHE_LIMIT = 12000
_TRANSLATIONS: OrderedDict[tuple[str, str], str] = OrderedDict()
_TRANSLATIONS_LOCK = Lock()
_RELATIVE_TIME = re.compile(
    r"\b(?:currently|nowadays|at present|as (?:of|at) (?:today|now)|"
    r"(?:this|next|last) (?:year|month|week|season)|"
    r"(?:the|its) (?:latest|most recent|newest|reigning)|"
    r"(?:the|its) current (?:president|prime minister|leader|holder|name|population|champion))\b",
    re.IGNORECASE,
)
_UNDATED_OFFICE = re.compile(
    r"^who (?:is|serves as) (?:the )?(?:president|prime minister|chancellor|pope|"
    r"mayor|monarch|ceo|governor|head coach|world champion)(?:\s+(?:of|in|for)\b|\s*\?)",
    re.IGNORECASE,
)
_UNDATED_CHANGING_STATUS = re.compile(
    r"\b(?:"
    r"(?:has|have|holds?|commands?) (?:an? |the )?(?:parliamentary )?majority|"
    r"(?:controls?|is in control of) (?:the )?(?:parliament|senate|national assembly|house of representatives)|"
    r"(?:holds?|has|have) (?:the )?(?:(?:world|national|olympic) )?record|"
    r"(?:has|have) (?:won|scored|earned|received|sold) (?:the )?most|"
    r"(?:most|least) populous|(?:largest|smallest) (?:city|country|state) by population|"
    r"(?:largest|smallest|highest|lowest) (?:population|market cap(?:itali[sz]ation)?|gdp|exchange rate)|"
    r"(?:population|market cap(?:itali[sz]ation)?|exchange rate) of"
    r")\b",
    re.IGNORECASE,
)
_EXPLICIT_YEAR = re.compile(r"\b(?:1[5-9]\d{2}|20\d{2})\b")
_OPINION = re.compile(r"\b(?:in (?:your|my|our) opinion|do you (?:think|prefer)|(?:your|my|our) favou?rite|arguably)\b", re.IGNORECASE)
_SUBJECTIVE_RANK = re.compile(
    r"\bthe (?:very )?(?:best(?![- ]selling)|greatest(?! (?:common|prime|integer|number|distance))|worst|funniest|"
    r"prettiest|coolest|most beautiful|most famous|most iconic|most popular)\b",
    re.IGNORECASE,
)
_RANK_BASIS = re.compile(r"\b(?:awards?|oscars?|grammys?|emmys?|baftas?|golden globes?|voted|ranked|poll)\b", re.IGNORECASE)
_POSITIONAL_ANSWER = re.compile(
    r"\b(?:all|none|both|neither|one|two|three) (?:of )?(?:the )?(?:above|below|these|of them)\b|"
    r"\b(?:both|neither|either) (?:option |answer )?[a-d] (?:and|or|nor) (?:option |answer )?[a-d]\b",
    re.IGNORECASE,
)


def _normalized(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).casefold().replace("−", "-")
    return "".join(re.findall(r"(?<!\w)-(?=\d)|[\w+#]", normalized))


def valid_question_edit(question: str, correct: str, incorrect: list[str]) -> bool:
    answers = {_normalized(value) for value in (correct, *incorrect)}
    return bool(_normalized(question)) and len(answers) == 4 and "" not in answers


def _direct_source_url(value: object) -> str | None:
    if not isinstance(value, str) or any(char.isspace() or not char.isprintable() for char in value):
        return None
    try:
        parts = urlsplit(value)
        if parts.scheme in {"https", "http"} and parts.hostname and parts.username is None:
            return value
    except ValueError:
        pass
    return None


def _candidate(
    question, correct, incorrect, *, source: str, language: str = "EN", category=None, difficulty=None,
    party_highlight: bool = False,
    source_url: object = None,
) -> _Candidate | None:
    if not isinstance(incorrect, (list, tuple)) or len(incorrect) != 3:
        return None
    values = (question, correct, *incorrect)
    if any(not isinstance(value, str) or len(value) > 800 for value in values):
        return None
    cleaned = [html.unescape(value).strip() for value in values]
    if not all(_normalized(value) for value in cleaned):
        return None
    if len({_normalized(value) for value in cleaned[1:]}) != 4:
        return None
    question, correct, first, second, third = cleaned
    if _RELATIVE_TIME.search(question) or _OPINION.search(question):
        return None
    if not _EXPLICIT_YEAR.search(question) and (
        _UNDATED_OFFICE.search(question) or _UNDATED_CHANGING_STATUS.search(question)
    ):
        return None
    if _SUBJECTIVE_RANK.search(question) and not _RANK_BASIS.search(question):
        return None
    if any(_POSITIONAL_ANSWER.search(answer) for answer in (correct, first, second, third)):
        return None
    category = category if isinstance(category, str) and category and category in _TRIVIA_FILTERS else None
    difficulty = difficulty if isinstance(difficulty, str) and difficulty and difficulty in _DIFFICULTIES else None
    return _Candidate(
        question, correct, (first, second, third), source, language, category, difficulty,
        party_highlight, _direct_source_url(source_url),
    )


def _fetch_json(url: str, params: dict, headers: dict[str, str] | None = None) -> dict | list | None:
    try:
        response = requests.get(url, params=params, headers=headers, timeout=(2, 4), allow_redirects=False)
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError):
        return None


def _open_trivia(count: int, category: str, difficulty: str) -> list[_Candidate]:
    if category in {"modern", _PARTY_CATEGORY}:
        return []
    params = {"amount": count, "type": "multiple"}
    if category:
        params["category"] = category
    if difficulty:
        params["difficulty"] = difficulty
    payload = _fetch_json(_OPENTDB_URL, params)
    if not isinstance(payload, dict) or payload.get("response_code") != 0:
        return []
    rows = payload.get("results")
    if not isinstance(rows, list):
        return []
    results = []
    for row in rows:
        if isinstance(row, dict):
            candidate = _candidate(
                row.get("question"), row.get("correct_answer"), row.get("incorrect_answers"), source="Open Trivia DB",
                category=category or _OPENTDB_CATEGORY_NAMES.get(str(row.get("category"))),
                difficulty=difficulty or row.get("difficulty"),
            )
            if candidate:
                results.append(candidate)
    return results


def _trivia_api_enabled() -> bool:
    return os.getenv("TRIVIA_API_ENABLED", "1").strip().lower() not in {"0", "false", "no"}


def _party_trivia_row(row: dict, difficulty: str) -> bool:
    question = row["question"].get("text")
    wrong = row.get("incorrectAnswers")
    tags = row.get("tags")
    level = row.get("difficulty")
    if (
        row.get("isNiche") is not False
        or row.get("type") != "text_choice"
        or level not in ("easy", "medium", "hard")
        or (difficulty and level != difficulty)
        or not isinstance(question, str)
        or len(question) > 145
        or not isinstance(tags, list)
        or not isinstance(wrong, list)
        or any(not isinstance(answer, str) or len(answer) > 55 for answer in (row.get("correctAnswer"), *wrong))
    ):
        return False
    return any(tag in tags and re.search(pattern, question, re.IGNORECASE) for tag, pattern in _PARTY_TAG_FILTERS.items())


def _trivia_api(count: int, category: str, difficulty: str) -> list[_Candidate]:
    if not _trivia_api_enabled():
        return []
    params = {"limit": count, "types": "text_choice", **_TRIVIA_FILTERS[category]}
    if difficulty:
        params["difficulties"] = difficulty
    api_key = os.getenv("TRIVIA_API_KEY", "").strip()
    headers = {"X-API-Key": api_key} if api_key else None
    payload = _fetch_json(_TRIVIA_API_URL, params, headers)
    if payload is None and headers:
        payload = _fetch_json(_TRIVIA_API_URL, params)
    if not isinstance(payload, list):
        return []
    results = []
    for row in payload:
        if not isinstance(row, dict) or not isinstance(row.get("question"), dict):
            continue
        if row.get("type", "text_choice") != "text_choice":
            continue
        if category == _PARTY_CATEGORY and not _party_trivia_row(row, difficulty):
            continue
        tags = row.get("tags")
        topic = _TRIVIA_CATEGORIES.get(str(row.get("category")))
        if isinstance(tags, list) and ("topic:video-games" in tags or "video_games" in tags):
            topic = "15"
        sources = row.get("sources")
        links = sources.get("urls") if isinstance(sources, dict) else None
        link = next((url for url in links if _direct_source_url(url)), None) if isinstance(links, list) else None
        candidate = _candidate(
            row["question"].get("text"), row.get("correctAnswer"), row.get("incorrectAnswers"), source="The Trivia API",
            category=topic if category == _PARTY_CATEGORY else category or topic,
            difficulty=difficulty or row.get("difficulty"),
            source_url=link,
        )
        if candidate:
            results.append(candidate)
    return results


def _quizbase(count: int, category: str, difficulty: str) -> list[_Candidate]:
    api_key = os.getenv("QUIZBASE_API_KEY", "").strip()
    slug = _QUIZBASE_CATEGORIES.get(category)
    if not api_key or slug is None:
        return []

    params = {"amount": min(count, 50), "lang": "en", "type": "multiple", "source": "opentriviaqa"}
    if slug:
        params["category"] = slug
    if difficulty:
        params["difficulty"] = difficulty
    payload = _fetch_json(_QUIZBASE_URL, params, {"X-API-Key": api_key})
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        return []

    results = []
    for row in payload["data"]:
        if not isinstance(row, dict) or row.get("language") != "en" or row.get("type") != "multiple":
            continue
        attribution = row.get("attribution")
        if (
            not isinstance(attribution, dict)
            or attribution.get("source") != "opentriviaqa"
            or attribution.get("license") != "CC-BY-SA-4.0"
            or attribution.get("modifications") not in ([], ["refined_text"])
        ):
            continue
        topic = row.get("category")
        if slug and (not isinstance(topic, dict) or topic.get("slug") != slug):
            continue
        if difficulty and row.get("difficulty") != difficulty:
            continue
        candidate = _candidate(
            row.get("text"), row.get("correctAnswer"), row.get("incorrectAnswers"), source="QuizBase (OpenTriviaQA)",
            category=_QUIZBASE_CATEGORY_CODES.get(str(topic.get("slug"))) if isinstance(topic, dict) else None,
            difficulty=row.get("difficulty"),
        )
        if candidate:
            results.append(candidate)
    return results


def _triviaapi_games(count: int, category: str, difficulty: str) -> list[_Candidate]:
    api_key = os.getenv("TRIVIAAPI_GAMES_API_KEY", "").strip()
    if not api_key or category or difficulty:
        return []

    payload = _fetch_json(_TRIVIAAPI_GAMES_URL, {"amount": min(count, 10)}, {"X-API-Key": api_key})
    if not isinstance(payload, dict) or not isinstance(payload.get("questions"), list):
        return []

    results = []
    for row in payload["questions"]:
        if isinstance(row, dict):
            candidate = _candidate(
                row.get("question"), row.get("correct_answer"), row.get("incorrect_answers"), source=_TRIVIAAPI_GAMES_SOURCE
            )
            if candidate:
                results.append(candidate)
    return results


def _quizzapi_rows() -> list[dict]:
    global _QUIZZAPI_CACHE
    with _QUIZZAPI_LOCK:
        now = time.monotonic()
        if _QUIZZAPI_CACHE is None or now >= _QUIZZAPI_CACHE[0]:
            payload = _fetch_json(QUIZZAPI_URL, {})
            rows = reviewed_payload(payload)
            _QUIZZAPI_CACHE = (now + (3600 if rows else 60), rows)
        return _QUIZZAPI_CACHE[1]


def _quizzapi(_count: int, category: str, difficulty: str) -> list[_Candidate]:
    slug = _QUIZZAPI_CATEGORIES.get(category)
    if slug is None:
        return []
    level = _QUIZZAPI_DIFFICULTIES[difficulty]
    results = []
    for row in _quizzapi_rows():
        if (slug and row["category"] != slug) or (level and row["difficulty"] != level):
            continue
        candidate = _candidate(row["question"], row["answer"], row["badAnswers"], source="QuizzAPI", language="FR")
        if candidate:
            results.append(candidate)
    return results


@lru_cache(maxsize=5)
def _reviewed_questions(filename: str) -> tuple[dict, ...]:
    try:
        data = json.loads(Path(__file__).with_name(filename).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ()
    return tuple(row for row in data if isinstance(row, dict)) if isinstance(data, list) else ()


def _reviewed_candidates(
    filename: str, source: str, category: str = "", difficulty: str = "", *, default_category: str = ""
) -> list[_Candidate]:
    results = []
    for row in _reviewed_questions(filename):
        if (category and row.get("category") != category) or (difficulty and row.get("difficulty") != difficulty):
            continue
        candidate = _candidate(
            row.get("question"), row.get("correct"), row.get("incorrect"), source=source,
            category=row.get("category") or default_category, difficulty=row.get("difficulty"),
        )
        if candidate:
            results.append(candidate)
    return results


def _sciq(_count: int, category: str, difficulty: str) -> list[_Candidate]:
    if category not in {"", "17"} or difficulty:
        return []
    return _reviewed_candidates("sciq_reviewed.json", "SciQ", default_category="17")


def _triviaroomqa(_count: int, category: str, difficulty: str) -> list[_Candidate]:
    return _reviewed_candidates("triviaroomqa_reviewed.json", "TriviaRoomQA", category, difficulty)


def _party_candidates(
    filename: str, source: str, language: str, difficulty: str, themes: Collection[str] = ()
) -> list[_Candidate]:
    results = []
    french_levels = {"facile": "easy", "normal": "medium", "difficile": "hard"}
    for row in _reviewed_questions(filename):
        if themes and festmix_theme(row.get("theme")) not in themes:
            continue
        level = row.get("difficulty")
        if not isinstance(level, str) or not row.get("source_url"):
            continue
        level = french_levels.get(level, level)
        if level not in ("easy", "medium", "hard") or (difficulty and difficulty != level):
            continue
        candidate = _candidate(
            row.get("question"), row.get("correct"), row.get("incorrect"), source=source,
            category=_PARTY_CATEGORY, difficulty=level, language=language,
            party_highlight=row.get("party_highlight") is True,
            source_url=row.get("source_url"),
        )
        if candidate:
            results.append(candidate)
    return results


_TITLE_KIND = (
    r"(?:film|movie|comic strip|comic book|book|novel|song|album|"
    r"(?:tv|television) (?:series|show|miniseries|program(?:me)?)|(?:board|video|arcade) game)(?: title)?\b"
)
_TITLE_QUALIFIER = r"(?:(?:\d{4}|['’]?\d{2}s|animated|classic|iconic|silent|studio)\s+)*"
_TITLE_QUESTION = re.compile(
    r"^(?:(?:(?:in|from)\s+)?(?:which|what)\s+"
    r"|what (?:is|was) the (?:name|title) of (?:the|an?)\s+"
    r"|which of (?:these|the following) (?:is|was) an?\s+)"
    rf"{_TITLE_QUALIFIER}{_TITLE_KIND}"
    r"(?=\s+(?:(?:first|originally)\s+)?"
    r"(?:do|did|does|is|was|has|had|won|features?|stars?|starring|tells?|contains?|appears?|aired|became|by|from|where)"
    r"\b|[?,]|$)"
    rf"|\b(?:which|what)\s+{_TITLE_KIND}\s*\?$",
    re.IGNORECASE,
)
_TITLE_PLACEHOLDER = re.compile(
    r"(?:unknown|not known|not applicable|no answer|(?:all|none|both|neither) of (?:the )?following)[.!?]?",
    re.IGNORECASE,
)


def _keep_answer(text: str) -> bool:
    # Behåll uttryckliga citat och korta namn eller titlar, som i FestQuiz 2.0.
    if len(text) < 2 or (text[0], text[-1]) in {('"', '"'), ("'", "'"), ("“", "”"), ("«", "»")}:
        return True
    lower = f" {text.lower()} "
    verbs = (" is ", " are ", " was ", " were ", " did ", " does ", " has ", " have ")
    return (
        len(text.split()) <= 5
        and not any(verb in lower for verb in verbs)
        and sum(char.isupper() for char in text) / len(text) > 0.3
    )


def _kept_answers(candidate: _Candidate) -> set[str]:
    if candidate.language != "EN":
        return set()
    answers = (candidate.correct, *candidate.incorrect)
    if _TITLE_QUESTION.search(candidate.question):
        return {
            answer for answer in answers
            if not _POSITIONAL_ANSWER.search(answer) and not _TITLE_PLACEHOLDER.fullmatch(answer)
        }
    return {answer for answer in answers if _keep_answer(answer)}


def _translate_batch(candidates: list[_Candidate], translations: dict[tuple[str, str], str], api_key: str) -> bool:
    needed: dict[str, dict[str, None]] = {}
    cacheable: set[tuple[str, str]] = set()
    for candidate in candidates:
        language = candidate.language
        answers = (candidate.correct, *candidate.incorrect)
        kept_answers = _kept_answers(candidate)
        texts = [candidate.question, *(answer for answer in answers if answer not in kept_answers)]
        needed.setdefault(language, {}).update(dict.fromkeys(texts))
        # TriviaAPI.games tillåter visning i spelet men förbjuder att bygga en frågedatabas.
        if candidate.source != _TRIVIAAPI_GAMES_SOURCE:
            cacheable.update((language, text) for text in texts)

    with _TRANSLATIONS_LOCK:
        for language, texts in needed.items():
            for text in texts:
                key = (language, text)
                if key in _TRANSLATIONS:
                    translations[key] = _TRANSLATIONS[key]
                    _TRANSLATIONS.move_to_end(key)

    if not api_key:
        return False
    domain = "api-free.deepl.com" if api_key.endswith(":fx") else "api.deepl.com"
    for language, texts in needed.items():
        missing = [text for text in texts if (language, text) not in translations]
        for start in range(0, len(missing), 50):
            batch = missing[start:start + 50]
            try:
                response = requests.post(
                    f"https://{domain}/v2/translate",
                    headers={"Authorization": f"DeepL-Auth-Key {api_key}"},
                    json={"text": batch, "source_lang": language, "target_lang": "SV"},
                    timeout=(2, 6),
                )
                response.raise_for_status()
                translated = [item["text"].strip() for item in response.json()["translations"]]
                if len(translated) != len(batch) or not all(translated):
                    return False
            except (requests.RequestException, ValueError, KeyError, TypeError, AttributeError):
                return False

            additions = {(language, text): result for text, result in zip(batch, translated)}
            translations.update(additions)
            with _TRANSLATIONS_LOCK:
                _TRANSLATIONS.update((key, result) for key, result in additions.items() if key in cacheable)
                while len(_TRANSLATIONS) > _CACHE_LIMIT:
                    _TRANSLATIONS.popitem(last=False)
    return True


def _resolved(candidate: _Candidate, translations: dict[tuple[str, str], str]) -> Question | None:
    language = candidate.language
    if language == "SV":
        question = candidate.question
        answers = [candidate.correct, *candidate.incorrect]
    else:
        question = translations.get((language, candidate.question), "")
        if not question or _normalized(question) == _normalized(candidate.question):
            return None
        kept_answers = _kept_answers(candidate)
        answers = [
            text if text in kept_answers else translations.get((language, text), "")
            for text in (candidate.correct, *candidate.incorrect)
        ]
        if not all(answers) or len({_normalized(answer) for answer in answers}) != 4:
            return None
    correct, *incorrect = answers

    key = hashlib.blake2b(_normalized(question).encode("utf-8"), digest_size=16).hexdigest()
    result: Question = {"key": key, "question": question, "correct": correct, "incorrect": incorrect, "source": candidate.source}
    if candidate.source_url:
        result["source_url"] = candidate.source_url
    return result


def _bank_id(candidate: _Candidate) -> str:
    original = f"{candidate.source}\0{candidate.language}\0{_normalized(candidate.question)}"
    return hashlib.blake2b(original.encode("utf-8"), digest_size=16).hexdigest()


def _bank_record(candidate: _Candidate, record_id: str, question: Question) -> question_bank.BankQuestion:
    return question_bank.BankQuestion(
        id=record_id, key=question["key"], source=candidate.source, language=candidate.language,
        category=candidate.category, difficulty=candidate.difficulty,
        original_question=candidate.question, original_correct=candidate.correct, original_incorrect=candidate.incorrect,
        question=question["question"], correct=question["correct"], incorrect=tuple(question["incorrect"]),
    )


@lru_cache(maxsize=1)
def _curated_source_urls() -> dict[str, str]:
    return {
        _bank_id(candidate): candidate.source_url
        for filename, source, language in _PARTY_CATALOGS
        for candidate in _party_candidates(filename, source, language, "")
        if candidate.source_url
    }


@lru_cache(maxsize=1)
def _audited_source_urls() -> dict[str, str]:
    try:
        data = json.loads(Path(__file__).with_name("question_source_overrides.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict):
        return {}
    return {record_id: link for record_id, url in data.items() if (link := _direct_source_url(url))}


def _bank_value(record: question_bank.BankQuestion, source_url: str | None = None) -> Question:
    result: Question = {"key": record.key, "source": record.source, "question": record.question,
                        "correct": record.correct, "incorrect": list(record.incorrect)}
    audited_link = _audited_source_urls().get(record.id) if record.edited else None
    link = audited_link or _curated_source_urls().get(record.id) or source_url
    if link:
        result["source_url"] = link
    return result


def _read_bank(
    category: str, difficulty: str, sources: set[str], exclude: Collection[str] = ()
) -> list[question_bank.BankQuestion] | None:
    try:
        return question_bank.fallback_questions(category, difficulty, sources=sources, exclude=exclude)
    except question_bank.QuestionBankUnavailable:
        logger.warning("Frågebanken kunde inte läsas. Använder frågekällorna för den här omgången.")
        return None


def validate_made_up_settings(amount: object, difficulty: object, themes: object) -> None:
    empty_themes = isinstance(themes, (list, tuple, set, frozenset)) and not themes
    if amount != MADE_UP_COUNT or difficulty != "" or not empty_themes:
        raise InvalidQuestionSettings(
            "Det låter påhittat spelas med 10 frågor och blandad svårighet. Temaval finns i Festmix."
        )


@lru_cache(maxsize=1)
def _made_up_pack() -> tuple[Question, ...]:
    try:
        rows = json.loads(Path(__file__).with_name("festmix_made_up.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise QuestionUnavailable(_MADE_UP_UNAVAILABLE) from error
    if not isinstance(rows, list) or len(rows) != MADE_UP_COUNT:
        raise QuestionUnavailable(_MADE_UP_UNAVAILABLE)

    questions: list[Question] = []
    keys: set[str] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise QuestionUnavailable(_MADE_UP_UNAVAILABLE)
        explanation = row.get("explanation")
        source = row.get("source")
        if (not isinstance(explanation, str) or not _normalized(explanation)
                or not isinstance(source, str) or not _normalized(source)):
            raise QuestionUnavailable(_MADE_UP_UNAVAILABLE)
        candidate = _candidate(
            row.get("question"), row.get("correct"), row.get("incorrect"),
            source=source.strip(), language="SV", source_url=row.get("source_url"),
        )
        if candidate is None or candidate.source_url is None:
            raise QuestionUnavailable(_MADE_UP_UNAVAILABLE)
        question = _resolved(candidate, {})
        if question is None or question["key"] in keys:
            raise QuestionUnavailable(_MADE_UP_UNAVAILABLE)
        question["explanation"] = explanation.strip()
        questions.append(question)
        keys.add(question["key"])
    return tuple(questions)


def _get_made_up_questions(exclude: Collection[str], allow_repeats: bool) -> list[Question]:
    pack = _made_up_pack()
    available = sum(question["key"] not in exclude for question in pack)
    if available < MADE_UP_COUNT and not allow_repeats:
        raise NewQuestionsUnavailable(
            available,
            message=f"Du har {available} av paketets 10 frågor kvar att spela i rummet. "
            "Tillåt tidigare frågor för att spela hela paketet eller välj en annan kategori.",
        )
    questions = []
    for original in pack:
        question = original.copy()
        question["incorrect"] = original["incorrect"].copy()
        questions.append(question)
    random.shuffle(questions)
    return questions


def get_questions(
    amount: int,
    category: str = "",
    difficulty: str = "",
    exclude: Collection[str] = (),
    *,
    avoid_recent: Collection[str] = (),
    allow_repeats: bool = False,
    themes: Collection[str] = (),
) -> list[Question]:
    """Returnera exakt antal unika svenska frågor med bibehållna kategori- och nivåval."""
    if category == MADE_UP_CATEGORY:
        validate_made_up_settings(amount, difficulty, themes)
        return _get_made_up_questions(exclude, allow_repeats)
    if not 1 <= amount <= 30 or category not in _TRIVIA_FILTERS or difficulty not in _DIFFICULTIES:
        raise QuestionUnavailable("Välj en giltig kategori, svårighetsgrad och mellan 1 och 30 frågor.")
    theme_filter = frozenset(themes)
    if theme_filter and (category != _PARTY_CATEGORY or not theme_filter.issubset(FESTMIX_THEMES)):
        raise QuestionUnavailable("Välj giltiga teman i Festmix.")

    api_key = os.getenv("DEEPL_API_KEY", "").strip()
    trivia_enabled = _trivia_api_enabled()
    count = 50 if category == "modern" else min(50, max(24, amount * 2))
    pools = []
    if category == _PARTY_CATEGORY:
        for filename, source, language in _PARTY_CATALOGS:
            if source == "The Trivia API" and not trivia_enabled:
                continue
            pool = _party_candidates(filename, source, language, difficulty, theme_filter)
            if source == "The Trivia API" and api_key and not theme_filter:
                pool.extend(_trivia_api(count, category, difficulty))
            pools.append(pool)
    elif api_key:
        providers = (_open_trivia, _trivia_api, _quizbase, _triviaapi_games, _quizzapi, _sciq, _triviaroomqa)
        with ThreadPoolExecutor(max_workers=len(providers)) as executor:
            pending = [executor.submit(provider, count, category, difficulty) for provider in providers]
            pools = [result.result() for result in pending]

    for pool in pools:
        random.shuffle(pool)
    random.shuffle(pools)
    candidates = []
    seen_originals = set()
    for group in zip_longest(*pools):
        for candidate in group:
            if candidate is None:
                continue
            original = (candidate.language, _normalized(candidate.question))
            if original not in seen_originals:
                seen_originals.add(original)
                candidates.append(candidate)

    if category == _PARTY_CATEGORY:
        candidates.sort(key=lambda candidate: not candidate.party_highlight)
    highlight_target = (amount * 3 + 3) // 4 if category == _PARTY_CATEGORY else 0
    highlights, fresh, recent, repeated = [], [], [], []
    excluded, avoid = set(exclude), set(avoid_recent)
    seen_keys, seen_prompts = set(), set()

    def add(question: Question, *, party_highlight: bool = False) -> None:
        key = question["key"]
        prompt = _normalized(question["question"])
        if key in seen_keys or prompt in seen_prompts:
            return
        seen_keys.add(key)
        seen_prompts.add(prompt)
        if key in excluded:
            repeated.append(question)
        elif key in avoid:
            recent.append(question)
        elif party_highlight:
            highlights.append(question)
        else:
            fresh.append(question)

    def select_fresh() -> list[Question]:
        return (highlights[:highlight_target] + fresh + highlights[highlight_target:])[:amount]

    bank_sources = (
        {_PARTY_SWEDISH_SOURCE, _PARTY_FRENCH_SOURCE, "The Trivia API"}
        if category == _PARTY_CATEGORY else set(_BANK_SOURCES)
    )
    if not trivia_enabled:
        bank_sources.discard("The Trivia API")
    bank_enabled = question_bank.bank_enabled()
    stored = []
    if bank_enabled and not theme_filter:
        stored = _read_bank(category, difficulty, bank_sources, excluded)
        bank_enabled = stored is not None
        stored = stored or []
    if candidates and category != _PARTY_CATEGORY:
        bank_share = amount // 4
        for record in stored:
            if len(fresh) >= bank_share:
                break
            if record.key not in avoid:
                add(_bank_value(record))

    bank_ids = {
        candidate: _bank_id(candidate) for candidate in candidates if candidate.source in bank_sources
    } if bank_enabled else {}
    try:
        saved = question_bank.lookup_questions(bank_ids.values()) if bank_ids else {}
    except question_bank.QuestionBankUnavailable:
        logger.warning("Frågebanken kunde inte kontrollera tidigare översättningar.")
        saved = {}
        bank_ids = {}

    translations: dict[tuple[str, str], str] = {}
    translation_available = True
    save_to_bank = bool(bank_ids)
    for offset in range(0, len(candidates), 12):
        batch = candidates[offset:offset + 12]
        to_translate = [
            candidate for candidate in batch if candidate.language != "SV" and bank_ids.get(candidate) not in saved
        ]
        if to_translate:
            translation_available = _translate_batch(to_translate, translations, api_key if translation_available else "")
        new_records = []
        for candidate in batch:
            record_id = bank_ids.get(candidate)
            previous = saved.get(record_id) if record_id else None
            if previous is not None and previous.category == question_bank.ARCHIVED_CATEGORY:
                continue
            question = _bank_value(previous, candidate.source_url) if previous else _resolved(candidate, translations)
            if question is None:
                continue
            if save_to_bank and record_id and previous is None:
                new_records.append(_bank_record(candidate, record_id, question))
            add(question, party_highlight=candidate.party_highlight)
        if new_records:
            try:
                question_bank.store_questions(new_records)
            except question_bank.QuestionBankUnavailable:
                logger.warning("De hämtade frågorna kunde inte sparas i frågebanken.")
                save_to_bank = False
        if len(fresh) + min(len(highlights), highlight_target) >= amount:
            selected = select_fresh()
            random.shuffle(selected)
            return selected

    for record in stored:
        add(_bank_value(record))
    if bank_enabled and not theme_filter and excluded and len(highlights) + len(fresh) + len(recent) < amount:
        for record in _read_bank(category, difficulty, bank_sources) or ():
            add(_bank_value(record))

    unused = select_fresh()
    unused += recent[:amount - len(unused)]
    repeats = repeated[:amount - len(unused)] if allow_repeats else []
    available = len(unused) + len(repeats)
    if available != amount:
        if repeated and not allow_repeats:
            total = len(unused) + len(repeated)
            if total >= amount:
                raise NewQuestionsUnavailable(len(unused))
            if theme_filter:
                raise QuestionUnavailable(
                    f"Jag hittade {total} frågor med de här temana, varav {len(unused)} nya. "
                    "Välj färre frågor, fler teman eller en annan svårighetsgrad."
                )
            raise QuestionUnavailable(
                f"Jag hittade bara {total} frågor med de här valen, varav {len(unused)} nya. "
                "Välj färre frågor eller byt kategori eller svårighetsgrad."
            )
        if theme_filter:
            raise QuestionUnavailable(
                f"Jag hittade {available} frågor på svenska med de här temana. "
                "Välj färre frågor, fler teman eller en annan svårighetsgrad."
            )
        if not api_key:
            raise QuestionUnavailable("Frågebanken räcker inte för de här valen. DeepL behövs för att hämta fler frågor på svenska.")
        if not translation_available:
            raise QuestionUnavailable(
                "Frågorna kunde inte översättas till svenska. Kontrollera DeepL-inställningen eller försök igen om en stund."
            )
        raise QuestionUnavailable(
            f"Frågetjänsterna levererade {available} användbara svenska frågor för de valen. "
            "Försök igen, välj färre frågor eller byt kategori eller svårighetsgrad."
        )
    random.shuffle(unused)
    random.shuffle(repeats)
    return unused + repeats
