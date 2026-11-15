"""Synthesises a 30-second trailer soundtrack: a low drone, hits on the cuts, risers, a driving pulse under the game footage.
usage: python make-audio.py out.wav      (needs numpy; no audio files are used)"""
import sys, wave
import numpy as np

SR, DUR = 44100, 30.0
t = np.arange(int(SR * DUR)) / SR
out = np.zeros_like(t)
rng = np.random.default_rng(7)

def env(t0, attack, decay):
    """0 before t0, quick rise, exponential fall."""
    x = t - t0
    return np.where(x < 0, 0, np.minimum(1, x / attack) * np.exp(-np.maximum(0, x - attack) / decay))

def hit(t0, amp=1.0, f0=46, decay=1.3):
    """Trailer 'boom': a sub tone that drops in pitch, plus a burst of filtered noise."""
    x = np.maximum(0, t - t0)
    sub = np.sin(2 * np.pi * (f0 * x + 22 * (1 - np.exp(-x * 5)) / 5))
    noise = np.convolve(rng.standard_normal(len(t)), np.ones(60) / 60, mode="same") * 6
    return amp * (sub * env(t0, 0.004, decay) + 0.5 * noise * env(t0, 0.002, 0.18))

def riser(t0, t1, amp=0.5):
    """Noise and a rising tone that swell up to a cut."""
    k = np.clip((t - t0) / (t1 - t0), 0, 1)
    on = (t >= t0) & (t < t1)
    tone = np.sin(2 * np.pi * np.cumsum(120 + 900 * k ** 2) / SR)
    noise = np.convolve(rng.standard_normal(len(t)), np.ones(8) / 8, mode="same")
    return amp * on * k ** 2.2 * (0.6 * tone + 0.9 * noise)

# drone: two detuned low notes with slow movement, the whole way through
drone = 0.5 * np.sin(2 * np.pi * 55 * t) + 0.4 * np.sin(2 * np.pi * 55.6 * t) + 0.25 * np.sin(2 * np.pi * 82.4 * t + np.sin(t * 0.7))
drone += 0.12 * np.sin(2 * np.pi * 110 * t) * (0.5 + 0.5 * np.sin(2 * np.pi * 0.21 * t))
out += 0.22 * drone * np.minimum(1, t / 1.5)

# high shimmer over the galaxy
out += 0.05 * np.sin(2 * np.pi * 880 * t + 3 * np.sin(2 * np.pi * 0.5 * t)) * np.clip(1 - t / 6, 0, 1) * np.minimum(1, t / 1)

# cuts (seconds): galaxy 0, dive 2.25, arrive 6.25, Saturn 7.5, hunt 9.75, found 11.25, voyage card 12.5, flight 13.75, fly-past 20.25, Planet X 22.75, title 25.5
for when, amp in [(0.15, 0.8), (6.25, 0.9), (9.75, 0.8), (12.5, 1.0), (20.25, 0.8), (22.75, 0.7), (25.5, 1.25)]:
    out += hit(when, amp)
out += riser(2.25, 6.25, 0.45) + riser(11.3, 12.5, 0.35) + riser(22.75, 25.5, 0.6)
out += 0.25 * np.sin(2 * np.pi * 1320 * t) * env(11.25, 0.003, 0.25)          # a 'found it' ping

# driving pulse under the flight: eighth notes at 132 beats a minute, with an accent on each beat
beat = 60 / 132 / 2
for i in range(int((20.25 - 13.75) / beat)):
    t0 = 13.75 + i * beat
    note = 55 * (1.5 if i % 8 in (6, 7) else 1)
    x = np.maximum(0, t - t0)
    out += (0.34 if i % 2 == 0 else 0.2) * np.sign(np.sin(2 * np.pi * note * x)) * np.sin(2 * np.pi * note * x) ** 2 * env(t0, 0.004, 0.09)
    if i % 2 == 0:
        out += 0.1 * rng.standard_normal(len(t)) * env(t0, 0.001, 0.02)             # a tick

# final chord under the title, then fade
for f, a in [(55, 0.3), (110, 0.22), (164.8, 0.16), (220, 0.12), (277.2, 0.08)]:
    out += a * np.sin(2 * np.pi * f * t) * env(25.5, 0.02, 2.6)
out *= np.clip((DUR - t) / 1.8, 0, 1)

out = np.tanh(out * 1.3)                    # gentle limiting
out = out / np.max(np.abs(out)) * 0.92
with wave.open(sys.argv[1], "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((out * 32767).astype("<i2").tobytes())
print("wrote", sys.argv[1], f"{DUR:.0f} s")
