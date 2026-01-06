from fastapi.responses import FileResponse, RedirectResponse, Response  # + Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import requests
import os
import html
import re
from collections import deque, defaultdict
import hashlib

# 🔽 NYTT – krävs för backend-QR
import qrcode
from io import BytesIO
# 🔼 NYTT

DEDUP_MAX = 300  # justerbart 200–300
seen_questions = deque(maxlen=DEDUP_MAX)  # FIFO
seen_by_category = defaultdict(deque)     # per kategori, FIFO

def question_hash(question_text: str, options: dict) -> str:
    payload = question_text.strip() + "|" + "|".join(
        f"{k}:{options[k]}" for k in sorted(options)
    )
    return hashlib.sha1(payload.encode("utf-8")).hexdigest()

# ================== APP & CACHE ==================

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================== STATIC FILES ==================

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

app.mount(
    "/static",
    StaticFiles(directory=BASE_DIR, html=True),
    name="static"
)

# ================== V2 ROOMS (IN-MEMORY) ==================

import random
import string
import uuid
from fastapi import HTTPException

ROOMS = {}

def generate_room_code(length=4):
    return "".join(
        random.choices(string.ascii_uppercase + string.digits, k=length)
    )

TRANSLATION_CACHE: dict[str, str] = {}

DEEPL_KEY = os.getenv("DEEPL_API_KEY")
DEEPL_URL = "https://api-free.deepl.com/v2/translate"

# ================== HJÄLPREGLER ==================

VERB_HINTS = {" is ", " are ", " was ", " were ", " did ", " does ", " has ", " have "}

MEDIA_KEYWORDS = [
    "film", "movie", "album", "song", "track", "music",
    "band", "artist", "series", "tv",
    "drake", "beatles", "daft punk", "nirvana",
    "portal", "half-life", "mirror's edge",
    "låten", "albumet", "bandet", "artisten",
    "tv-serien"
]

GAME_KEYWORDS = [
    "game", "video game", "zombies", "call of duty",
    "warcraft", "world of warcraft", "wow",
    "level", "mission", "stage", "nivå",
    "weapon", "gun", "rifle", "crossbow",
    "item", "perk", "ability", "stone",
    "pack-a-punch", "pack a punch"
]

# ================== DETEKTION ==================

def looks_like_name_or_title(text: str) -> bool:
    words = text.strip().split()
    if len(words) > 5:
        return False

    lower = f" {text.lower()} "
    if any(v in lower for v in VERB_HINTS):
        return False

    caps_ratio = sum(1 for c in text if c.isupper()) / max(len(text), 1)
    return caps_ratio > 0.3


def length_diff_too_big(original: str, translated: str) -> bool:
    if not original or not translated:
        return True
    diff = abs(len(original) - len(translated)) / len(original)
    return diff > 0.6


def is_media_question(text: str) -> bool:
    t = text.lower()
    return any(k in t for k in MEDIA_KEYWORDS)


def is_game_question(text: str) -> bool:
    t = text.lower()
    return any(k in t for k in GAME_KEYWORDS)


def looks_like_quote(text: str) -> bool:
    return '"' in text or "'" in text or len(text.split()) > 6

# ================== NORMALISERING ==================

def normalize_numbers(text: str) -> str:
    if not text:
        return text

    replacements = {
        r"Less than (\d+)\s*Thousand": r"Mindre än \1 000",
        r"(\d+)\s*Thousand": r"\1 000",
        r"(\d+)\s*Million": r"\1 miljon",
    }

    for pattern, repl in replacements.items():
        text = re.sub(pattern, repl, text, flags=re.IGNORECASE)

    return text

# ================== ÖVERSÄTTNING ==================

def deepl_translate(text: str) -> str:
    if not DEEPL_KEY or not text:
        return text

    if text in TRANSLATION_CACHE:
        return TRANSLATION_CACHE[text]

    try:
        r = requests.post(
            DEEPL_URL,
            data={
                "auth_key": DEEPL_KEY,
                "text": text,
                "target_lang": "SV"
            },
            timeout=5
        )
        data = r.json()
        translated = data["translations"][0]["text"]
        TRANSLATION_CACHE[text] = translated
        return translated
    except Exception:
        TRANSLATION_CACHE[text] = text
        return text


def smart_translate(text: str) -> str:
    if not text or len(text.strip()) < 2:
        return text

    if looks_like_name_or_title(text):
        return text

    translated = deepl_translate(text)

    if translated == text:
        return text

    if length_diff_too_big(text, translated):
        return text

    return translated

# ================== V2 ROOM API ==================

import time
from fastapi import Body, HTTPException

