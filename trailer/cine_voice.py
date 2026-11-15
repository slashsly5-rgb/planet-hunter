"""Voice and timing for the cinematic trailer (v4): fewer words, a calm pace, music between the lines.
The pace is fixed (a little slower than normal) and never raised to make things fit: if the script is too long it stops, and the words get cut.
Writes vo0.wav ... and timing.json (frames per scene, when each line starts, the game-flight window, the title time).
usage: python cine_voice.py <out-dir> [voice]      (needs: pip install edge-tts imageio-ffmpeg numpy; needs internet)"""
import asyncio, json, os, subprocess, sys, wave
import numpy as np
import edge_tts, imageio_ffmpeg

OUT = sys.argv[1]
VOICE = sys.argv[2] if len(sys.argv) > 2 else "en-US-AndrewNeural"
RATE = "-6%"                       # calm, a touch slower than the voice's normal speed
LINES = [
    "NASA's Sphere X telescope maps the whole sky, again and again.",
    "Hidden in those pictures, worlds are moving.",
    "Planet Hunter lets anyone see them.",
    "Blink. Time lapse. A 3D time stack.",
    "Hunt them, like an astronomer.",
    "Fly to the edge of the Solar System.",
    "Real NASA data. Free, for everyone.",
    "Planet Hunter. Find what moves.",
]
FPS, TOTAL = 24, 30.0
PRE, TAIL = 1.4, 1.6               # music alone before the first word, and after the last
GAP_MIN, GAP_MAX = 0.45, 1.1       # breathing room after each line
FLIGHT_LINE = 5                    # the scene with the space game: the music gets a heartbeat there
FF = imageio_ffmpeg.get_ffmpeg_exe()

def seconds(path):
    w = wave.open(path); a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(int); loud = np.where(abs(a) > 300)[0]
    return (loud[-1] - loud[0]) / w.getframerate() + 0.15

async def speak():
    out = []
    for i, text in enumerate(LINES):
        mp3, wav = os.path.join(OUT, f"vo{i}.mp3"), os.path.join(OUT, f"vo{i}.wav")
        for attempt in range(5):                      # the online voice service sometimes returns nothing; wait and ask again
            try: await edge_tts.Communicate(text, VOICE, rate=RATE).save(mp3); break
            except Exception as e:
                if attempt == 4: raise
                print("  voice service gave no audio, retrying:", type(e).__name__); await asyncio.sleep(4 + attempt * 4)
        subprocess.run([FF, "-y", "-loglevel", "error", "-i", mp3, "-ac", "1", "-ar", "44100", wav], check=True); os.remove(mp3)
        out.append(seconds(wav))
    return out

async def main():
    d = await speak()
    room = TOTAL - PRE - TAIL - sum(d)
    gap = min(GAP_MAX, room / (len(d) - 1))
    words = sum(len(x.split()) for x in LINES)
    print(f"{words} words, {sum(d):.1f} s of speech at {RATE}: {words / sum(d):.2f} words a second; pause after each line {gap:.2f} s")
    if gap < GAP_MIN: sys.exit(f"TOO LONG by {(GAP_MIN - gap) * (len(d) - 1):.1f} s: cut words, do not speed up")
    starts = [PRE]
    for x in d[:-1]: starts.append(starts[-1] + x + gap)
    cuts = [0] + [s - 0.25 for s in starts[1:]] + [TOTAL]                 # each scene starts just before its line
    frames = [round(b * FPS) - round(a * FPS) for a, b in zip(cuts, cuts[1:])]
    json.dump({"frames": frames, "starts": starts, "title": starts[-1] - 0.25, "flight": [cuts[FLIGHT_LINE], cuts[FLIGHT_LINE + 1]], "rate": RATE},
              open(os.path.join(OUT, "timing.json"), "w"))
    for i, x in enumerate(d): print(f"line {i}: starts {starts[i]:5.2f} s, spoken {x:4.2f} s, scene {frames[i] / FPS:4.2f} s")

asyncio.run(main())
