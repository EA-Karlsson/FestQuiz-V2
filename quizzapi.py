import hashlib
import json
import re
from functools import lru_cache
from pathlib import Path


QUIZZAPI_URL = "https://quizzapi.fr/api/v2/quiz"
_REVIEW_FILE = Path(__file__).with_name("quizzapi_reviewed.json")
_ID = re.compile(r"[a-z0-9]{24,32}")
_DIGEST = re.compile(r"[0-9a-f]{64}")
_DIFFICULTIES = {"facile", "normal", "difficile"}
_SCOPES = {"international", "nordic"}


def fingerprint(row: object) -> str | None:
    """Bind a review to the original text, choices, category and difficulty."""
    if not isinstance(row, dict):
        return None
    category = row.get("category")
    difficulty = row.get("difficulty")
    wrong = row.get("badAnswers")
    if not isinstance(category, str) or not re.fullmatch(r"[a-z_]{1,40}", category):
        return None
    if not isinstance(difficulty, str) or difficulty not in _DIFFICULTIES:
        return None
    if not isinstance(wrong, list) or len(wrong) != 3:
        return None
    question, correct = row.get("question"), row.get("answer")
    if any(not isinstance(text, str) or not text.strip() or len(text) > 800 for text in (question, correct, *wrong)):
        return None
    if len({text.strip().casefold() for text in (correct, *wrong)}) != 4:
        return None
    content = json.dumps([category, difficulty, question, correct, sorted(wrong)], ensure_ascii=False, separators=(",", ":"))
    try:
        return hashlib.sha256(content.encode("utf-8")).hexdigest()
    except UnicodeEncodeError:
        return None


@lru_cache(maxsize=1)
def _reviewed_entries() -> dict:
    try:
        metadata = json.loads(_REVIEW_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(metadata, dict) or metadata.get("version") != 1:
        return {}
    entries = metadata.get("questions")
    return entries if isinstance(entries, dict) else {}


def reviewed_payload(payload: object) -> list[dict]:
    """Return the provider rows matching the reviewed contents, in provider order."""
    if not isinstance(payload, dict) or not isinstance(payload.get("quizzes"), list):
        return []
    entries = _reviewed_entries()
    approved = []
    for row in payload["quizzes"]:
        row_id = row.get("id") if isinstance(row, dict) else None
        if not isinstance(row_id, str) or not _ID.fullmatch(row_id):
            continue
        review = entries.get(row_id)
        if not isinstance(review, dict):
            continue
        digest, scope = review.get("fingerprint"), review.get("scope")
        if (
            isinstance(scope, str) and scope in _SCOPES
            and isinstance(digest, str) and _DIGEST.fullmatch(digest)
            and fingerprint(row) == digest
        ):
            approved.append(row)
    return approved