def maybe_lock_answers(room_data):
    timer = room_data.get("timer")
    if not timer:
        return

    if room_data.get("answers_locked"):
        return

    ends_at = timer.get("ends_at")
    if not ends_at:
        return

    now = time.time()
    if now >= ends_at:
        room_data["answers_locked"] = True
        room_data["phase"] = "locked"


@app.post("/room/create")
def create_room(host_plays: bool = False):
    code = generate_room_code()

    ROOMS[code] = {
        "code": code,
        "host_plays": host_plays,
        "players": {},
        "started": False,
        "current_question": None,
        "difficulty": "medium",
        "timer": None,
        "phase": "idle",
        "answers_locked": False,
        "last_result": None,
        "final_results": []
    }

    return {
        "roomCode": code,
        "host_plays": host_plays
    }

@app.post("/room/join")
def join_room(room: str, name: str):
    room_code = room.upper()
    room_data = ROOMS.get(room_code)

    if not room_data:
        raise HTTPException(status_code=404, detail="Room not found")

    if room_data["started"]:
        raise HTTPException(status_code=400, detail="Game already started")

    # Unika spelnamn (case-insensitive)
    for p in room_data["players"].values():
        if p["name"].lower() == name.lower():
            raise HTTPException(status_code=400, detail="Name already taken")

    player_id = str(uuid.uuid4())[:8]

    room_data["players"][player_id] = {
        "id": player_id,
        "name": name,
        "score": 0,
        "answers": []
    }

    return {
        "playerId": player_id,
        "roomCode": room_code,
        "name": name
    }

@app.post("/room/start")
def start_room(room: str, payload: dict = Body(default={})):
    room_code = room.upper()
    room_data = ROOMS.get(room_code)

    if not room_data:
        raise HTTPException(status_code=404, detail="Room not found")

    room_data["started"] = True
    room_data["difficulty"] = payload.get("difficulty", "medium")

    # ✅ SPARA VALD KATEGORI (DETTA VAR DET SOM SAKNADES)
    room_data["category_name"] = payload.get("category", "Allmänbildning")

    # Nollställ spelstate
    room_data["current_question"] = None
    room_data["timer"] = None
    room_data["phase"] = "idle"
    room_data["answers_locked"] = False

    # Nollställ spelardata
    for player in room_data["players"].values():
        player["answers"] = []
        player["score"] = 0

    return {"status": "started", "roomCode": room_code}

@app.post("/room/question")
def set_question(room: str, question: dict):
    import json
    import time

    room_code = room.upper()
    room_data = ROOMS.get(room_code)

    if not room_data:
        raise HTTPException(status_code=404, detail="Room not found")

    # ===== KATEGORI =====
    question["category"] = room_data.get("category_name", "Allmänbildning")

    # ===== STABILT FRÅGE-ID =====
    if not question.get("id"):
        canonical = json.dumps(
            question,
            sort_keys=True,
            ensure_ascii=False,
            separators=(",", ":")
        )
        question["id"] = hashlib.sha1(
            canonical.encode("utf-8")
        ).hexdigest()[:10]

    room_data["current_question"] = question

    # ===== ANSWER-SLOTS (KRITISKT) =====
    for player in room_data["players"].values():
        player["answers"].append({
            "question_id": question["id"],
            "answer": None
        })

    DIFFICULTY_SECONDS = {
        "easy": 25,
        "medium": 20,
        "hard": 15
    }

    difficulty = question.get("difficulty") or room_data.get("difficulty", "medium")
    seconds = DIFFICULTY_SECONDS.get(difficulty, 20)

    now = time.time()
    room_data["timer"] = {"ends_at": now + seconds}
    room_data["phase"] = "question"
    room_data["answers_locked"] = False

    return {
        "status": "question_set",
        "roomCode": room_code,
        "question_id": question["id"],
        "difficulty": difficulty,
        "seconds": seconds
    }

@app.post("/room/answer")
def submit_answer(room: str, player_id: str, answer: str):
    room_code = room.upper()
    room_data = ROOMS.get(room_code)

    if not room_data:
        raise HTTPException(status_code=404, detail="Room not found")

    if room_data.get("answers_locked"):
        raise HTTPException(status_code=400, detail="Answers are locked")

    if not room_data.get("current_question"):
        raise HTTPException(status_code=400, detail="No active question")

    player = room_data["players"].get(player_id)
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    if answer not in ["A", "B", "C", "D"]:
        raise HTTPException(status_code=400, detail="Invalid answer")

    current_q = room_data["current_question"]
    current_q_id = current_q.get("id")

    if not player["answers"]:
        raise HTTPException(status_code=400, detail="Answer slot not initialized")

    last_answer = player["answers"][-1]

    if last_answer["question_id"] != current_q_id:
        raise HTTPException(status_code=400, detail="Answer mismatch")

    # tillåt byte av svar tills timer låser
    last_answer["answer"] = answer

    return {"status": "answer_received"}

