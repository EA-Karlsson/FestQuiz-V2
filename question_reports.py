"""Signed reports for snapshots of the questions actually dealt in a quiz."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from collections.abc import Sequence

from questions import _BANK_SOURCES, _PARTY_FRENCH_SOURCE, _PARTY_SWEDISH_SOURCE


_reportable_sources = _BANK_SOURCES | {_PARTY_FRENCH_SOURCE, _PARTY_SWEDISH_SOURCE}
_local_key = secrets.token_bytes(32)
_ticket_lifetime = 6 * 60 * 60


def _signature(payload: str) -> str:
    admin_key = os.getenv("QUESTION_BANK_ADMIN_KEY", "").strip()
    key = hashlib.sha256(admin_key.encode()).digest() if admin_key else _local_key
    return hmac.new(key, ("FestQuiz question report\0" + payload).encode("ascii"), hashlib.sha256).hexdigest()


def report_ticket(key: str, question: str, correct: str, incorrect: Sequence[str], source: str) -> str | None:
    if source not in _reportable_sources:
        return None
    report = {
        "question_key": key, "question": question, "correct": correct,
        "incorrect": sorted(incorrect), "source": source, "expires": int(time.time()) + _ticket_lifetime,
    }
    payload = base64.urlsafe_b64encode(json.dumps(report, ensure_ascii=False, separators=(",", ":")).encode()).decode()
    return f"{payload}.{_signature(payload)}"


def verify_report_ticket(ticket: str) -> tuple[str, dict]:
    payload, separator, signature = ticket.partition(".")
    if not separator or not ticket.isascii() or not hmac.compare_digest(signature, _signature(payload)):
        raise ValueError("Rapportlänken är ogiltig.")
    report = json.loads(base64.urlsafe_b64decode(payload))
    if report.pop("expires") <= time.time():
        raise ValueError("Rapportlänken har gått ut. Öppna frågan på nytt.")
    snapshot = json.dumps(report, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.blake2b(snapshot.encode(), digest_size=16).hexdigest(), report
