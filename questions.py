import hashlib
import html
import os
import random
import re
import unicodedata
from collections import OrderedDict
from collections.abc import Collection
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from itertools import zip_longest
from threading import Lock
from typing import TypedDict

import requests


class QuestionUnavailable(RuntimeError):
    pass


class Question(TypedDict):
    key: str
    question: str
    correct: str
    incorrect: list[str]
    source: str


@dataclass(frozen=True)
class _Candidate:
    question: str
    correct: str
    incorrect: tuple[str, str, str]
    source: str


_OPENTDB_URL = "https://opentdb.com/api.php"
_TRIVIA_API_URL = "https://the-trivia-api.com/v2/questions"
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
}
_DIFFICULTIES = {"", "easy", "medium", "hard"}
_CACHE_LIMIT = 12000
_TRANSLATIONS: OrderedDict[str, str] = OrderedDict()
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


def _candidate(question, correct, incorrect, *, source: str) -> _Candidate | None:
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
    return _Candidate(question, correct, (first, second, third), source)


def _fetch_json(url: str, params: dict, headers: dict[str, str] | None = None) -> dict | list | None:
    try:
        response = requests.get(url, params=params, headers=headers, timeout=(2, 4), allow_redirects=False)
        response.raise_for_status()
        return response.json()
    except (requests.RequestException, ValueError):
        return None


def _open_trivia(count: int, category: str, difficulty: str) -> list[_Candidate]:
    if category == "modern":
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
                row.get("question"), row.get("correct_answer"), row.get("incorrect_answers"), source="Open Trivia DB"
            )
            if candidate:
                results.append(candidate)
    return results


def _trivia_api(count: int, category: str, difficulty: str) -> list[_Candidate]:
    if os.getenv("TRIVIA_API_ENABLED", "1").strip().lower() in {"0", "false", "no"}:
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
        candidate = _candidate(
            row["question"].get("text"), row.get("correctAnswer"), row.get("incorrectAnswers"), source="The Trivia API"
        )
        if candidate:
            results.append(candidate)
    return results


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


def _translate_batch(candidates: list[_Candidate], translations: dict[str, str], api_key: str) -> bool:
    needed = {}
    for candidate in candidates:
        needed[candidate.question] = None
        for answer in (candidate.correct, *candidate.incorrect):
            if not _keep_answer(answer):
                needed[answer] = None

    with _TRANSLATIONS_LOCK:
        for text in needed:
            if text in _TRANSLATIONS:
                translations[text] = _TRANSLATIONS[text]
                _TRANSLATIONS.move_to_end(text)

    missing = [text for text in needed if text not in translations]
    if not api_key:
        return False
    domain = "api-free.deepl.com" if api_key.endswith(":fx") else "api.deepl.com"
    for start in range(0, len(missing), 50):
        batch = missing[start:start + 50]
        try:
            response = requests.post(
                f"https://{domain}/v2/translate",
                headers={"Authorization": f"DeepL-Auth-Key {api_key}"},
                json={"text": batch, "source_lang": "EN", "target_lang": "SV"},
                timeout=(2, 6),
            )
            response.raise_for_status()
            translated = [item["text"].strip() for item in response.json()["translations"]]
            if len(translated) != len(batch) or not all(translated):
                return False
        except (requests.RequestException, ValueError, KeyError, TypeError, AttributeError):
            return False

        additions = dict(zip(batch, translated))
        translations.update(additions)
        with _TRANSLATIONS_LOCK:
            _TRANSLATIONS.update(additions)
            while len(_TRANSLATIONS) > _CACHE_LIMIT:
                _TRANSLATIONS.popitem(last=False)
    return True


def _resolved(candidate: _Candidate, translations: dict[str, str]) -> Question | None:
    question = translations.get(candidate.question, "")
    if not question or _normalized(question) == _normalized(candidate.question):
        return None
    answers = [
        text if _keep_answer(text) else translations.get(text, "")
        for text in (candidate.correct, *candidate.incorrect)
    ]
    if not all(answers) or len({_normalized(answer) for answer in answers}) != 4:
        return None
    correct, *incorrect = answers

    key = hashlib.blake2b(_normalized(question).encode("utf-8"), digest_size=16).hexdigest()
    return {"key": key, "question": question, "correct": correct, "incorrect": incorrect, "source": candidate.source}


def get_questions(
    amount: int, category: str = "", difficulty: str = "", exclude: Collection[str] = ()
) -> list[Question]:
    """Returnera exakt antal unika svenska frågor med bibehållna kategori- och nivåval."""
    if not 1 <= amount <= 20 or category not in _TRIVIA_FILTERS or difficulty not in _DIFFICULTIES:
        raise QuestionUnavailable("Välj en giltig kategori, svårighetsgrad och mellan 1 och 20 frågor.")

    api_key = os.getenv("DEEPL_API_KEY", "").strip()
    if not api_key:
        raise QuestionUnavailable("Svensk översättning är inte aktiverad. DeepL behöver ställas in på servern.")

    count = 50 if category == "modern" else max(24, amount * 2)
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(_open_trivia, count, category, difficulty)
        second = executor.submit(_trivia_api, count, category, difficulty)
        pools = [first.result(), second.result()]

    for pool in pools:
        random.shuffle(pool)
    random.shuffle(pools)
    combined = [candidate for group in zip_longest(*pools) for candidate in group if candidate]

    seen_originals = set()
    candidates = []
    for candidate in combined:
        original = _normalized(candidate.question)
        if original not in seen_originals:
            seen_originals.add(original)
            candidates.append(candidate)

    fresh, older = [], []
    excluded, seen = set(exclude), set()
    translations: dict[str, str] = {}
    translation_available = True
    for offset in range(0, len(candidates), 12):
        batch = candidates[offset:offset + 12]
        translation_available = _translate_batch(batch, translations, api_key if translation_available else "")
        for candidate in batch:
            question = _resolved(candidate, translations)
            if question is None or question["key"] in seen:
                continue
            seen.add(question["key"])
            if question["key"] in excluded:
                older.append(question)
            else:
                fresh.append(question)
            if len(fresh) == amount:
                random.shuffle(fresh)
                return fresh

    questions = fresh + older[:amount - len(fresh)]
    if len(questions) != amount:
        if not translation_available:
            raise QuestionUnavailable(
                "Frågorna kunde inte översättas till svenska. Kontrollera DeepL-inställningen eller försök igen om en stund."
            )
        raise QuestionUnavailable(
            f"Frågetjänsterna levererade {len(questions)} användbara svenska frågor för de valen. "
            "Försök igen, välj färre frågor eller byt kategori eller svårighetsgrad."
        )
    random.shuffle(questions)
    return questions
