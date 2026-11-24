from __future__ import annotations

import hashlib
import io
import json
import logging
import os
import tempfile
import threading
import time
import wave
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from textwrap import wrap

import requests


@dataclass(frozen=True)
class NarrationClip:
    audio: bytes
    duration: float


_LOGGER = logging.getLogger(__name__)
_MODEL_URL = (
    "https://huggingface.co/rhasspy/piper-voices/resolve/"
    "e5349433ed883a32f893a434dc43a6c66b95ef7c/sv/sv_SE/alma/medium/"
)
_MODEL = "sv_SE-alma-medium.onnx"
_MODEL_FILES = {
    _MODEL: (63_434_611, "f75455eb6afeb1db9e2905d5bd7e4115afcd3710e0d399b6a40981766d32fedc"),
    _MODEL + ".json": (8_192, "6924380892f769afa92fc6b28ff91d558690d7fb4e3ef8cbf821cefadc8f38fe"),
}
_CACHE_DIR = Path(__file__).resolve().parent / "data" / "voice"
_MAX_CLIP_SECONDS = 18
_MAX_PENDING = 12
_MAX_CACHED = 40
_POOL = ThreadPoolExecutor(max_workers=1, thread_name_prefix="festquiz-voice")
_LOCK = threading.Lock()
_pending: dict[str, Future[NarrationClip | None]] = {}
_clips: OrderedDict[str, NarrationClip] = OrderedDict()
_warmup: Future | None = None
_voice = None
_retry_at = 0.0


def _enabled() -> bool:
    return os.getenv("FESTQUIZ_VOICE_DISABLED", "").lower() not in {"1", "true"}


def _model_file(name: str) -> Path:
    limit, expected_hash = _MODEL_FILES[name]
    path = _CACHE_DIR / name
    if path.is_file() and path.stat().st_size <= limit:
        with path.open("rb") as existing:
            if hashlib.file_digest(existing, "sha256").hexdigest() == expected_hash:
                return path

    _CACHE_DIR.mkdir(parents=True, exist_ok=True)
    expires_at = time.monotonic() + 55
    digest = hashlib.sha256()
    size = 0
    with tempfile.NamedTemporaryFile(dir=_CACHE_DIR, delete=False) as target:
        temporary = Path(target.name)
        try:
            with requests.get(_MODEL_URL + name, stream=True, timeout=(5, 10)) as response:
                response.raise_for_status()
                for chunk in response.iter_content(256 * 1024):
                    size += len(chunk)
                    if size > limit or time.monotonic() > expires_at:
                        raise ValueError("Röstmodellen överskred nedladdningsgränsen.")
                    digest.update(chunk)
                    target.write(chunk)
            if digest.hexdigest() != expected_hash:
                raise ValueError("Röstmodellens kontrollsumma stämmer inte.")
            target.close()
            temporary.replace(path)
        finally:
            temporary.unlink(missing_ok=True)
    return path


def _load_voice():
    global _voice, _retry_at
    if _voice is not None or time.monotonic() < _retry_at:
        return _voice
    try:
        from onnxruntime import InferenceSession, SessionOptions
        from piper import PiperConfig, PiperVoice

        model = _model_file(_MODEL)
        config = _model_file(_MODEL + ".json")
        options = SessionOptions()
        options.intra_op_num_threads = 1
        options.inter_op_num_threads = 1
        options.enable_cpu_mem_arena = False
        options.enable_mem_pattern = False
        session = InferenceSession(str(model), sess_options=options, providers=["CPUExecutionProvider"])
        _voice = PiperVoice(session=session, config=PiperConfig.from_dict(json.loads(config.read_text(encoding="utf-8"))))
    except Exception:
        _retry_at = time.monotonic() + 45
        _LOGGER.warning("Den svenska rösten kunde inte laddas.", exc_info=True)
    return _voice


def warm_narration() -> None:
    global _warmup
    if not _enabled():
        return
    with _LOCK:
        if _voice is None and time.monotonic() >= _retry_at and (_warmup is None or _warmup.done()):
            _warmup = _POOL.submit(_load_voice)


def _synthesize(text: str) -> NarrationClip | None:
    voice = _load_voice()
    if voice is None:
        return None
    try:
        audio = io.BytesIO()
        duration = 0.0
        with wave.open(audio, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(voice.config.sample_rate)
            # Short phrases keep ONNX's working memory within the web service's limit.
            for line in wrap(text, width=112, break_long_words=False, break_on_hyphens=False):
                for chunk in voice.synthesize(line):
                    duration += chunk.audio_int16_array.size / chunk.sample_rate
                    if duration > _MAX_CLIP_SECONDS:
                        return None
                    wav.writeframesraw(chunk.audio_int16_bytes)
        return NarrationClip(audio.getvalue(), duration) if duration else None
    except Exception:
        _LOGGER.warning("En quizfråga kunde inte läsas upp.", exc_info=True)
        return None


def _cache_clip(text: str, finished: Future[NarrationClip | None]) -> None:
    with _LOCK:
        _pending.pop(text, None)
        if not finished.cancelled() and (clip := finished.result()) is not None:
            _clips[text] = clip
            if len(_clips) > _MAX_CACHED:
                _clips.popitem(last=False)


def prepare_narration(text: str) -> Future[NarrationClip | None] | None:
    text = " ".join(text.split())
    if not _enabled() or not text or len(text) > 360:
        return None
    with _LOCK:
        if text in _clips:
            _clips.move_to_end(text)
            cached = Future()
            cached.set_result(_clips[text])
            return cached
        if text in _pending:
            return _pending[text]
        if len(_pending) >= _MAX_PENDING:
            return None
        future = _POOL.submit(_synthesize, text)
        _pending[text] = future
    future.add_done_callback(lambda finished: _cache_clip(text, finished))
    return future