@app.get("/room/{code}")
def get_room(code: str):
    import time

    room = ROOMS.get(code.upper())
    if not room:
        raise HTTPException(status_code=404, detail="Room not found")

    # AUTO-LOCK NÄR TIMER GÅTT UT
    if room.get("timer") and not room.get("answers_locked") and room.get("phase") == "question":
        ends_at = room["timer"].get("ends_at")
        if ends_at and time.time() >= ends_at:
            room["answers_locked"] = True
            room["phase"] = "locked"

            correct_letter = room["current_question"].get("correct_letter")
            options = room["current_question"].get("options", {})
            correct_text = options.get(correct_letter, "")

            right = 0
            wrong = 0
            right_players = []
            wrong_players = []

            for p in room["players"].values():
                ans_letter = p["answers"][-1]["answer"]
                ans_text = options.get(ans_letter, "") if ans_letter else ""

                entry = {
                    "name": p["name"],
                    "answer_letter": ans_letter,
                    "answer_text": ans_text
                }

                if ans_letter == correct_letter:
                    right += 1
                    right_players.append(entry)
                    p["score"] += 1
                else:
                    wrong += 1
                    wrong_players.append(entry)

            room["last_result"] = {
                "right": right,
                "wrong": wrong
            }

            if (
                not room.get("final_results")
                or room["final_results"][-1]["question_id"]
                != room["current_question"].get("id")
            ):
                room["final_results"].append({
                    "question_id": room["current_question"].get("id"),
                    "question": room["current_question"].get("question"),
                    "category": room["current_question"].get("category"),
                    "correct_letter": correct_letter,
                    "correct_text": correct_text,
                    "right_players": right_players,
                    "wrong_players": wrong_players
                })

    # ✅ RANKING ENDAST NÄR SCOREBOARD VISAS
    if room.get("phase") == "scoreboard":
        players = list(room["players"].items())
        players.sort(key=lambda x: x[1]["score"], reverse=True)

        ranks = {}
        last_score = None
        current_rank = 0

        for index, (pid, p) in enumerate(players):
            if p["score"] != last_score:
                current_rank = index + 1
                last_score = p["score"]
            ranks[pid] = current_rank

        room["player_ranks"] = ranks
        room["player_count"] = len(players)

    return room

# ✅ EXPLICIT SCOREBOARD-TRIGGER (HOST / TV)
@app.post("/room/scoreboard")
def show_scoreboard(room: str):
    room_code = room.upper()
    room_data = ROOMS.get(room_code)

    if not room_data:
        raise HTTPException(status_code=404, detail="Room not found")

    room_data["phase"] = "scoreboard"
    room_data["answers_locked"] = True

    return {"status": "scoreboard", "roomCode": room_code}

# ================== QR-KOD (SERVER-SIDE PNG) ==================

from fastapi import Request
from fastapi.responses import Response, HTMLResponse
from io import BytesIO
import qrcode

def make_qr_png(target_url: str) -> Response:
    img = qrcode.make(target_url)
    buf = BytesIO()
    img.save(buf)
    buf.seek(0)
    return Response(content=buf.getvalue(), media_type="image/png")

@app.get("/qr/{room}/host.png")
def get_host_qr(room: str, request: Request):
    room = room.upper()
    base = str(request.base_url).rstrip("/")
    target_url = f"{base}/static/host_entry.html?room={room}"
    return make_qr_png(target_url)

@app.get("/qr/{room}/player.png")
def get_player_qr(room: str, request: Request):
    room = room.upper()
    base = str(request.base_url).rstrip("/")
    target_url = f"{base}/static/join.html?room={room}"
    return make_qr_png(target_url)

# ================== HOST READY (ORÖRD) ==================

from fastapi import Body

@app.post("/room/host_ready")
def set_host_ready(room: str, payload: dict = Body(default={})):
    room_code = room.upper()
    room_data = ROOMS.get(room_code)

    if not room_data:
        raise HTTPException(status_code=404, detail="Room not found")

    room_data["host_plays"] = bool(payload.get("host_plays", False))
    room_data["host_ready"] = True   # 🔑 SIGNAL TILL TV

    return {"status": "ok", "roomCode": room_code, "host_ready": True}

# ================== RESET (ORÖRD) ==================

@app.post("/room/reset")
def reset_room(room: str):
    room_code = room.upper()
    room_data = ROOMS.get(room_code)

    if not room_data:
        raise HTTPException(status_code=404, detail="Room not found")

    room_data["started"] = False
    room_data["current_question"] = None
    room_data["timer"] = None
    room_data["phase"] = "idle"
    room_data["answers_locked"] = False
    room_data["last_result"] = None
    room_data["final_results"] = []
    room_data["host_ready"] = False

    room_data.pop("player_ranks", None)
    room_data.pop("player_count", None)

    room_data["difficulty"] = None

    for player in room_data["players"].values():
        player["answers"] = []
        player["score"] = 0

    return {"status": "reset", "roomCode": room_code}

