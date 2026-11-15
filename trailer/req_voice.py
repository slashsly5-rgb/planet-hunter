"""Voice and timing for the second video, which answers the challenge requirement by requirement.
Speaks each line with a natural Microsoft voice at one even pace, chosen so the whole script fits 30 seconds,
then writes timing.json: how many video frames each line gets.
usage: python req_voice.py <out-dir> [voice]      (needs: pip install edge-tts imageio-ffmpeg numpy; needs internet)"""
import asyncio, json, os, subprocess, sys, wave
import numpy as np
import edge_tts, imageio_ffmpeg

OUT = sys.argv[1]
VOICE = sys.argv[2] if len(sys.argv) > 2 else "en-US-AndrewNeural"
LINES = [
    "The challenge: a public web tool showing Sphere X sky images, so anyone can see how they change over time.",
    "Planet Hunter is free and public, on computer or phone.",
    "It shows sixty real Sphere X images of ten worlds, checked with NASA.",
    "See change in one click: blink two dates, play a time lapse, compare six months apart, or turn a 3D stack.",
    "Easy for anyone: a three step hunt and a space game.",
    "And honest: every world is already known.",
    "Planet Hunter. Try it now.",
]
FPS, TOTAL, GAP = 24, 30.0, 0.28
FF = imageio_ffmpeg.get_ffmpeg_exe()

def seconds(path):
    w = wave.open(path); a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(int); loud = np.where(abs(a) > 300)[0]
    return (loud[-1] - loud[0]) / w.getframerate()

async def speak(rate):
    out = []
    for i, text in enumerate(LINES):
        mp3, wav = os.path.join(OUT, f"vo{i}.mp3"), os.path.join(OUT, f"vo{i}.wav")
        for attempt in range(5):                      # the online voice service sometimes returns nothing; wait and ask again
            try: await edge_tts.Communicate(text, VOICE, rate=f"{rate:+d}%").save(mp3); break
            except Exception as e:
                if attempt == 4: raise
                print("  voice service gave no audio, retrying:", type(e).__name__); await asyncio.sleep(4 + attempt * 4)
        subprocess.run([FF, "-y", "-loglevel", "error", "-i", mp3, "-ac", "1", "-ar", "44100", wav], check=True); os.remove(mp3)
        out.append(seconds(wav))
    return out

async def main():
    rate = 8; d = await speak(rate)
    for _ in range(3):                                 # one pace for every line, raised only until the script fits
        need = sum(d) + GAP * len(d) + 0.8             # 0.8 s of title after the last word
        print(f"speed {rate:+d}%: {sum(d):.1f} s of speech, {need:.1f} s needed")
        if need <= TOTAL: break
        rate = int(((1 + rate / 100) * need / TOTAL - 1) * 100) + 3; d = await speak(rate)
    frames = [round((x + GAP) * FPS) for x in d]; frames[-1] = int(TOTAL * FPS) - sum(frames[:-1])
    starts = [sum(frames[:i]) / FPS for i in range(len(frames))]
    half = frames[4] // 2
    json.dump({"frames": frames, "starts": starts, "title": starts[-1], "flight": [starts[4] + half / FPS, starts[5]], "rate": rate},
              open(os.path.join(OUT, "timing.json"), "w"))
    for i, x in enumerate(d): print(f"line {i}: {x:4.2f} s spoken, scene {frames[i] / FPS:4.2f} s")

asyncio.run(main())
