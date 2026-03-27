#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import tempfile
from faster_whisper import WhisperModel


def sh(cmd):
    return subprocess.check_output(cmd, text=True).strip()


def duration_sec(path: str) -> float:
    out = sh([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=nk=1:nw=1", path
    ])
    return float(out)


def to_wav_mono16(src: str, dst: str):
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", src, "-ac", "1", "-ar", "16000", dst
    ], check=True)


def transcribe_file(model: WhisperModel, path: str) -> str:
    segments, _ = model.transcribe(
        path,
        vad_filter=True,
        language="en",
        beam_size=1,
        best_of=1,
        condition_on_previous_text=False,
    )
    return " ".join(s.text.strip() for s in segments).strip()


def split_chunks(wav: str, chunk_sec: int, pattern: str):
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", wav,
        "-f", "segment", "-segment_time", str(chunk_sec), "-c", "copy", pattern
    ], check=True)


def main():
    ap = argparse.ArgumentParser(description="Auto STT: direct for short audio, chunk+merge for long audio")
    ap.add_argument("input")
    ap.add_argument("--threshold-sec", type=int, default=60)
    ap.add_argument("--chunk-sec", type=int, default=45)
    ap.add_argument("--model", default="tiny.en")
    ap.add_argument("--compute-type", default="int8")
    ap.add_argument("--json", action="store_true", dest="as_json")
    args = ap.parse_args()

    dur = duration_sec(args.input)
    model = WhisperModel(args.model, device="cpu", compute_type=args.compute_type)

    with tempfile.TemporaryDirectory(prefix="stt_auto_") as td:
        wav = os.path.join(td, "in.wav")
        to_wav_mono16(args.input, wav)

        if dur <= args.threshold_sec:
            text = transcribe_file(model, wav)
            mode = "direct"
            chunks = 1
        else:
            pat = os.path.join(td, "chunk_%03d.wav")
            split_chunks(wav, args.chunk_sec, pat)
            files = sorted(
                os.path.join(td, f)
                for f in os.listdir(td)
                if f.startswith("chunk_") and f.endswith(".wav")
            )
            parts = [transcribe_file(model, f) for f in files]
            text = " ".join(p for p in parts if p).strip()
            mode = "chunked"
            chunks = len(files)

    if args.as_json:
        print(json.dumps({
            "mode": mode,
            "durationSec": dur,
            "chunks": chunks,
            "text": text,
        }, ensure_ascii=False))
    else:
        print(f"MODE: {mode}")
        print(f"DURATION_SEC: {dur:.2f}")
        print(f"CHUNKS: {chunks}")
        print("TEXT:", text if text else "[no speech detected]")


if __name__ == "__main__":
    main()
