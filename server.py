import io
import os
import random
import secrets
import threading
import time
from collections import deque
from collections.abc import Collection
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlencode

import qrcode
from fastapi import Depends, FastAPI, HTTPException, Path as PathParam, Query, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from qrcode.image.pure import PyPNGImage

import question_bank
from questions import NewQuestionsUnavailable, QuestionUnavailable, get_questions, valid_question_edit


app = FastAPI(title="FestQuiz")
root = Path(__file__).resolve().parent
bearer = HTTPBearer(auto_error=False)
default_round_seconds = 20
max_questions = 30
room_lifetime = 6 * 60 * 60
room_limit = 200
player_limit = 50
category_values = {"", "9", "11", "12", "15", "17", "21", "22", "23", "modern"}
difficulty_values = {"", "easy", "medium", "hard"}
room_code_symbols = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


@dataclass
class Player:
    name: str
    score: int = 0


@dataclass
class SeriesPlayer:
    name: str
    places: list[dict[str, int]] = field(default_factory=list)


@dataclass
class Question:
    id: str
    text: str
    choices: list[str]
    correct_choice: int
    source: str
    answers: dict[str, int] = field(default_factory=dict)


@dataclass
class Room:
    code: str
    host_token: str
    expires_at: float
    host_ready: bool = False
    starting: bool = False
    phase: Literal["lobby", "question", "closed", "finished", "review"] = "lobby"
    players: dict[str, Player] = field(default_factory=dict)
    questions: list[Question] = field(default_factory=list)
    current_question: int = 0
    review_question: int = 0
    seconds: int = default_round_seconds
    deadline: float | None = None
    used_question_keys: set[str] = field(default_factory=set)
    completed_rounds: int = 0
    series_players: dict[str, SeriesPlayer] = field(default_factory=dict)
    previous_host_name: str | None = None


rooms: dict[str, Room] = {}
room_lock = threading.Lock()
question_lock = threading.Lock()
recent_questions: deque[str] = deque(maxlen=250)


class JoinInput(BaseModel):
    name: str = Field(min_length=1, max_length=32)


class StartInput(BaseModel):
    amount: int = Field(ge=5, le=max_questions)
    category: str = ""
    difficulty: str = ""
    hostName: str | None = Field(default=None, min_length=1, max_length=32)
    seconds: Literal[15, 20, 30] = default_round_seconds
    allowRepeats: bool = Field(default=False, strict=True)


class AnswerInput(BaseModel):
    questionId: str = Field(min_length=1, max_length=32)
    choice: int = Field(strict=True, ge=0, le=3)


class ReviewInput(BaseModel):
    questionNumber: int = Field(strict=True, ge=1, le=max_questions)


BankText = Annotated[str, Field(min_length=1, max_length=1200)]


class QuestionBankEdit(BaseModel):
    question: BankText
    correct: BankText
    incorrect: Annotated[list[BankText], Field(min_length=3, max_length=3)]
    revision: int = Field(ge=1, strict=True)


