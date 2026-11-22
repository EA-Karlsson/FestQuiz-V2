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
from functools import lru_cache
from itertools import zip_longest
from pathlib import Path
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


@dataclass(frozen=True)
class _Candidate:
    question: str
    correct: str
    incorrect: tuple[str, str, str]
    swedish: bool = False


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
    "modern": {"tags": "era:2020s"},
}
_DIFFICULTIES = {"", "easy", "medium", "hard"}
_CACHE_LIMIT = 12000
_TRANSLATIONS: OrderedDict[str, str] = OrderedDict()
_TRANSLATIONS_LOCK = Lock()


def _normalized(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).casefold().replace("−", "-")
    return "".join(re.findall(r"(?<!\w)-(?=\d)|[\w+#]", normalized))


def _candidate(question, correct, incorrect, *, swedish=False) -> _Candidate | None:
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
    return _Candidate(question, correct, (first, second, third), swedish)


@lru_cache(maxsize=1)
def _swedish_bank() -> tuple[tuple[str, str, _Candidate], ...]:
    path = Path(__file__).with_name("swedish_questions.txt")
    bank = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip() or line.startswith("#"):
            continue
        category, difficulty, question, correct, *incorrect = line.split("|")
        candidate = _candidate(question, correct, incorrect, swedish=True)
        if category not in _TRIVIA_FILTERS or difficulty not in _DIFFICULTIES or not candidate:
            raise ValueError(f"Ogiltig fråga i lokal frågebank på rad {number}.")
        bank.append((category, difficulty, candidate))
    return tuple(bank)


def _fetch_json(url: str, params: dict) -> dict | list | None:
    try:
        response = requests.get(url, params=params, timeout=(2, 4))
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
            candidate = _candidate(row.get("question"), row.get("correct_answer"), row.get("incorrect_answers"))
            if candidate:
                results.append(candidate)
    return results


def _trivia_api(count: int, category: str, difficulty: str) -> list[_Candidate]:
    if os.getenv("TRIVIA_API_ENABLED", "1").strip().lower() in {"0", "false", "no"}:
        return []
    params = {"limit": count, **_TRIVIA_FILTERS[category]}
    if difficulty:
        params["difficulties"] = difficulty
    payload = _fetch_json(_TRIVIA_API_URL, params)
    if not isinstance(payload, list):
        return []
    results = []
    for row in payload:
        if not isinstance(row, dict) or not isinstance(row.get("question"), dict):
            continue
        candidate = _candidate(row["question"].get("text"), row.get("correctAnswer"), row.get("incorrectAnswers"))
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
        if not candidate.swedish:
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
    question = candidate.question
    correct = candidate.correct
    incorrect = list(candidate.incorrect)
    if not candidate.swedish:
        question = translations.get(question, "")
        if not question or _normalized(question) == _normalized(candidate.question):
            return None
        answers = [
            text if _keep_answer(text) else translations.get(text, "")
            for text in (correct, *incorrect)
        ]
        if not all(answers) or len({_normalized(answer) for answer in answers}) != 4:
            return None
        correct, *incorrect = answers

    key = hashlib.blake2b(_normalized(question).encode("utf-8"), digest_size=16).hexdigest()
    return {"key": key, "question": question, "correct": correct, "incorrect": incorrect}


def get_questions(
    amount: int, category: str = "", difficulty: str = "", exclude: Collection[str] = ()
) -> list[Question]:
    """Returnera exakt antal unika svenska frågor med bibehållna kategori- och nivåval."""
    if not 1 <= amount <= 20 or category not in _TRIVIA_FILTERS or difficulty not in _DIFFICULTIES:
        raise QuestionUnavailable("Välj en giltig kategori, svårighetsgrad och mellan 1 och 20 frågor.")

    local = [
        candidate for topic, level, candidate in _swedish_bank()
        if (not category or topic == category) and (not difficulty or level == difficulty)
    ]
    pools = [local]
    api_key = os.getenv("DEEPL_API_KEY", "").strip()
    if api_key:
        count = min(50, max(22, amount * 2))
        with ThreadPoolExecutor(max_workers=2) as executor:
            first = executor.submit(_open_trivia, count, category, difficulty)
            second = executor.submit(_trivia_api, count, category, difficulty)
            pools += [first.result(), second.result()]

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
    translation_available = bool(api_key)
    for offset in range(0, len(candidates), 12):
        batch = candidates[offset:offset + 12]
        if translation_available:
            translation_available = _translate_batch(batch, translations, api_key)
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
        raise QuestionUnavailable(
            f"Det finns bara {len(questions)} svenska frågor tillgängliga för de valen just nu. "
            "Välj färre frågor, blandad svårighetsgrad eller en annan kategori."
        )
    random.shuffle(questions)
    return questions
