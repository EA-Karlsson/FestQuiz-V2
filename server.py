from fastapi.middleware.cors import CORSMiddleware
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
import requests
import os
import html
import re

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

@app.post("/room/create")
def create_room(host_plays: bool = False):
    code = generate_room_code()

    ROOMS[code] = {
        "code": code,
        "host_plays": host_plays,
        "players": {},
        "started": False
    }

    return {"roomCode": code}


@app.get("/room/{code}")
def get_room(code: str):
    room = ROOMS.get(code.upper())

    if not room:
        return {"error": "Room not found"}

    return room

@app.post("/room/join")
def join_room(room: str, name: str):
    room_code = room.upper()
    room_data = ROOMS.get(room_code)

    if not room_data:
        raise HTTPException(status_code=404, detail="Room not found")

    if room_data["started"]:
        raise HTTPException(status_code=400, detail="Game already started")

    player_id = str(uuid.uuid4())[:8]

    room_data["players"][player_id] = {
        "id": player_id,
        "name": name,
        "score": 0
    }

    return {
        "playerId": player_id,
        "roomCode": room_code,
        "name": name
    }

# ================== API ==================

@app.get("/quiz")
def quiz(
    amount: int = 10,
    category: str = "",
    difficulty: str = ""
):
    url = f"https://opentdb.com/api.php?amount={amount}&type=multiple"

    if category:
        url += f"&category={category}"

    if difficulty:
        url += f"&difficulty={difficulty}"

    data = requests.get(url).json()
    questions = []

    for q in data["results"]:
        raw_question = html.unescape(q["question"])
        raw_correct = html.unescape(q["correct_answer"])
        raw_incorrect = [html.unescape(a) for a in q["incorrect_answers"]]

        question_text = smart_translate(raw_question)

        # 🎮 SPEL → ALLA SVAR ORÖRDA (ENGELSKA)
        if is_game_question(raw_question):
            correct = raw_correct
            incorrect = raw_incorrect

        # 🎬 MEDIA → SVAR ORÖRDA
        elif is_media_question(raw_question):
            correct = raw_correct
            incorrect = raw_incorrect

        # 📚 FAKTA / ALLMÄNBILDNING
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

        questions.append({
            "question": question_text,
            "correct_answer": correct,
            "incorrect_answers": incorrect
        })

    return questions