# ================== TV START (MINIMAL ÄNDRING) ==================

@app.get("/", response_class=HTMLResponse)
def serve_start(request: Request):
    room = request.query_params.get("room")
    code = room.upper() if room else generate_room_code()

    if code not in ROOMS:
        ROOMS[code] = {
            "code": code,
            "host_plays": False,
            "players": {},
            "started": False,
            "current_question": None,
            "difficulty": "medium",
            "timer": None,
            "phase": "idle",
            "answers_locked": False,
            "last_result": None,
            "final_results": [],
            "host_ready": False
        }

    with open(os.path.join(BASE_DIR, "start.html"), "r", encoding="utf-8") as f:
        html = f.read()

    return html.replace(
        "{{QR_SRC}}",
        f"https://festquiz-v2.onrender.com/qr/{code}/host.png"
    )

@app.get("/start.html")
def serve_start_html():
    return FileResponse(os.path.join(BASE_DIR, "start.html"))

# ================== HOST ENTRY (ORÖRD) ==================

@app.get("/host")
def host_entry():
    code = generate_room_code()

    ROOMS[code] = {
        "code": code,
        "host_plays": False,
        "players": {},
        "started": False,
        "current_question": None,
        "difficulty": "medium",
        "timer": None,
        "phase": "idle",
        "answers_locked": False,
        "last_result": None,
        "final_results": [],
        "host_ready": False
    }

    return RedirectResponse(url=f"/static/host_entry.html?room={code}")

# ================== API ==================

@app.get("/quiz")
def quiz(
    amount: int = 10,
    category: str = "",
    difficulty: str = ""
):
    API_MAX = 50
    url = f"https://opentdb.com/api.php?amount={amount}&type=multiple"

    if category:
        url += f"&category={category}"

    if difficulty:
        url += f"&difficulty={difficulty}"

    questions = []
    skipped_dedup = 0
    fetched_total = 0

    # ================== OPEN TDB ==================
    data = requests.get(url).json()
    api_questions = data.get("results", [])
    random.shuffle(api_questions)

    def handle_question(q):
        nonlocal skipped_dedup, fetched_total

        fetched_total += 1

        raw_question = html.unescape(q["question"])
        raw_correct = html.unescape(q["correct_answer"])
        raw_incorrect = [html.unescape(a) for a in q["incorrect_answers"]]

        question_text = smart_translate(raw_question)

        if is_game_question(raw_question):
            correct = raw_correct
            incorrect = raw_incorrect
        elif is_media_question(raw_question):
            correct = raw_correct
            incorrect = raw_incorrect
        else:
            if looks_like_quote(raw_correct):
                correct = raw_correct
            else:
                correct = normalize_numbers(smart_translate(raw_correct))

            incorrect = []
            for a in raw_incorrect:
                if looks_like_quote(a):
                    incorrect.append(a)
                else:
                    incorrect.append(normalize_numbers(smart_translate(a)))

        q_hash = question_hash(question_text, {
            "correct": correct,
            **{f"i{i}": v for i, v in enumerate(incorrect)}
        })

        if q_hash in seen_questions:
            skipped_dedup += 1
            return

        seen_questions.append(q_hash)
        seen_by_category[category or "unknown"].append(q_hash)

        questions.append({
            "question": question_text,
            "correct_answer": correct,
            "incorrect_answers": incorrect
        })

    for q in api_questions:
        handle_question(q)
        if len(questions) >= amount:
            break

    return questions

    # ================== THE TRIVIA API (FALLBACK) ==================
    if len(questions) < amount:
        try:
            trivia_url = f"https://the-trivia-api.com/api/questions?limit={API_MAX}"
            if difficulty:
                trivia_url += f"&difficulty={difficulty}"

            trivia_data = requests.get(trivia_url, timeout=5).json()
            random.shuffle(trivia_data)

            for q in trivia_data:
                mapped = {
                    "question": q.get("question", ""),
                    "correct_answer": q.get("correctAnswer", ""),
                    "incorrect_answers": q.get("incorrectAnswers", [])
                }
                handle_question(mapped)
                if len(questions) >= amount:
                    break
        except Exception:
            pass

    # ===== DEDUP-VERIFIERING (TILLFÄLLIG LOGG) =====
    print(
        f"[QUIZ] fetched={fetched_total} "
        f"dedup_skipped={skipped_dedup} "
        f"returned={len(questions)}"
    )

    return questions