def token_from(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> str | None:
    if credentials and credentials.credentials.isascii():
        return credentials.credentials
    return None


Token = Annotated[str | None, Depends(token_from)]


def bank_admin_key() -> str:
    key = os.getenv("QUESTION_BANK_ADMIN_KEY", "").strip()
    if question_bank.bank_enabled() and len(key) >= 24 and key.isascii() and key.isprintable():
        return key
    raise HTTPException(404, "Frågebanken är inte aktiverad.")


def require_bank_admin(token: Token, response: Response) -> None:
    key = bank_admin_key()
    if token is None or not secrets.compare_digest(token, key):
        raise HTTPException(401, "Skriv rätt redigeringslösenord för frågebanken.", headers={"Cache-Control": "no-store"})
    response.headers["Cache-Control"] = "no-store"


def bank_question_view(record: question_bank.BankQuestion) -> dict:
    return {
        "id": record.id,
        "source": record.source,
        "language": record.language,
        "category": record.category,
        "difficulty": record.difficulty,
        "original": {
            "question": record.original_question,
            "correct": record.original_correct,
            "incorrect": record.original_incorrect,
        },
        "question": record.question,
        "correct": record.correct,
        "incorrect": record.incorrect,
        "revision": record.revision,
    }


def active_room(code: str) -> Room:
    room = rooms.get(code.upper())
    if room is None or room.expires_at <= time.monotonic():
        raise HTTPException(404, "Spelrummet finns inte längre. Skapa ett nytt spel på TV:n.")
    return room


def require_host(room: Room, token: str | None) -> str:
    if token is None or not secrets.compare_digest(token, room.host_token):
        raise HTTPException(403, "Spelledarlänken krävs för det här.")
    return token


def normalized_name(value: str) -> str:
    name = " ".join(value.split())
    if not name or not name.isprintable():
        raise HTTPException(400, "Skriv ett namn för att gå med.")
    return name


def require_available_name(room: Room, name: str, except_token: str | None = None) -> None:
    normalized = name.casefold()
    if any(
        token != except_token and player.name.casefold() == normalized
        for roster in (room.players, room.series_players)
        for token, player in roster.items()
    ):
        raise HTTPException(409, "Namnet används redan. Välj ett annat.")


def deal_questions(
    amount: int,
    category: str,
    difficulty: str,
    *,
    exclude: Collection[str] = (),
    allow_repeats: bool = False,
) -> list[dict]:
    if category not in category_values or difficulty not in difficulty_values:
        raise HTTPException(400, "Välj en kategori och svårighetsgrad från listan.")
    with question_lock:
        recent = tuple(recent_questions)
    try:
        questions = get_questions(
            amount, category, difficulty, exclude=exclude, avoid_recent=recent, allow_repeats=allow_repeats
        )
    except NewQuestionsUnavailable as error:
        raise HTTPException(409, {
            "code": "new_questions_shortage",
            "message": str(error),
            "available": error.available,
        }) from error
    except QuestionUnavailable as error:
        raise HTTPException(503, str(error)) from error
    keys = [question["key"] for question in questions]
    unique = set(keys)
    blocked_repeats = not allow_repeats and not unique.isdisjoint(exclude)
    if len(keys) != amount or len(unique) != amount or blocked_repeats:
        raise HTTPException(503, "Det gick inte att hämta tillräckligt många frågor.")
    with question_lock:
        recent_questions.extend(keys)
    return questions


def shuffle_question(source: dict) -> Question:
    choices = [source["correct"], *source["incorrect"]]
    random.shuffle(choices)
    return Question(
        id=secrets.token_urlsafe(9),
        text=source["question"],
        choices=choices,
        correct_choice=choices.index(source["correct"]),
        source=source["source"],
    )


def open_question(room: Room) -> None:
    room.phase = "question"
    room.deadline = time.time() + room.seconds


def close_question(room: Room) -> None:
    question = room.questions[room.current_question]
    for token, answer in question.answers.items():
        if answer == question.correct_choice:
            room.players[token].score += 1
    room.phase = "closed"
    room.deadline = None


def check_deadline(room: Room) -> None:
    if room.deadline is not None and time.time() >= room.deadline:
        close_question(room)


def question_view(question: Question, *, reveal: bool) -> dict:
    return {
        "id": question.id,
        "text": question.text,
        "choices": question.choices,
        "correctChoice": question.correct_choice if reveal else None,
        "source": question.source if reveal else None,
    }


def place_for(score: int, players: Collection[Player]) -> int:
    return 1 + sum(player.score > score for player in players)


def record_round(room: Room) -> None:
    room.completed_rounds += 1
    players = room.players.values()
    for token, player in room.players.items():
        entry = room.series_players.setdefault(token, SeriesPlayer(player.name))
        entry.name = player.name
        entry.places.append({
            "round": room.completed_rounds,
            "place": place_for(player.score, players),
            "score": player.score,
        })
    host = room.players.get(room.host_token)
    room.previous_host_name = host.name if host is not None else None


def series_view(room: Room) -> dict:
    standings = [
        {
            "name": player.name,
            "wins": sum(placement["place"] == 1 for placement in player.places),
            "lastPlace": player.places[-1]["place"],
            "places": [placement.copy() for placement in player.places],
        }
        for player in room.series_players.values()
    ]
    standings.sort(key=lambda player: -player["wins"])
    return {"rounds": room.completed_rounds, "players": standings}


def view_state(room: Room, token: str | None) -> dict:
    check_deadline(room)
    current = room.questions[room.current_question] if room.phase in {"question", "closed"} else None
    answers = current.answers if current is not None else {}
    finished = room.phase in {"finished", "review"}
    players = list(room.players.values())
    if finished:
        players.sort(key=lambda player: -player.score)

    your_score = None
    your_place = None
    if finished and token in room.players:
        your_score = room.players[token].score
        your_place = place_for(your_score, players)

    review = None
    if room.phase == "review":
        reviewed = room.questions[room.review_question]
        review = {
            "current": room.review_question + 1,
            "total": len(room.questions),
            "question": question_view(reviewed, reveal=True),
            "answers": [
                {"name": player.name, "choice": reviewed.answers.get(credential)}
                for credential, player in room.players.items()
            ],
        }

    return {
        "code": room.code,
        "phase": room.phase,
        "hostReady": room.host_ready,
        "starting": room.starting,
        "players": [{"name": player.name, "score": player.score if finished else 0} for player in players],
        "question": question_view(current, reveal=False) if current is not None else None,
        "current": room.current_question + 1 if room.questions else 0,
        "total": len(room.questions),
        "answered": len(answers),
        "deadline": room.deadline,
        "yourChoice": answers.get(token),
        "canAnswer": room.phase == "question" and token in room.players and token not in answers,
        "yourPlace": your_place,
        "yourScore": your_score,
        "review": review,
        "roundNumber": room.completed_rounds if finished else room.completed_rounds + 1,
        "series": series_view(room) if room.completed_rounds and (finished or room.phase == "lobby") else None,
        "previousHostName": room.previous_host_name if secrets.compare_digest(token or "", room.host_token) else None,
    }


@app.get("/")
@app.get("/leda")
@app.get("/spela")
def play_page():
    return FileResponse(root / "play.html", headers={"Cache-Control": "no-cache"})


@app.get("/assets/play.js")
def play_script():
    return FileResponse(
        root / "play.compat.js",
        media_type="text/javascript",
        headers={"Cache-Control": "no-cache"},
    )


@app.get("/assets/play.css")
def play_style():
    return FileResponse(root / "play.css", media_type="text/css", headers={"Cache-Control": "no-cache"})


@app.get("/fragabank", include_in_schema=False)
def question_bank_page(_key: Annotated[str, Depends(bank_admin_key)]):
    return FileResponse(root / "question_bank.html", headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex"})


@app.get("/assets/question-bank.js", include_in_schema=False)
def question_bank_script():
    return FileResponse(root / "question_bank.js", media_type="text/javascript", headers={"Cache-Control": "no-cache"})


@app.get("/api/question-bank", dependencies=[Depends(require_bank_admin)], include_in_schema=False)
def read_question_bank(q: Annotated[str, Query(max_length=120)] = ""):
    try:
        records = question_bank.list_questions(q.strip())
    except question_bank.QuestionBankUnavailable as error:
        raise HTTPException(503, "Frågebanken är tillfälligt otillgänglig.") from error
    return {"questions": [bank_question_view(record) for record in records]}


@app.put("/api/question-bank/{question_id}", dependencies=[Depends(require_bank_admin)], include_in_schema=False)
def edit_bank_question(question_id: Annotated[str, PathParam(pattern=r"^[0-9a-f]{32}$")], submission: QuestionBankEdit):
    question = submission.question.strip()
    correct = submission.correct.strip()
    incorrect = [text.strip() for text in submission.incorrect]
    if not valid_question_edit(question, correct, incorrect):
        raise HTTPException(422, "Skriv en fråga och fyra olika svarsalternativ.")
    try:
        record = question_bank.update_question(
            question_id, question=question, correct=correct, incorrect=tuple(incorrect), revision=submission.revision,
        )
    except question_bank.QuestionBankConflict as error:
        raise HTTPException(409, "Frågan har ändrats sedan du öppnade den. Ladda om den innan du sparar.") from error
    except question_bank.QuestionBankUnavailable as error:
        raise HTTPException(503, "Frågebanken är tillfälligt otillgänglig.") from error
    if record is None:
        raise HTTPException(404, "Frågan finns inte längre.")
    return {"question": bank_question_view(record)}


@app.get("/solo")
def solo_page():
    return RedirectResponse("/static/index.html")


@app.get("/static/start.html", include_in_schema=False)
def old_tv_page():
    return RedirectResponse("/")


@app.get("/static/{filename}")
def solo_file(filename: Literal["index.html", "app.js", "style.css", "music.mp3"]):
    return FileResponse(root / filename)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/quiz")
def solo_quiz(
    amount: Annotated[int, Query(ge=1, le=max_questions)] = 10,
    category: str = "",
    difficulty: str = "",
):
    return [
        {
            "question": question["question"],
            "correct_answer": question["correct"],
            "incorrect_answers": question["incorrect"],
            "source": question["source"],
        }
        for question in deal_questions(amount, category, difficulty)
    ]


@app.post("/api/rooms", status_code=201)
def create_room():
    with room_lock:
        now = time.monotonic()
        expired = [code for code, room in rooms.items() if room.expires_at <= now]
        for code in expired:
            del rooms[code]
        if len(rooms) >= room_limit:
            raise HTTPException(503, "Just nu pågår för många spel. Försök igen om en stund.")

        code = "".join(secrets.choice(room_code_symbols) for _ in range(5))
        while code in rooms:
            code = "".join(secrets.choice(room_code_symbols) for _ in range(5))
        room = Room(code, secrets.token_urlsafe(32), now + room_lifetime)
        rooms[code] = room
        return {"code": code, "hostToken": room.host_token}


@app.get("/api/rooms/{code}")
def read_room(code: str, token: Token, response: Response):
    response.headers["Cache-Control"] = "no-store"
    with room_lock:
        return view_state(active_room(code), token)


@app.post("/api/rooms/{code}/claim")
def claim_host(code: str, token: Token):
    with room_lock:
        room = active_room(code)
        require_host(room, token)
        room.host_ready = True
        return view_state(room, token)


@app.post("/api/rooms/{code}/join", status_code=201)
def join_room(code: str, submission: JoinInput):
    with room_lock:
        room = active_room(code)
        if not room.host_ready:
            raise HTTPException(409, "Vänta tills spelledaren har gått med.")
        if room.phase != "lobby" or room.starting:
            raise HTTPException(409, "Spelet har redan startat.")
        if len(room.players) >= player_limit:
            raise HTTPException(409, "Spelrummet är fullt.")

        name = normalized_name(submission.name)
        require_available_name(room, name)
        token = secrets.token_urlsafe(32)
        room.players[token] = Player(name)
        return {"playerToken": token}


@app.post("/api/rooms/{code}/start")
def start_room(code: str, submission: StartInput, token: Token):
    with room_lock:
        room = active_room(code)
        host_token = require_host(room, token)
        if not room.host_ready:
            raise HTTPException(409, "Anslut som spelledare först.")
        if room.phase != "lobby" or room.starting:
            raise HTTPException(409, "Spelet har redan startat.")

        host_name = None
        if submission.hostName is not None:
            if len(room.players) >= player_limit:
                raise HTTPException(409, "Spelrummet är fullt.")
            host_name = normalized_name(submission.hostName)
            require_available_name(room, host_name, except_token=host_token)
        if host_name is None and not room.players:
            raise HTTPException(409, "Vänta tills minst en spelare har gått med.")
        room.starting = True
        used = frozenset(room.used_question_keys)

    try:
        dealt = deal_questions(
            submission.amount,
            submission.category,
            submission.difficulty,
            exclude=used,
            allow_repeats=submission.allowRepeats,
        )
        questions = [shuffle_question(question) for question in dealt]
        with room_lock:
            if active_room(code) is not room:
                raise HTTPException(404, "Spelrummet finns inte längre. Skapa ett nytt spel på TV:n.")
            if host_name is not None:
                room.players[host_token] = Player(host_name)
            room.questions = questions
            room.seconds = submission.seconds
            open_question(room)
            room.used_question_keys.update(question["key"] for question in dealt)
            room.starting = False
            return view_state(room, token)
    finally:
        with room_lock:
            room.starting = False


@app.post("/api/rooms/{code}/answer")
def submit_answer(code: str, submission: AnswerInput, token: Token):
    with room_lock:
        room = active_room(code)
        if token is None or token not in room.players:
            raise HTTPException(403, "Gå med i spelet för att svara.")
        check_deadline(room)
        if room.phase not in {"question", "closed"}:
            raise HTTPException(409, "Frågan är inte längre aktuell.")

        question = room.questions[room.current_question]
        if question.id != submission.questionId:
            raise HTTPException(409, "Frågan är inte längre aktuell.")
        if question.answers.get(token) == submission.choice:
            return view_state(room, token)
        if room.phase != "question":
            raise HTTPException(409, "Svarstiden är slut.")
        if token in question.answers:
            raise HTTPException(409, "Du har redan svarat på frågan.")

        question.answers[token] = submission.choice
        if len(question.answers) == len(room.players):
            close_question(room)
        return view_state(room, token)


@app.post("/api/rooms/{code}/reveal")
def close_room_question(code: str, token: Token):
    with room_lock:
        room = active_room(code)
        require_host(room, token)
        if room.phase == "question":
            close_question(room)
        if room.phase != "closed":
            raise HTTPException(409, "Det finns ingen fråga att stänga.")
        return view_state(room, token)


@app.post("/api/rooms/{code}/next")
def next_question(code: str, token: Token):
    with room_lock:
        room = active_room(code)
        require_host(room, token)
        check_deadline(room)
        if room.phase != "closed":
            raise HTTPException(409, "Stäng frågan först.")

        if room.current_question + 1 == len(room.questions):
            record_round(room)
            room.phase = "finished"
        else:
            room.current_question += 1
            open_question(room)
        return view_state(room, token)


@app.post("/api/rooms/{code}/review")
def review_room(code: str, submission: ReviewInput, token: Token):
    with room_lock:
        room = active_room(code)
        require_host(room, token)
        if room.phase not in {"finished", "review"}:
            raise HTTPException(409, "Visa slutställningen innan du öppnar facit.")
        if submission.questionNumber > len(room.questions):
            raise HTTPException(400, "Det frågenumret finns inte i spelet.")
        room.review_question = submission.questionNumber - 1
        room.phase = "review"
        return view_state(room, token)


@app.post("/api/rooms/{code}/new-round")
def new_round(code: str, token: Token):
    with room_lock:
        room = active_room(code)
        require_host(room, token)
        if room.phase not in {"finished", "review"}:
            raise HTTPException(409, "Spela klart omgången innan du startar en ny.")

        room.players.pop(room.host_token, None)
        for player in room.players.values():
            player.score = 0
        room.questions = []
        room.current_question = 0
        room.review_question = 0
        room.seconds = default_round_seconds
        room.deadline = None
        room.phase = "lobby"
        return view_state(room, token)


def qr_image(request: Request, path: str) -> Response:
    origin = os.getenv("RENDER_EXTERNAL_URL") or str(request.base_url)
    buffer = io.BytesIO()
    qrcode.make(origin.rstrip("/") + path, box_size=8, image_factory=PyPNGImage).save(buffer)
    return Response(
        buffer.getvalue(),
        media_type="image/png",
        headers={"Cache-Control": "no-store"},
    )


@app.post("/api/rooms/{code}/qr")
def host_qr(code: str, role: Literal["host"], token: Token, request: Request):
    with room_lock:
        room = active_room(code)
        host_token = require_host(room, token)
        path = f"/leda?{urlencode({'room': room.code})}#{urlencode({'token': host_token})}"
    return qr_image(request, path)


@app.get("/api/rooms/{code}/qr")
def player_qr(code: str, role: Literal["player"], request: Request):
    with room_lock:
        room = active_room(code)
        path = f"/spela?{urlencode({'room': room.code})}"
    return qr_image(request, path)
