"""Speaks the trailer script with one of Microsoft's natural-sounding online voices (the ones behind Edge's Read Aloud),
one WAV per line, each sped up only as much as needed to fit its scene.
usage: python voice_neural.py <out-dir> [voice]      (needs: pip install edge-tts imageio-ffmpeg; needs internet)
Note: the script text is sent to Microsoft's speech service to be spoken."""
import asyncio, os, subprocess, sys, wave
import edge_tts, imageio_ffmpeg

OUT = sys.argv[1]
VOICE = sys.argv[2] if len(sys.argv) > 2 else "en-US-AndrewNeural"
LINES = [
    "Planet Hunter. Dive from the Milky Way to our Solar System.",
    "Every world in its real place. Click anything.",
    "Hunt: detect what moves in real Sphere X images, predict it, classify it.",
    "Explore in three colours, time lapse, and a 3D time stack.",
    "Run a computer scan, compare six months apart, measure it yourself.",
    "Planet X lab: why it hides.",
    "Fly the Voyage: dodge, shoot, scan ten real worlds, stack images to find Planet X.",
    "In English and Malay, on computer or phone, with a classroom sheet.",
]
SCENES = [0, 83, 149, 253, 348, 433, 475, 604, 720]            # frame where each line's scene starts (24 frames a second)
ROOM = [(SCENES[i + 1] - SCENES[i]) / 24 - 0.3 for i in range(len(LINES))]   # seconds available for each line
FF = imageio_ffmpeg.get_ffmpeg_exe()

def spoken_seconds(path):
    import numpy as np
    w = wave.open(path); a = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2"); loud = np.where(abs(a.astype(int)) > 300)[0]
    return (loud[-1] - loud[0]) / w.getframerate()

async def say(i, text, rate):
    mp3, wav = os.path.join(OUT, f"vo{i}.mp3"), os.path.join(OUT, f"vo{i}.wav")
    await edge_tts.Communicate(text, VOICE, rate=f"{rate:+d}%").save(mp3)
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", mp3, "-ac", "1", "-ar", "44100", wav], check=True)
    os.remove(mp3)
    return spoken_seconds(wav)

async def main():
    for i, text in enumerate(LINES):
        rate = 10; d = await say(i, text, rate)      # every line starts at the same gentle pace
        for _ in range(3):                                   # speed up only if it overruns its scene
            if d <= ROOM[i]: break
            rate = min(60, int((d * (1 + rate / 100) / ROOM[i] - 1) * 100) + 3); d = await say(i, text, rate)
        print(f"line {i}: {d:4.2f} s spoken, {ROOM[i]:4.2f} s available, speed {rate:+d}%")

asyncio.run(main())
