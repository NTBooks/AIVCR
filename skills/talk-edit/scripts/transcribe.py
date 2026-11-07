"""Transcribe every take in takes.txt with word times (faster-whisper, small.en, VAD).
Writes, per take <name>:  audio16/<name>.wav (16 kHz mono, the louder channel, for the cut's loudness analysis)
                          words/<name>.json  [{"w", "s", "e"}]   (word, start, end in take seconds)
                          transcript_<name>.txt                  (one line per phrase with its time, to read and plan from)
usage: python transcribe.py [project dir]     (takes.txt lines: "<name> <path to the recording>")
Put names and words whisper gets wrong in prompt.txt (one line); it nudges the spelling while transcribing."""
import json, os, pathlib, subprocess, sys
import numpy as np

R = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
TAKES = [l.split(" ", 1) for l in (R / "takes.txt").read_text(encoding="utf8").splitlines() if l.strip() and not l.startswith("#")]
PROMPT = (R / "prompt.txt").read_text(encoding="utf8").strip() if (R / "prompt.txt").exists() else None
(R / "audio16").mkdir(exist_ok=True); (R / "words").mkdir(exist_ok=True)

from faster_whisper import WhisperModel
model = WhisperModel(os.environ.get("WHISPER_MODEL", "small.en"), device="cpu", compute_type="int8")
for name, path in TAKES:
    path = path.strip(); wav = R / "audio16" / f"{name}.wav"; mark = R / "audio16" / f"{name}.src"
    if not wav.exists() or not mark.exists() or mark.read_text(encoding="utf8") != path:   # takes.txt may now point the name at a retake
        # the louder channel only: some mics put a -6 dB copy (or nothing) on the other one
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vn", "-ac", "2", "-ar", "16000", "-f", "f32le", "-"], capture_output=True, check=True).stdout
        a = np.frombuffer(raw, np.float32).reshape(-1, 2); ch = 0 if a[:, 0].std() >= a[:, 1].std() else 1
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", path, "-af", f"pan=mono|c0=c{ch}", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], check=True)
        mark.write_text(path, encoding="utf8")
    segs, _ = model.transcribe(str(wav), word_timestamps=True, vad_filter=True, initial_prompt=PROMPT)
    words, lines = [], []
    for s in segs:
        lines.append(f"{int(s.start // 60)}:{s.start % 60:05.2f}  {s.text.strip()}")
        words += [{"w": w.word.strip(), "s": round(w.start, 3), "e": round(w.end, 3)} for w in s.words]
    (R / "words" / f"{name}.json").write_text(json.dumps(words), encoding="utf8")
    (R / f"transcript_{name}.txt").write_text("\n".join(lines), encoding="utf8")
    print(f"{name}: {len(words)} words, {len(lines)} phrases -> transcript_{name}.txt", flush=True)
