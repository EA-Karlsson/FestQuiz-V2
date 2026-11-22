import io
import os
import random
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlencode

import qrcode
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field
from qrcode.image.pure import PyPNGImage

from questions import QuestionUnavailable, get_questions


app = FastAPI(title="FestQuiz")
root = Path(__file__).resolve().parent
bearer = HTTPBearer(auto_error=False)
round_seconds = 30
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
class Question:
    id: str
    text: str
    choices: list[str]
    correct_choice: int


@dataclass
class Room:
    code: str
    host_token: str
    expires_at: float
    host_ready: bool = False
    starting: bool = False
    phase: Literal["lobby", "question", "result", "finished"] = "lobby"
    players: dict[str, Player] = field(default_factory=dict)
    questions: list[Question] = field(default_factory=list)
    current_question: int = 0
    answers: dict[str, int] = field(default_factory=dict)
    deadline: float | None = None


rooms: dict[str, Room] = {}
room_lock = threading.Lock()
question_lock = threading.Lock()
recent_questions: deque[str] = deque(maxlen=250)


class JoinInput(BaseModel):
    name: str = Field(min_length=1, max_length=32)


class StartInput(BaseModel):
    amount: int = Field(ge=5, le=20)
    category: str = ""
    difficulty: str = ""
    hostName: str | None = Field(default=None, min_length=1, max_length=32)


class AnswerInput(BaseModel):
    questionId: str = Field(min_length=1, max_length=32)
    choice: int = Field(strict=True, ge=0, le=3)


def token_from(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> str | None:
    if credentials and credentials.credentials.isascii():
        return credentials.credentials
    return None


Token = Annotated[str | None, Depends(token_from)]


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


def require_available_name(room: Room, name: str) -> None:
    if any(player.name.casefold() == name.casefold() for player in room.players.values()):
        raise HTTPException(409, "Namnet används redan. Välj ett annat.")


def deal_questions(amount: int, category: str, difficulty: str) -> list[dict]:
    if category not in category_values or difficulty not in difficulty_values:
        raise HTTPException(400, "Välj en kategori och svårighetsgrad från listan.")
    with question_lock:
        seen = tuple(recent_questions)
    try:
        questions = get_questions(amount, category, difficulty, seen)
    except QuestionUnavailable as error:
        raise HTTPException(503, str(error)) from error
    if len(questions) != amount:
        raise HTTPException(503, "Det gick inte att hämta tillräckligt många frågor.")
    with question_lock:
        recent_questions.extend(question["key"] for question in questions)
    return questions


def shuffle_question(source: dict) -> Question:
    choices = [source["correct"], *source["incorrect"]]
    random.shuffle(choices)
    return Question(
        id=secrets.token_urlsafe(9),
        text=source["question"],
        choices=choices,
        correct_choice=choices.index(source["correct"]),
    )


def open_question(room: Room) -> None:
    room.phase = "question"
    room.answers.clear()
    room.deadline = time.time() + round_seconds


def reveal_question(room: Room) -> None:
    correct_choice = room.questions[room.current_question].correct_choice
    for token, answer in room.answers.items():
        if answer == correct_choice:
            room.players[token].score += 1
    room.phase = "result"
    room.deadline = None


def check_deadline(room: Room) -> None:
    if room.deadline is not None and time.time() >= room.deadline:
        reveal_question(room)


def view_state(room: Room, token: str | None) -> dict:
    check_deadline(room)
    question = None
    if room.phase in {"question", "result"}:
        current = room.questions[room.current_question]
        question = {
            "id": current.id,
            "text": current.text,
            "choices": current.choices,
            "correctChoice": current.correct_choice if room.phase == "result" else None,
        }
    players = sorted(room.players.values(), key=lambda player: -player.score)
    return {
        "code": room.code,
        "phase": room.phase,
        "hostReady": room.host_ready,
        "starting": room.starting,
        "players": [{"name": player.name, "score": player.score} for player in players],
        "question": question,
        "current": room.current_question + 1 if room.questions else 0,
        "total": len(room.questions),
        "answered": len(room.answers),
        "deadline": room.deadline,
        "yourChoice": room.answers.get(token),
        "canAnswer": (
            room.phase == "question" and token in room.players and token not in room.answers
        ),
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
    amount: Annotated[int, Query(ge=1, le=20)] = 10,
    category: str = "",
    difficulty: str = "",
):
    return [
        {
            "question": question["question"],
            "correct_answer": question["correct"],
            "incorrect_answers": question["incorrect"],
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
            require_available_name(room, host_name)
        if host_name is None and not room.players:
            raise HTTPException(409, "Vänta tills minst en spelare har gått med.")
        room.starting = True

    try:
        questions = [
            shuffle_question(question)
            for question in deal_questions(
                submission.amount, submission.category, submission.difficulty
            )
        ]
        with room_lock:
            active_room(code)
            if host_name is not None:
                room.players[host_token] = Player(host_name)
            room.questions = questions
            open_question(room)
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
        if room.phase not in {"question", "result"}:
            raise HTTPException(409, "Frågan är inte längre aktuell.")

        question = room.questions[room.current_question]
        if question.id != submission.questionId:
            raise HTTPException(409, "Frågan är inte längre aktuell.")
        if token in room.answers and room.answers[token] == submission.choice:
            return view_state(room, token)
        if room.phase != "question":
            raise HTTPException(409, "Svarstiden är slut.")
        if token in room.answers:
            raise HTTPException(409, "Du har redan svarat på frågan.")

        room.answers[token] = submission.choice
        if len(room.answers) == len(room.players):
            reveal_question(room)
        return view_state(room, token)


@app.post("/api/rooms/{code}/reveal")
def reveal_answer(code: str, token: Token):
    with room_lock:
        room = active_room(code)
        require_host(room, token)
        if room.phase == "question":
            reveal_question(room)
        if room.phase != "result":
            raise HTTPException(409, "Det finns ingen fråga att rätta.")
        return view_state(room, token)


@app.post("/api/rooms/{code}/next")
def next_question(code: str, token: Token):
    with room_lock:
        room = active_room(code)
        require_host(room, token)
        check_deadline(room)
        if room.phase != "result":
            raise HTTPException(409, "Visa rätt svar först.")

        if room.current_question + 1 == len(room.questions):
            room.phase = "finished"
            room.answers.clear()
        else:
            room.current_question += 1
            open_question(room)
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
