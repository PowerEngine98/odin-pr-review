"""
Kokoro, speaking for Odin over stdin and stdout.

One JSON object per line each way. The first line out says the model is loaded;
after that every request {"id", "text", "voice"?, "speed"?, "lang"?} is answered
with {"id", "ok": true, "audio": <base64 WAV>} or {"id", "ok": false, "error"}.

Run with the model, the voices, a default voice and a default speed. Kept alive
between sentences because loading the model is the slow part.
"""

import base64
import io
import json
import sys
import wave

import numpy as np
from kokoro_onnx import Kokoro


def wav(samples, rate):
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    out = io.BytesIO()
    with wave.open(out, "wb") as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(rate)
        file.writeframes(pcm)
    return out.getvalue()


def answer(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


def main():
    model, voices, voice, speed = sys.argv[1:5]
    kokoro = Kokoro(model, voices)
    answer({"ready": True})
    for line in sys.stdin:
        try:
            asked = json.loads(line)
        except ValueError:
            continue
        try:
            samples, rate = kokoro.create(
                asked["text"],
                voice=asked.get("voice") or voice,
                speed=float(asked.get("speed") or speed),
                lang=asked.get("lang") or "en-us",
            )
            audio = base64.b64encode(wav(samples, rate)).decode("ascii")
            answer({"id": asked.get("id"), "ok": True, "audio": audio})
        except Exception as error:
            answer({"id": asked.get("id"), "ok": False, "error": str(error)})


if __name__ == "__main__":
    main()
