import math
import random
import subprocess
import wave
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw
from mutagen.easyid3 import EasyID3
from mutagen.mp3 import MP3

BASE_DIR = Path(__file__).resolve().parent.parent
AUDIO_DIR = BASE_DIR / "media" / "audio"
VISUALS_DIR = BASE_DIR / "media" / "visuals"


def generate_demo_visual(force: bool = False) -> str:
    VISUALS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = VISUALS_DIR / "demo_lofi_sunset_4k.png"
    if out_path.exists() and not force:
        return "demo_lofi_sunset_4k.png"

    # Render in 4K Ultra HD (3840x2160)
    w, h = 3840, 2160
    img = Image.new("RGB", (w, h), (8, 6, 20))
    draw = ImageDraw.Draw(img)

    # 1. Sunset Sky Gradient (Rich colors)
    for y in range(h):
        ratio = y / h
        r = int(14 + 115 * math.pow(ratio, 1.25))
        g = int(8 + 38 * math.pow(ratio, 1.5))
        b = int(38 + 90 * (1 - ratio))
        draw.line([(0, y), (w, y)], fill=(r, g, b))

    # 2. Twinkling Stars
    random.seed(42)
    for _ in range(400):
        sx = random.randint(0, w)
        sy = random.randint(0, int(h * 0.58))
        s_bright = random.randint(170, 255)
        s_size = random.choice([1, 2, 3])
        draw.ellipse([sx, sy, sx + s_size, sy + s_size], fill=(s_bright, s_bright, random.randint(220, 255)))

    # 3. Massive Glowing Neon Sun
    sun_x, sun_y, sun_r = w // 2, int(h * 0.46), 420
    for r_glow in range(sun_r + 140, sun_r, -2):
        alpha = (r_glow - sun_r) / 140.0
        rg = int(255 * (1 - alpha * 0.7))
        gg = int(80 * (1 - alpha))
        bg = int(180 * (1 - alpha))
        draw.ellipse([sun_x - r_glow, sun_y - r_glow, sun_x + r_glow, sun_y + r_glow], fill=(rg, gg, bg))
    draw.ellipse([sun_x - sun_r, sun_y - sun_r, sun_x + sun_r, sun_y + sun_r], fill=(255, 230, 110))

    # Sun horizontal blinds
    for i in range(11):
        y_slice = sun_y + int(sun_r * 0.08) + i * 44
        draw.rectangle([sun_x - sun_r - 60, y_slice, sun_x + sun_r + 60, y_slice + 6 + int(i * 3.5)], fill=(22, 14, 38))

    # 4. Mountain Silhouettes
    mountains = [
        (0, 1480), (450, 1180), (900, 1340), (1450, 1080), 
        (1920, 1160), (2450, 1020), (2980, 1260), (3450, 1120), 
        (3840, 1380), (3840, 2160), (0, 2160)
    ]
    draw.polygon(mountains, fill=(14, 9, 26))

    # 5. Cyber Grid Floor
    grid_top = int(h * 0.68)
    draw.rectangle([0, grid_top, w, h], fill=(6, 5, 16))

    # Vertical perspective lines
    for x in range(0, w, 120):
        dest_x = int((x - w / 2) * 3.2 + w / 2)
        draw.line([(x, grid_top), (dest_x, h)], fill=(150, 60, 220), width=2)

    # Horizontal grid lines
    for i in range(1, 16):
        y = int(grid_top + math.pow(i / 16, 2.3) * (h - grid_top))
        draw.line([(0, y), (w, y)], fill=(160, 60, 240), width=2)

    img.save(str(out_path), quality=96)
    return "demo_lofi_sunset_4k.png"


