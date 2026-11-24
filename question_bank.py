"""Persistent catalog of translated questions and their original wording."""

import os
import unicodedata
from collections.abc import Collection, Iterable, Sequence
from contextlib import contextmanager
from dataclasses import dataclass, fields
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from threading import Lock

from sqlalchemy import (
    JSON, Boolean, Column, DateTime, Index, Integer, MetaData, String, Table, Text,
    URL, create_engine, func, or_, select, text,
)
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.schema import CreateIndex, CreateTable


class QuestionBankUnavailable(RuntimeError):
    pass


class QuestionBankConflict(RuntimeError):
    pass


ARCHIVED_CATEGORY = "Arkiverad"


@dataclass(frozen=True)
class BankQuestion:
    id: str
    key: str
    source: str
    language: str
    category: str | None
    difficulty: str | None
    original_question: str
    original_correct: str
    original_incorrect: Sequence[str]
    question: str
    correct: str
    incorrect: Sequence[str]
    revision: int = 1
    edited: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


_table = Table(
    "question_bank",
    MetaData(),
    Column("id", String(32), primary_key=True),
    Column("key", String(32), nullable=False),
    Column("source", Text, nullable=False),
    Column("language", String(16), nullable=False),
    Column("category", String(32)),
    Column("difficulty", String(16)),
    Column("original_question", Text, nullable=False),
    Column("original_correct", Text, nullable=False),
    Column("original_incorrect", JSON, nullable=False),
    Column("question", Text, nullable=False),
    Column("correct", Text, nullable=False),
    Column("incorrect", JSON, nullable=False),
    Column("revision", Integer, nullable=False),
    Column("edited", Boolean, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("updated_at", DateTime(timezone=True), nullable=False),
    Column("original_search", Text, nullable=False),
    Column("translated_search", Text, nullable=False),
)
Index("question_bank_category_difficulty_idx", _table.c.category, _table.c.difficulty)
Index("question_bank_updated_at_idx", _table.c.updated_at)
_columns = tuple(field.name for field in fields(BankQuestion))
_question_select = select(*(_table.c[name] for name in _columns))
_report_table = Table(
    "question_reports",
    MetaData(),
    Column("id", String(32), primary_key=True),
    Column("question_key", String(32), nullable=False),
    Column("question", Text, nullable=False),
    Column("correct", Text, nullable=False),
    Column("incorrect", JSON, nullable=False),
    Column("source", Text, nullable=False),
    Column("created_at", DateTime(timezone=True), nullable=False),
    Column("resolved_at", DateTime(timezone=True)),
)
_engine_lock = Lock()
_default_path = Path(__file__).resolve().parent / "data" / "question-bank.sqlite3"
_batch_size = 300


def bank_enabled() -> bool:
    return bool(
        os.getenv("QUESTION_BANK_DATABASE_URL", "").strip()
        or os.getenv("QUESTION_BANK_PATH", "").strip()
        or not (os.getenv("RENDER") or os.getenv("RENDER_SERVICE_ID"))
    )


def _configured_url() -> URL:
    configured = os.getenv("QUESTION_BANK_DATABASE_URL", "").strip()
    if not configured:
        setting = os.getenv("QUESTION_BANK_PATH", "").strip()
        path = Path(setting).expanduser().resolve() if setting else _default_path
        return URL.create("sqlite", database=str(path))

    try:
        url = make_url(configured)
    except ValueError as error:
        raise QuestionBankUnavailable("Frågebankens anslutningsadress är ogiltig.") from error
    if url.drivername in {"postgres", "postgresql"}:
        url = url.set(drivername="postgresql+psycopg")
    if url.drivername not in {"sqlite", "sqlite+pysqlite", "postgresql+psycopg"}:
        raise QuestionBankUnavailable("Frågebanken stöder SQLite och PostgreSQL.")
    return url


@lru_cache(maxsize=4)
def _engine_for(url: URL):
    if url.get_backend_name() == "sqlite":
        if not url.database or url.database == ":memory:":
            raise QuestionBankUnavailable("Frågebanken behöver en plats där frågorna kan sparas.")
        Path(url.database).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        connect_args = {"timeout": 5}
    else:
        connect_args = {} if "connect_timeout" in url.query else {"connect_timeout": 3}
    engine = create_engine(url, pool_pre_ping=True, pool_timeout=5, connect_args=connect_args)
    try:
        with engine.begin() as connection:
            if connection.dialect.name == "postgresql":
                connection.execute(text("SELECT pg_advisory_xact_lock(624233994)"))
            connection.execute(CreateTable(_table, if_not_exists=True))
            for index in _table.indexes:
                connection.execute(CreateIndex(index, if_not_exists=True))
            connection.execute(CreateTable(_report_table, if_not_exists=True))
    except (SQLAlchemyError, OSError):
        engine.dispose()
        raise
    return engine


@contextmanager
def _connection():
    if not bank_enabled():
        yield None
        return
    try:
        url = _configured_url()
        with _engine_lock:
            engine = _engine_for(url)
        with engine.begin() as connection:
            yield connection
    except (SQLAlchemyError, OSError, ImportError) as error:
        raise QuestionBankUnavailable("Frågebanken är tillfälligt otillgänglig.") from error


def _fold(value: str) -> str:
    return unicodedata.normalize("NFKC", value).casefold()


def _search_text(*parts: str) -> str:
    return _fold("\n".join(parts))


def _as_question(row) -> BankQuestion:
    values = dict(row)
    values["original_incorrect"] = tuple(values["original_incorrect"])
    values["incorrect"] = tuple(values["incorrect"])
    for name in ("created_at", "updated_at"):
        if values[name].tzinfo is None:
            values[name] = values[name].replace(tzinfo=UTC)
    return BankQuestion(**values)


def lookup_questions(ids: Iterable[str]) -> dict[str, BankQuestion]:
    distinct = list(dict.fromkeys(ids))
    if not distinct:
        return {}
    with _connection() as connection:
        if connection is None:
            return {}
        found = {}
        for start in range(0, len(distinct), _batch_size):
            batch = distinct[start:start + _batch_size]
            statement = _question_select.where(_table.c.id.in_(batch))
            for row in connection.execute(statement).mappings():
                found[row["id"]] = _as_question(row)
        return found


def store_questions(records: Iterable[BankQuestion]) -> None:
    if not bank_enabled():
        return
    now = datetime.now(UTC)
    values = []
    for record in records:
        row = {name: getattr(record, name) for name in _columns}
        row.update(
            original_incorrect=list(record.original_incorrect),
            incorrect=list(record.incorrect),
            revision=1,
            edited=False,
            created_at=now,
            updated_at=now,
            original_search=_search_text(
                record.id, record.source, record.language,
                record.original_question, record.original_correct, *record.original_incorrect,
            ),
            translated_search=_search_text(record.question, record.correct, *record.incorrect),
        )
        values.append(row)
    if not values:
        return
    with _connection() as connection:
        if connection is None:
            return
        insert = postgres_insert if connection.dialect.name == "postgresql" else sqlite_insert
        statement = insert(_table).on_conflict_do_nothing(index_elements=[_table.c.id])
        for start in range(0, len(values), _batch_size):
            connection.execute(statement, values[start:start + _batch_size])


def fallback_questions(
    category: str = "",
    difficulty: str = "",
    limit: int = 200,
    *,
    exclude: Collection[str] = (),
    sources: Collection[str] | None = None,
) -> list[BankQuestion]:
    if limit <= 0 or sources is not None and not sources:
        return []
    statement = _question_select.where(
        or_(_table.c.category.is_(None), _table.c.category != ARCHIVED_CATEGORY)
    ).order_by(func.random())
    if category:
        statement = statement.where(_table.c.category == category)
    if difficulty:
        statement = statement.where(_table.c.difficulty == difficulty)
    if sources is not None:
        statement = statement.where(_table.c.source.in_(sources))
    excluded = set(exclude)
    if len(excluded) <= _batch_size:
        if excluded:
            statement = statement.where(_table.c.key.not_in(excluded))
        statement = statement.limit(limit)

    with _connection() as connection:
        if connection is None:
            return []
        questions = []
        for row in connection.execute(statement).mappings():
            if row["key"] in excluded:
                continue
            questions.append(_as_question(row))
            if len(questions) == limit:
                break
        return questions


def list_questions(query: str = "", limit: int = 50, offset: int = 0) -> list[BankQuestion]:
    if limit <= 0:
        return []
    statement = _question_select.order_by(_table.c.updated_at.desc(), _table.c.id).limit(limit).offset(offset)
    term = _fold(query.strip())
    if term:
        statement = statement.where(or_(
            _table.c.key == term,
            _table.c.original_search.contains(term, autoescape=True),
            _table.c.translated_search.contains(term, autoescape=True),
        ))
    with _connection() as connection:
        if connection is None:
            return []
        return [_as_question(row) for row in connection.execute(statement).mappings()]


def update_question(
    id: str, *, question: str, correct: str, incorrect: Sequence[str], revision: int
) -> BankQuestion | None:
    if not bank_enabled():
        return None
    question, correct = question.strip(), correct.strip()
    wrong = [answer.strip() for answer in incorrect]
    if not question or len(wrong) != 3 or not all((correct, *wrong)):
        raise ValueError("Ange en fråga, ett rätt svar och tre felaktiga svar.")
    if len({_fold(answer) for answer in (correct, *wrong)}) != 4:
        raise ValueError("Alla svarsalternativ måste vara olika.")

    identity = _table.c.id == id
    statement = _table.update().where(identity, _table.c.revision == revision).values(
        question=question,
        correct=correct,
        incorrect=wrong,
        revision=revision + 1,
        edited=True,
        updated_at=datetime.now(UTC),
        translated_search=_search_text(question, correct, *wrong),
    )
    with _connection() as connection:
        if connection is None:
            return None
        updated = connection.execute(statement).rowcount
        row = connection.execute(_question_select.where(identity)).mappings().one_or_none()
        if row is None:
            return None
        if updated != 1:
            raise QuestionBankConflict("Frågan har ändrats sedan du öppnade den. Hämta senaste versionen.")
        return _as_question(row)


def store_question_report(id: str, *, question_key: str, question: str, correct: str,
                          incorrect: Sequence[str], source: str) -> bool:
    with _connection() as connection:
        if connection is None:
            return False
        insert = postgres_insert if connection.dialect.name == "postgresql" else sqlite_insert
        statement = insert(_report_table).values(
            id=id, question_key=question_key, question=question, correct=correct,
            incorrect=list(incorrect), source=source, created_at=datetime.now(UTC),
        ).on_conflict_do_nothing(index_elements=[_report_table.c.id])
        connection.execute(statement)
        return True


def list_question_reports() -> list[dict]:
    statement = select(_report_table).where(_report_table.c.resolved_at.is_(None)).order_by(
        _report_table.c.created_at.desc(), _report_table.c.id,
    ).limit(100)
    with _connection() as connection:
        if connection is None:
            return []
        return [dict(row) for row in connection.execute(statement).mappings()]


def resolve_question_report(id: str) -> bool:
    statement = _report_table.update().where(
        _report_table.c.id == id, _report_table.c.resolved_at.is_(None),
    ).values(resolved_at=datetime.now(UTC))
    with _connection() as connection:
        return connection is not None and connection.execute(statement).rowcount == 1