def create_ambient_track(filename: str, chords: list, title: str, artist: str, duration_sec: int = 18) -> str:
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    out_path = AUDIO_DIR / filename
    if out_path.exists():
        return filename

    # 48,000 Hz Professional Broadcast Sample Rate
    sample_rate = 48000
    t = np.linspace(0, duration_sec, int(sample_rate * duration_sec), endpoint=False)
    left = np.zeros_like(t)
    right = np.zeros_like(t)
    chord_len = duration_sec / len(chords)

    for i, chord in enumerate(chords):
        idx_start = int(i * chord_len * sample_rate)
        idx_end = int((i + 1) * chord_len * sample_rate)
        t_chord = t[idx_start:idx_end] - (i * chord_len)

        fade_len = int(0.25 * sample_rate)
        env = np.ones(idx_end - idx_start)
        if len(env) > fade_len * 2:
            env[:fade_len] = np.linspace(0, 1, fade_len)
            env[-fade_len:] = np.linspace(1, 0, fade_len)

        for freq in chord:
            # Rich stereophonic harmonics
            sig_l = (
                0.5 * np.sin(2 * np.pi * freq * t_chord)
                + 0.25 * np.sin(2 * np.pi * (freq * 2) * t_chord)
                + 0.1 * np.sin(2 * np.pi * (freq * 3) * t_chord)
            )
            sig_r = (
                0.5 * np.sin(2 * np.pi * (freq * 1.002) * t_chord)
                + 0.25 * np.sin(2 * np.pi * (freq * 2.002) * t_chord)
                + 0.1 * np.sin(2 * np.pi * (freq * 3.002) * t_chord)
            )
            sub = 0.3 * np.sin(2 * np.pi * (freq / 2.0) * t_chord)
            
            left[idx_start:idx_end] += (sig_l + sub) * env
            right[idx_start:idx_end] += (sig_r + sub) * env

    # Warm analog tape noise
    noise_l = np.random.normal(0, 0.008, len(t))
    noise_r = np.random.normal(0, 0.008, len(t))
    left += noise_l
    right += noise_r

    max_val = max(np.max(np.abs(left)), np.max(np.abs(right))) + 1e-6
    left = (left / max_val * 0.85 * 32767).astype(np.int16)
    right = (right / max_val * 0.85 * 32767).astype(np.int16)

    stereo = np.empty((len(t) * 2,), dtype=np.int16)
    stereo[0::2] = left
    stereo[1::2] = right

    temp_wav = AUDIO_DIR / f"_temp_{filename}.wav"
    with wave.open(str(temp_wav), "w") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(stereo.tobytes())

    # Studio Master 320 kbps 48kHz
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(temp_wav), "-b:a", "320k", "-ar", "48000", str(out_path)],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    temp_wav.unlink(missing_ok=True)

    try:
        try:
            mp3 = MP3(str(out_path), ID3=EasyID3)
            mp3.add_tags(ID3=EasyID3)
        except Exception:
            pass
        tag = EasyID3(str(out_path))
        tag["title"] = title
        tag["artist"] = artist
        tag.save()
    except Exception:
        pass

    return filename


def ensure_demo_media():
    """Generates demo visuals and demo music if none exist."""
    vis_file = generate_demo_visual(force=False)

    chords1 = [
        [261.63, 329.63, 392.00, 493.88],  # Cmaj7
        [220.00, 261.63, 329.63, 392.00],  # Am7
        [174.61, 220.00, 261.63, 329.63],  # Fmaj7
        [196.00, 246.94, 293.66, 349.23],  # G7
    ]
    t1 = create_ambient_track("demo_midnight_coffee.mp3", chords1, "Midnight Coffee (4K Studio)", "Lofi Ambient Studio")

    chords2 = [
        [146.83, 220.00, 261.63, 349.23],  # Dm7
        [164.81, 246.94, 293.66, 392.00],  # Em7
        [174.61, 261.63, 329.63, 440.00],  # Fmaj7
        [196.00, 293.66, 349.23, 440.00],  # G7
    ]
    t2 = create_ambient_track("demo_neon_horizon.mp3", chords2, "Neon Horizon (Ultra HD)", "Synthwave Dreams")

    return {"visual": vis_file, "tracks": [t1, t2]}
