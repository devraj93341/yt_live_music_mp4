import asyncio
import os
import re
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable, List, Optional
from pydantic import BaseModel

from .config import StreamConfig, load_config
from .playlist_manager import PlaylistManager, PlaylistScheduleItem
from .video_playlist_manager import VideoPlaylistManager, VideoScheduleItem

BASE_DIR = Path(__file__).resolve().parent.parent
CACHE_DIR = BASE_DIR / "media" / "cache"
VISUALS_DIR = BASE_DIR / "media" / "visuals"
VIDEOS_DIR = BASE_DIR / "media" / "videos"


def check_video_has_audio(file_path: Path) -> bool:
    """Uses ffprobe to detect if a video file has an audio stream."""
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-select_streams", "a",
            "-show_entries", "stream=codec_type",
            "-of", "csv=p=0",
            str(file_path),
        ]
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return bool(res.stdout.strip())
    except Exception:
        return False


class StreamStats(BaseModel):
    status: str = "idle"  # idle, starting, streaming, stopping, error
    uptime_seconds: int = 0
    fps: float = 0.0
    bitrate: str = "0 kbps"
    speed: str = "0.0x"
    frame: int = 0
    current_song: Optional[dict] = None
    is_test_mode: bool = False
    last_error: Optional[str] = None


class StreamEngine:
    def __init__(self, playlist_manager: PlaylistManager, video_playlist_manager: Optional[VideoPlaylistManager] = None):
        self.pm = playlist_manager
        self.vpm = video_playlist_manager or VideoPlaylistManager()
        self.active_cfg: Optional[StreamConfig] = None
        self.process: Optional[subprocess.Popen] = None
        self.status = "idle"
        self.is_test_mode = False
        self.start_epoch: float = 0.0
        self.fps: float = 0.0
        self.bitrate: str = "0 kbps"
        self.speed: str = "0.0x"
        self.frame: int = 0
        self.last_error: Optional[str] = None
        self.schedule: List[PlaylistScheduleItem] = []
        self.total_cycle_duration: float = 0.0
        self.current_song_idx: int = -1
        self.current_song_info: Optional[dict] = None
        
        self.log_subscribers: List[Callable[[dict], None]] = []
        self.recent_logs: List[str] = []
        self.max_recent_logs = 100
        
        self._monitor_thread: Optional[threading.Thread] = None
        self._schedule_thread: Optional[threading.Thread] = None
        self._stop_requested = False

        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self.current_song_file = CACHE_DIR / "current_song.txt"
        self.badge_label_file = CACHE_DIR / "badge_label.txt"
        self.song_meta_file = CACHE_DIR / "song_meta.txt"
        if not self.current_song_file.exists():
            self.current_song_file.write_text("SongStream 24/7 Live Radio", encoding="utf-8")
        if not self.badge_label_file.exists():
            self.badge_label_file.write_text("NOW PLAYING", encoding="utf-8")
        if not self.song_meta_file.exists():
            self.song_meta_file.write_text("SongStream Ultra HD Live Radio", encoding="utf-8")
        self.banner_title_file = CACHE_DIR / "banner_title.txt"
        if not self.banner_title_file.exists():
            self.banner_title_file.write_text("SongStream 24/7 Radio", encoding="utf-8")
        self.badge_asset_file = CACHE_DIR / "badge_asset.png"
        # Render initial badge asset so it is always ready
        try:
            self.render_badge_asset(load_config())
        except Exception:
            pass

    def update_banner_title(self, title: str):
        try:
            self.banner_title_file.write_text((title or "").strip(), encoding="utf-8")
        except Exception as e:
            self._broadcast_log(f"Failed to update banner title file: {e}", "warning")

    def subscribe_logs(self, callback: Callable[[dict], None]):
        self.log_subscribers.append(callback)

    def unsubscribe_logs(self, callback: Callable[[dict], None]):
        if callback in self.log_subscribers:
            self.log_subscribers.remove(callback)

    def _broadcast_log(self, message: str, level: str = "info"):
        timestamp = time.strftime("%H:%M:%S")
        log_entry = {
            "type": "log",
            "time": timestamp,
            "message": message,
            "level": level,
        }
        self.recent_logs.append(f"[{timestamp}] [{level.upper()}] {message}")
        if len(self.recent_logs) > self.max_recent_logs:
            self.recent_logs.pop(0)

        for sub in list(self.log_subscribers):
            try:
                sub(log_entry)
            except Exception:
                pass

    def _broadcast_stats(self):
        stats = self.get_stats().model_dump()
        payload = {"type": "stats", "data": stats}
        for sub in list(self.log_subscribers):
            try:
                sub(payload)
            except Exception:
                pass

    def get_stats(self) -> StreamStats:
        uptime = 0
        if self.status == "streaming" and self.start_epoch > 0:
            uptime = int(time.time() - self.start_epoch)

        return StreamStats(
            status=self.status,
            uptime_seconds=uptime,
            fps=self.fps,
            bitrate=self.bitrate,
            speed=self.speed,
            frame=self.frame,
            current_song=self.current_song_info,
            is_test_mode=self.is_test_mode,
            last_error=self.last_error,
        )

    def render_badge_asset(self, cfg: Optional[StreamConfig] = None) -> Path:
        """Renders an exact, pixel-perfect visual replica of the Now Playing badge matching the frontend CSS.
        Generates an animated APNG with dynamic moving equalizer bars that smoothly bounce in the live stream.
        """
        try:
            import math
            from PIL import Image, ImageDraw, ImageFont, ImageFilter
            c = cfg or self.active_cfg
            if not c:
                return self.badge_asset_file

            design = str(getattr(c, "now_playing_design", "pill")).strip().lower()
            badge_color = getattr(c, "now_playing_color", "#00f2fe")
            scale_factor = 1.0  # Normalized to baseline 1080p
            badge_scale = getattr(c, "now_playing_scale", 0.75)
            font_weight = str(getattr(c, "now_playing_font_weight", "800")).strip()

            lbl = getattr(c, "now_playing_label", "Now Playing")
            lbl = (lbl.strip() if lbl else "Now Playing")
            transform = getattr(c, "now_playing_text_transform", "uppercase")
            if transform == "uppercase":
                lbl = lbl.upper()
            elif transform == "lowercase":
                lbl = lbl.lower()
            elif transform == "capitalize":
                lbl = lbl.title()

            # Parse hex color
            h = badge_color.lstrip('#')
            if len(h) == 3:
                h = ''.join([ch * 2 for ch in h])
            try:
                r, g, b = tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
            except Exception:
                r, g, b = (0, 242, 254)

            # Font setup
            user_fsize = getattr(c, "now_playing_font_size", 13)
            font_size = max(11, int(user_fsize * 1.35 * scale_factor * badge_scale))
            if font_weight == "900" and Path("C:/Windows/Fonts/seguibl.ttf").exists():
                font_path = "C:/Windows/Fonts/seguibl.ttf"
            elif font_weight in {"700", "800", "900"}:
                font_path = "C:/Windows/Fonts/segoeuib.ttf" if Path("C:/Windows/Fonts/segoeuib.ttf").exists() else "C:/Windows/Fonts/arialbd.ttf"
            elif font_weight == "600" and Path("C:/Windows/Fonts/seguisb.ttf").exists():
                font_path = "C:/Windows/Fonts/seguisb.ttf"
            else:
                font_path = "C:/Windows/Fonts/segoeui.ttf" if Path("C:/Windows/Fonts/segoeui.ttf").exists() else "C:/Windows/Fonts/arial.ttf"

            try:
                font = ImageFont.truetype(font_path, font_size)
            except Exception:
                font = ImageFont.load_default()

            dummy_img = Image.new("RGBA", (1, 1))
            dummy_draw = ImageDraw.Draw(dummy_img)
            bbox = dummy_draw.textbbox((0, 0), lbl, font=font)
            text_w = bbox[2] - bbox[0]
            text_h = bbox[3] - bbox[1]

            # 4 Pulse Equalizer bars matching CSS .overlay-pulse-bars
            bar_w = max(2, int(2.5 * scale_factor * badge_scale))
            bar_gap = max(2, int(2.5 * scale_factor * badge_scale))
            bar_h = max(10, int(13 * scale_factor * badge_scale))
            bars_total_w = 4 * bar_w + 3 * bar_gap

            gap_bar_text = max(6, int(7 * scale_factor * badge_scale))
            pad_x = max(8, int(10 * scale_factor * badge_scale))
            pad_y = max(3, int(4 * scale_factor * badge_scale))

            inner_w = bars_total_w + gap_bar_text + text_w + (pad_x * 2 if design != "minimal" else 0)
            inner_h = max(bar_h, text_h) + (pad_y * 2 if design != "minimal" else 0)

            margin = 20  # Padding for soft Gaussian blur glow without edge clipping
            img_w = inner_w + margin * 2
            img_h = inner_h + margin * 2

            # Build static baseplate (glow, background container, and label text)
            base = Image.new("RGBA", (img_w, img_h), (0, 0, 0, 0))
            glow = Image.new("RGBA", (img_w, img_h), (0, 0, 0, 0))
            glow_draw = ImageDraw.Draw(glow)

            bx0, by0 = margin, margin
            bx1, by1 = margin + inner_w, margin + inner_h

            if design == "pill":
                # Capsule Pill: rounded capsule (radius = height//2) with glowing border and dark container
                glow_draw.rounded_rectangle([bx0, by0, bx1, by1], radius=inner_h // 2, fill=(r, g, b, 75))
                glow = glow.filter(ImageFilter.GaussianBlur(6))
                base = Image.alpha_composite(base, glow)
                draw = ImageDraw.Draw(base)
                draw.rounded_rectangle([bx0, by0, bx1, by1], radius=inner_h // 2, fill=(15, 23, 42, 210), outline=(r, g, b, 255), width=max(1, int(1.2 * scale_factor)))
            elif design == "neon":
                # Neon Glow: deep black backing with thick left-accent border and bright cyber glow
                glow_draw.rounded_rectangle([bx0, by0, bx1, by1], radius=4, fill=(r, g, b, 90))
                glow = glow.filter(ImageFilter.GaussianBlur(8))
                base = Image.alpha_composite(base, glow)
                draw = ImageDraw.Draw(base)
                draw.rounded_rectangle([bx0, by0, bx1, by1], radius=4, fill=(0, 0, 0, 180), outline=(255, 255, 255, 30), width=1)
                stripe_w = max(3, int(3.5 * scale_factor * badge_scale))
                draw.rectangle([bx0, by0, bx0 + stripe_w, by1], fill=(r, g, b, 255))
            elif design == "outline":
                # Cyber Tag: crisp 1.5px accent outline on dark background
                glow_draw.rounded_rectangle([bx0, by0, bx1, by1], radius=4, fill=(0, 0, 0, 160))
                glow = glow.filter(ImageFilter.GaussianBlur(4))
                base = Image.alpha_composite(base, glow)
                draw = ImageDraw.Draw(base)
                draw.rounded_rectangle([bx0, by0, bx1, by1], radius=4, fill=(3, 7, 18, 190), outline=(r, g, b, 255), width=max(1, int(1.5 * scale_factor)))
            elif design == "gradient":
                # Cyber Gradient: bright accent color linear gradient with dark contrasting text
                glow_draw.rounded_rectangle([bx0, by0, bx1, by1], radius=5, fill=(r, g, b, 80))
                glow = glow.filter(ImageFilter.GaussianBlur(6))
                base = Image.alpha_composite(base, glow)
                grad = Image.new("RGBA", (inner_w, inner_h), (0, 0, 0, 0))
                for x in range(inner_w):
                    alpha = 1.0 - (x / max(1, inner_w))
                    cur_r = int(r * alpha + 15 * (1 - alpha))
                    cur_g = int(g * alpha + 23 * (1 - alpha))
                    cur_b = int(b * alpha + 42 * (1 - alpha))
                    for y in range(inner_h):
                        grad.putpixel((x, y), (cur_r, cur_g, cur_b, int(230 * alpha + 190 * (1 - alpha))))
                mask = Image.new("L", (inner_w, inner_h), 0)
                mask_draw = ImageDraw.Draw(mask)
                mask_draw.rounded_rectangle([0, 0, inner_w, inner_h], radius=5, fill=255)
                base.paste(grad, (bx0, by0), mask)
                draw = ImageDraw.Draw(base)
            else:  # minimal
                draw = ImageDraw.Draw(base)

            # Draw static text once onto base
            bar_x = bx0 + (pad_x if design != "minimal" else 0)
            bar_y_bottom = by0 + (pad_y if design != "minimal" else 0) + max(bar_h, text_h)
            tx = bar_x + bars_total_w + gap_bar_text
            ty = by0 + (pad_y if design != "minimal" else 0) + (max(bar_h, text_h) - text_h) // 2 - bbox[1]
            text_color = (3, 7, 18, 255) if design == "gradient" else (r, g, b, 255)

            if design != "gradient":
                draw.text((tx + 1, ty + 1), lbl, font=font, fill=(0, 0, 0, 200))
            draw.text((tx, ty), lbl, font=font, fill=text_color)

            # Generate 20-frame seamlessly looping animated APNG for dynamic pulse bars
            frames = []
            delays = [0.0, 0.25, 0.5, 0.15]
            num_frames = 20
            bar_color = (3, 7, 18, 255) if design == "gradient" else (r, g, b, 255)

            for f_idx in range(num_frames):
                frame = base.copy()
                fdraw = ImageDraw.Draw(frame)
                for i in range(4):
                    phase = (f_idx / float(num_frames) + delays[i]) * 2.0 * math.pi
                    # Sinusoidal rhythm from 20% to 100% height
                    ratio = 0.20 + 0.80 * (0.5 + 0.5 * math.sin(phase))
                    bh = max(3, int(bar_h * ratio))
                    x0 = bar_x + i * (bar_w + bar_gap)
                    fdraw.rectangle([x0, bar_y_bottom - bh, x0 + bar_w, bar_y_bottom], fill=bar_color)
                frames.append(frame)

            # Render APNG in memory first so file is never written in incomplete states
            import io
            buf = io.BytesIO()
            frames[0].save(
                buf,
                format="PNG",
                save_all=True,
                append_images=frames[1:],
                loop=0,
                duration=50
            )
            raw_bytes = buf.getvalue()

            # Write bytes to file (use in-place overwrite so open Windows file handles by FFmpeg are not locked against os.replace)
            try:
                if self.badge_asset_file.exists():
                    with open(self.badge_asset_file, "r+b") as f:
                        f.seek(0)
                        f.write(raw_bytes)
                        f.truncate()
                else:
                    self.badge_asset_file.write_bytes(raw_bytes)
            except Exception:
                # Fallback to atomic replace if r+b is not accessible
                tmp_badge_file = self.badge_asset_file.with_name(f"{self.badge_asset_file.stem}_tmp.png")
                tmp_badge_file.write_bytes(raw_bytes)
                try:
                    os.replace(tmp_badge_file, self.badge_asset_file)
                except Exception:
                    pass
                finally:
                    if tmp_badge_file.exists():
                        try:
                            tmp_badge_file.unlink()
                        except Exception:
                            pass

            return self.badge_asset_file
        except Exception as e:
            self._broadcast_log(f"Failed to render badge asset image: {e}", "warning")
            return self.badge_asset_file

    def update_now_playing_badge(self, cfg: Optional[StreamConfig] = None):
        """Immediately rewrites the badge text file and re-renders the badge asset image."""
        try:
            c = cfg or self.active_cfg or load_config()
            lbl = getattr(c, "now_playing_label", "Now Playing")
            lbl = (lbl.strip() if lbl else "Now Playing")
            transform = getattr(c, "now_playing_text_transform", "uppercase")
            if transform == "uppercase":
                lbl = lbl.upper()
            elif transform == "lowercase":
                lbl = lbl.lower()
            elif transform == "capitalize":
                lbl = lbl.title()
            self.badge_label_file.write_text(lbl, encoding="utf-8")
            self.render_badge_asset(c)
        except Exception as e:
            self._broadcast_log(f"Failed to update badge: {e}", "warning")

    def _format_song_meta(self, title: str, artist: str) -> str:
        t = (title or "").strip()
        a = (artist or "").strip()
        has_artist = bool(a and a.lower() not in {"unknown artist", "unknown", "n/a", "none"})

        # Only split/wrap into multiple lines if title exceeds 55 characters (never trim or truncate any words)
        lines = []
        if len(t) > 55:
            split_done = False
            for sep in [" - ", " – ", " — ", " | "]:
                if sep in t:
                    parts = t.split(sep, 1)
                    p1, p2 = parts[0].strip(), parts[1].strip()
                    if p1 and p2:
                        lines = [p1, p2]
                        split_done = True
                        break
            if not split_done:
                import textwrap
                # Wrap full text with no cutoff/clipping
                lines = textwrap.wrap(t, width=55)
        else:
            lines = [t] if t else []

        if has_artist:
            lines.append(a)

        return "\n".join(lines)

    def _update_now_playing_file(self, title: str, artist: str, label: str = "Now Playing"):
        try:
            lbl = (label.strip() if label else "Now Playing")
            transform = getattr(self.active_cfg, "now_playing_text_transform", "uppercase") if self.active_cfg else "uppercase"
            if transform == "uppercase":
                lbl = lbl.upper()
            elif transform == "lowercase":
                lbl = lbl.lower()
            elif transform == "capitalize":
                lbl = lbl.title()

            artist_part = f" - {artist}" if artist and artist.strip() and artist.strip().lower() not in {"unknown artist", "unknown"} else ""
            content = f"{lbl}\n{title}{artist_part}"
            self.current_song_file.write_text(content, encoding="utf-8")

            # Dedicated separate files for Badge Header and Song Metadata
            self.badge_label_file.write_text(lbl, encoding="utf-8")
            meta_str = self._format_song_meta(title, artist)
            self.song_meta_file.write_text(meta_str, encoding="utf-8")
        except Exception as e:
            self._broadcast_log(f"Failed to update now-playing file: {e}", "warning")

    def _clear_now_playing_file(self):
        try:
            self.current_song_file.write_text("", encoding="utf-8")
            self.badge_label_file.write_text("", encoding="utf-8")
            self.song_meta_file.write_text("", encoding="utf-8")
        except Exception as e:
            pass

    def _schedule_tracker(self):
        """Monitors track transitions and updates on-screen text dynamically."""
        while self.status == "streaming" and not self._stop_requested:
            if self.total_cycle_duration > 0 and self.schedule:
                elapsed = time.time() - self.start_epoch
                cycle_time = elapsed % self.total_cycle_duration

                new_idx = -1
                for i, item in enumerate(self.schedule):
                    if item.start_time <= cycle_time < item.end_time:
                        new_idx = i
                        break

                if new_idx != -1 and new_idx != self.current_song_idx:
                    self.current_song_idx = new_idx
                    item = self.schedule[new_idx]
                    track_or_vid_id = getattr(item, "track_id", getattr(item, "video_id", ""))
                    is_vid = hasattr(item, "video_id")
                    artist_str = "" if is_vid else getattr(item, "artist", "")
                    url_val = getattr(item, "url", "")
                    if not url_val and hasattr(item, "filename"):
                        if is_vid:
                            url_val = f"/media/video_playlist/{item.filename}"
                        else:
                            url_val = f"/media/audio/{item.filename}"
                    self.current_song_info = {
                        "track_id": track_or_vid_id,
                        "title": item.title,
                        "artist": artist_str,
                        "duration": item.duration,
                        "url": url_val,
                        "is_video": is_vid,
                        "index": new_idx,
                    }
                    if not is_vid:
                        lbl = getattr(self.active_cfg, "now_playing_label", "Now Playing") if self.active_cfg else "Now Playing"
                        self._update_now_playing_file(item.title, artist_str, lbl)
                        self._broadcast_log(f"🎵 Now Playing: {item.title} — {artist_str}", "song")
                    else:
                        self._clear_now_playing_file()
                        self._broadcast_log(f"🎬 Video Playing: {item.title}", "song")
                    self._broadcast_stats()

            time.sleep(0.5)

    def _resolve_visual_file(self, cfg: StreamConfig) -> Path:
        VISUALS_DIR.mkdir(parents=True, exist_ok=True)
        # Check if specified in config
        if cfg.active_visual_id:
            candidate = VISUALS_DIR / cfg.active_visual_id
            if candidate.exists():
                return candidate

        # Look for any existing visual in directory
        for f in VISUALS_DIR.iterdir():
            if f.suffix.lower() in {".png", ".jpg", ".jpeg", ".mp4", ".webm", ".gif"}:
                return f

        # Fallback to demo generator
        from .demo_generator import generate_demo_visual
        demo_name = generate_demo_visual()
        return VISUALS_DIR / demo_name

    def _resolve_direct_video(self, cfg: StreamConfig) -> Path:
        VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
        # Check active_video_id strictly in VIDEOS_DIR
        if cfg.active_video_id:
            p = VIDEOS_DIR / cfg.active_video_id
            if p.exists() and p.suffix.lower() in {".mp4", ".mov", ".webm", ".mkv"}:
                return p

        # Check any valid video strictly in VIDEOS_DIR
        for p in sorted(VIDEOS_DIR.iterdir()):
            if p.suffix.lower() in {".mp4", ".mov", ".webm", ".mkv"} and not p.name.startswith("_temp_"):
                return p

        raise FileNotFoundError("No video found in Direct Video folder. Please upload an MP4 video in the Direct Video tab.")

    def _get_banner_coordinates_expr(self, cfg: StreamConfig, scale_factor: float):
        banner_custom = getattr(cfg, "banner_custom_pos", False)
        if banner_custom:
            b_x = getattr(cfg, "banner_pos_x", 2)
            b_y = getattr(cfg, "banner_pos_y", 3)
            return f"w*{b_x}/100", f"h*{b_y}/100"

        b_align = getattr(cfg, "banner_align", "left")
        margin_x = max(20, int(35 * scale_factor))
        if b_align == "center":
            title_x_expr = "(w-text_w)/2"
        elif b_align == "right":
            title_x_expr = f"w-text_w-{margin_x}"
        else:
            title_x_expr = str(margin_x)

        b_valign = getattr(cfg, "banner_valign", "up")
        margin_y = max(20, int(35 * scale_factor))
        if b_valign == "down":
            title_y_expr = f"h-text_h-{margin_y}"
        else:
            title_y_expr = str(margin_y)

        return title_x_expr, title_y_expr

    def start_stream(self, cfg: StreamConfig, test_mode: bool = False):
        if self.status in {"starting", "streaming"}:
            raise RuntimeError("Stream is already active!")

        self.active_cfg = cfg
        self._stop_requested = False
        self.status = "starting"
        self.is_test_mode = test_mode
        self.last_error = None
        self.fps = 0.0
        self.bitrate = "0 kbps"
        self.speed = "0.0x"
        self.frame = 0
        self.current_song_idx = -1
        self.current_song_info = None
        self._broadcast_stats()

        if not test_mode and not cfg.stream_key.strip():
            self.status = "error"
            self.last_error = "YouTube Stream Key is required to start broadcasting."
            self._broadcast_log("Error: YouTube Stream Key is missing. Enter your stream key in Settings.", "error")
            self._broadcast_stats()
            raise ValueError("YouTube Stream Key is required.")

        try:
            # Parse resolution & framerate
            res = cfg.resolution.lower().strip()
            if "x" in res:
                width, height = res.split("x")
            else:
                width, height = "1920", "1080"

            fps_val = cfg.fps if cfg.fps in [30, 60] else 60
            gop_size = fps_val * 2  # 2 second keyframes
            scale_factor = int(height) / 720.0
            level = "5.2" if int(height) >= 2160 else ("5.1" if int(height) >= 1080 else "4.1")

            cmd = ["ffmpeg", "-y"]

            if cfg.stream_mode == "playlist_play":
                # ==========================================
                # MULTI-VIDEO PLAYLIST BROADCAST MODE
                # ==========================================
                self._broadcast_log("Compiling multi-video broadcast playlist...", "info")
                master_video, schedule, total_duration = self.vpm.compile_master_playlist(
                    int(width), int(height), fps_val, loop_single_id=cfg.playlist_loop_single_id
                )
                self.schedule = schedule
                self.total_cycle_duration = total_duration
                self._broadcast_log(f"Multi-video playlist compiled: {len(schedule)} videos ({total_duration:.1f}s cycle)", "info")

                first_video = self.schedule[0]
                first_vid_id = getattr(first_video, "video_id", getattr(first_video, "track_id", ""))
                first_url = getattr(first_video, "url", f"/media/video_playlist/{first_video.filename}" if hasattr(first_video, "filename") else "")
                self.current_song_info = {
                    "track_id": first_vid_id,
                    "title": first_video.title,
                    "artist": "",
                    "duration": first_video.duration,
                    "url": first_url,
                    "is_video": True,
                    "index": 0,
                }
                self._clear_now_playing_file()

                cmd.extend(["-stream_loop", "-1", "-re", "-i", str(master_video)])

                vf_steps = []
                curr_v = "0:v"

                if cfg.show_banner_in_playlist and cfg.overlay_title.strip():
                    self.update_banner_title(cfg.overlay_title)
                    banner_path = str(self.banner_title_file).replace("\\", "/")
                    if len(banner_path) > 1 and banner_path[1] == ":":
                        banner_path = banner_path[0] + "\\:" + banner_path[2:]
                    title_size = max(18, int(24 * scale_factor))
                    title_x, title_y = self._get_banner_coordinates_expr(cfg, scale_factor)
                    vf_steps.append(
                        f"[{curr_v}]drawtext=textfile='{banner_path}':reload=1:fontcolor=white:fontsize={title_size}:"
                        f"shadowcolor=black@0.9:shadowx=2:shadowy=2:box=0:x={title_x}:y={title_y}[v_title]"
                    )
                    curr_v = "v_title"

                if vf_steps:
                    filter_complex_str = ";".join(vf_steps)
                    cmd.extend([
                        "-filter_complex", filter_complex_str,
                        "-map", f"[{curr_v}]",
                    ])
                else:
                    cmd.extend(["-map", "0:v"])

                cmd.extend(["-map", "0:a:0"])

            elif cfg.stream_mode == "video":
                # ==========================================
                # DIRECT MP4 VIDEO BROADCAST MODE
                # ==========================================
                video_path = self._resolve_direct_video(cfg)
                self._broadcast_log(f"🎬 Direct Video Mode: Preparing to stream '{video_path.name}'...", "info")
                has_audio = check_video_has_audio(video_path)

                if cfg.loop_video:
                    cmd.extend(["-stream_loop", "-1"])
                cmd.extend(["-re", "-i", str(video_path)])

                if not has_audio:
                    self._broadcast_log("Notice: Video has no native audio track. Generating broadcast-compliant silent audio for YouTube.", "info")
                    cmd.extend(["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000"])

                vf_steps = [f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase:flags=lanczos,crop={width}:{height},setsar=1[v_scaled]"]
                curr_v = "v_scaled"

                if cfg.show_banner_in_video and cfg.overlay_title.strip():
                    self.update_banner_title(cfg.overlay_title)
                    banner_path = str(self.banner_title_file).replace("\\", "/")
                    if len(banner_path) > 1 and banner_path[1] == ":":
                        banner_path = banner_path[0] + "\\:" + banner_path[2:]
                    title_size = max(18, int(24 * scale_factor))
                    title_x, title_y = self._get_banner_coordinates_expr(cfg, scale_factor)
                    vf_steps.append(
                        f"[{curr_v}]drawtext=textfile='{banner_path}':reload=1:fontcolor=white:fontsize={title_size}:"
                        f"shadowcolor=black@0.9:shadowx=2:shadowy=2:box=0:x={title_x}:y={title_y}[v_title]"
                    )
                    curr_v = "v_title"

                filter_complex_str = ";".join(vf_steps)
                cmd.extend([
                    "-filter_complex", filter_complex_str,
                    "-map", f"[{curr_v}]",
                ])

                if has_audio:
                    cmd.extend(["-map", "0:a:0"])
                else:
                    cmd.extend(["-map", "1:a"])

                self._clear_now_playing_file()
                self.current_song_info = {
                    "track_id": video_path.name,
                    "title": video_path.stem.replace("_", " ").title(),
                    "artist": "",
                    "duration": 0,
                    "is_video": True,
                }
            else:
                # ==========================================
                # 24/7 MUSIC RADIO MODE
                # ==========================================
                self._broadcast_log("Compiling audio playlist...", "info")
                master_audio, schedule, total_duration = self.pm.compile_master_audio()
                self.schedule = schedule
                self.total_cycle_duration = total_duration
                self._broadcast_log(f"Playlist compiled: {len(schedule)} tracks ({total_duration:.1f}s cycle)", "info")

                visual_path = self._resolve_visual_file(cfg)
                self._broadcast_log(f"Background visual selected: {visual_path.name}", "info")

                # Initialize Now Playing file
                first_track = self.schedule[0]
                self.current_song_info = {
                    "track_id": first_track.track_id,
                    "title": first_track.title,
                    "artist": first_track.artist,
                    "duration": first_track.duration,
                }
                self._update_now_playing_file(first_track.title, first_track.artist, getattr(cfg, "now_playing_label", "Now Playing"))

                # Build FFmpeg command
                is_video_bg = visual_path.suffix.lower() in {".mp4", ".mov", ".webm", ".mkv"}
                if is_video_bg:
                    cmd.extend(["-stream_loop", "-1", "-re", "-i", str(visual_path)])
                else:
                    cmd.extend(["-loop", "1", "-framerate", str(fps_val), "-re", "-i", str(visual_path)])

                cmd.extend(["-stream_loop", "-1", "-i", str(master_audio)])

                if cfg.show_now_playing:
                    self.render_badge_asset(cfg)
                    cmd.extend(["-ignore_loop", "0", "-i", str(self.badge_asset_file)])

                # Filter Graph Construction
                vf_steps = [f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase:flags=bicubic,crop={width}:{height},setsar=1[bg]"]
                curr_v = "bg"

                # 2. Audio Visualizer Overlay
                color_map = {
                    "cyan_neon": "0x00f2fe@0.85|0x4facfe@0.85",
                    "purple_neon": "0xd946ef@0.85|0x8b5cf6@0.85",
                    "sunset": "0xf43f5e@0.85|0xfb923c@0.85",
                    "matrix": "0x22c55e@0.85|0x10b981@0.85",
                    "amber": "0xf59e0b@0.85|0xd97706@0.85",
                }
                wave_color = color_map.get(cfg.visualizer_color, "0x00f2fe@0.85")

                if cfg.visualizer_style == "waves":
                    wave_h = int(int(height) * 0.16)
                    overlay_y = int(int(height) * 0.78)
                    vf_steps.append(f"[1:a]showwaves=s={width}x{wave_h}:mode=p2p:colors={wave_color}[wave]")
                    vf_steps.append(f"[{curr_v}][wave]overlay=0:{overlay_y}[v_wave]")
                    curr_v = "v_wave"
                elif cfg.visualizer_style == "spectrum":
                    spec_h = int(int(height) * 0.20)
                    overlay_y = int(int(height) * 0.76)
                    vf_steps.append(f"[1:a]showfreqs=s={width}x{spec_h}:mode=bar:ascale=log:fscale=log:colors={wave_color}[freqs]")
                    vf_steps.append(f"[{curr_v}][freqs]overlay=0:{overlay_y}[v_freqs]")
                    curr_v = "v_freqs"

                # 3. Top Banner / Title
                if cfg.overlay_title.strip():
                    self.update_banner_title(cfg.overlay_title)
                    banner_path = str(self.banner_title_file).replace("\\", "/")
                    if len(banner_path) > 1 and banner_path[1] == ":":
                        banner_path = banner_path[0] + "\\:" + banner_path[2:]
                    title_size = max(18, int(24 * scale_factor))
                    title_x, title_y = self._get_banner_coordinates_expr(cfg, scale_factor)
                    vf_steps.append(
                        f"[{curr_v}]drawtext=textfile='{banner_path}':reload=1:fontcolor=white:fontsize={title_size}:"
                        f"shadowcolor=black@0.9:shadowx=2:shadowy=2:box=0:x={title_x}:y={title_y}[v_title]"
                    )
                    curr_v = "v_title"

                # 4. Now Playing Dynamic Badge (Rendered Badge Asset with True Design Style + Song Description)
                if cfg.show_now_playing:
                    song_meta_path = str(self.song_meta_file).replace("\\", "/")
                    if len(song_meta_path) > 1 and song_meta_path[1] == ":":
                        song_meta_path = song_meta_path[0] + "\\:" + song_meta_path[2:]

                    badge_scale = getattr(cfg, "now_playing_scale", 0.75)
                    title_size = max(12, int(18 * scale_factor * badge_scale))
                    user_fsize = getattr(cfg, "now_playing_font_size", 13)
                    calc_badge_size = max(11, int(user_fsize * 1.35 * scale_factor * badge_scale))
                    calc_bar_h = max(10, int(13 * scale_factor * badge_scale))
                    pad_y = max(3, int(4 * scale_factor * badge_scale))
                    inner_badge_h = max(calc_bar_h, calc_badge_size) + pad_y * 2
                    margin_glow = 20

                    custom_pos = getattr(cfg, "now_playing_custom_pos", False)
                    if custom_pos:
                        pos_x = getattr(cfg, "now_playing_pos_x", 2)
                        pos_y = getattr(cfg, "now_playing_pos_y", 88)
                        badge_x_expr = f"W*{pos_x}/100-{margin_glow}"
                        badge_y_expr = f"H*{pos_y}/100-{margin_glow}"
                        meta_x_expr = f"w*{pos_x}/100"
                        meta_y_expr = f"h*{pos_y}/100+{inner_badge_h + 8}"
                    else:
                        align = getattr(cfg, "now_playing_align", "left")
                        margin = max(14, int(26 * scale_factor))
                        if align == "center":
                            badge_x_expr = f"(W-w)/2"
                            meta_x_expr = "(w-text_w)/2"
                        elif align == "right":
                            badge_x_expr = f"W-w-{margin}+{margin_glow}"
                            meta_x_expr = f"w-text_w-{margin}"
                        else:
                            badge_x_expr = f"{margin}-{margin_glow}"
                            meta_x_expr = str(margin)

                        valign = getattr(cfg, "now_playing_valign", "down")
                        if valign == "up":
                            badge_y = max(60, int(75 * scale_factor))
                        else:
                            badge_y = int(int(height) - (int(90 * badge_scale) * scale_factor))

                        badge_y_expr = f"{badge_y}-{margin_glow}"
                        meta_y_expr = str(badge_y + inner_badge_h + 8)

                    # Badge Asset Layer (capsule, neon, outline, gradient, or minimal)
                    # Notice: in FFmpeg inputs, index 0 is video/visual, index 1 is master_audio.
                    # Badge asset image is added as input 2.
                    vf_steps.append(
                        f"[{curr_v}][2:v]overlay=x={badge_x_expr}:y={badge_y_expr}:shortest=1[v_badge]"
                    )
                    curr_v = "v_badge"

                    # Layer 2: Song Description (Title & Artist) underneath Badge Header with normal line spacing (no wide gap)
                    meta_font_file = ""
                    if Path("C:/Windows/Fonts/segoeui.ttf").exists():
                        meta_font_file = ":fontfile='C\\:/Windows/Fonts/segoeui.ttf'"
                    elif Path("C:/Windows/Fonts/arial.ttf").exists():
                        meta_font_file = ":fontfile='C\\:/Windows/Fonts/arial.ttf'"

                    vf_steps.append(
                        f"[{curr_v}]drawtext=textfile='{song_meta_path}':reload=1:fontcolor=white:fontsize={title_size}:line_spacing=0"
                        f"{meta_font_file}:shadowcolor=black@0.95:shadowx=2:shadowy=2:box=0:x={meta_x_expr}:y={meta_y_expr}[finalv]"
                    )
                    curr_v = "finalv"

                filter_complex_str = ";".join(vf_steps)
                cmd.extend([
                    "-filter_complex", filter_complex_str,
                    "-map", f"[{curr_v}]",
                    "-map", "1:a",
                ])

            # Common Output Encoders
            cmd.extend([
                "-c:v", "libx264",
                "-profile:v", "high",
                "-level:v", level,
                "-preset", cfg.preset,
                "-threads", "0",
                "-pix_fmt", "yuv420p",
                "-color_range", "tv",
                "-colorspace", "bt709",
                "-color_primaries", "bt709",
                "-color_trc", "bt709",
                "-r", str(fps_val),
                "-g", str(gop_size),
                "-keyint_min", str(gop_size),
                "-sc_threshold", "0",
                "-b:v", cfg.video_bitrate,
                "-maxrate", cfg.video_bitrate,
                "-bufsize", f"{int(cfg.video_bitrate.replace('k', '')) * 2}k",
                "-c:a", "aac",
                "-b:a", cfg.audio_bitrate,
                "-ar", "48000",
                "-ac", "2",
            ])

            if test_mode:
                self._broadcast_log("Starting stream in LOCAL TEST MODE (no YouTube RTMP transmission)...", "info")
                cmd.extend(["-f", "null", "-"])
            else:
                rtmp_dest = cfg.rtmp_url.rstrip("/") + "/" + cfg.stream_key.strip()
                self._broadcast_log(f"Connecting to YouTube Live RTMP: {cfg.rtmp_url}...", "info")
                cmd.extend([
                    "-rtmp_buffer", "2000",
                    "-rtmp_live", "live",
                    "-f", "flv",
                    "-flvflags", "no_duration_filesize",
                    rtmp_dest
                ])

            # Launch process with unbuffered pipe
            self._broadcast_log("Launching FFmpeg broadcast process...", "info")
            self.process = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                universal_newlines=True,
            )

            self.start_epoch = time.time()
            self.status = "streaming"
            self._broadcast_log("🚀 Stream is LIVE! Broadcasting 24/7 stream...", "success")
            self._broadcast_stats()

            # Start monitoring threads
            self._monitor_thread = threading.Thread(target=self._read_ffmpeg_stderr, daemon=True)
            self._monitor_thread.start()

            self._schedule_thread = threading.Thread(target=self._schedule_tracker, daemon=True)
            self._schedule_thread.start()

        except Exception as e:
            self.status = "error"
            self.last_error = str(e)
            self._broadcast_log(f"Failed to start stream: {e}", "error")
            self._broadcast_stats()
            raise

    def _read_ffmpeg_stderr(self):
        """Continuously reads FFmpeg output to parse stats and catch disconnects."""
        re_fps = re.compile(r"fps=\s*([\d\.]+)")
        re_bitrate = re.compile(r"bitrate=\s*([\d\.]+\s*\w+/s)")
        re_speed = re.compile(r"speed=\s*([\d\.]+x)")
        re_frame = re.compile(r"frame=\s*(\d+)")

        last_stat_emit = time.time()

        while self.process and self.process.poll() is None:
            try:
                line = self.process.stderr.readline()
                if not line:
                    time.sleep(0.05)
                    continue

                line = line.strip()

                # Parse metrics from progress lines
                if "frame=" in line or "bitrate=" in line:
                    m_fps = re_fps.search(line)
                    m_br = re_bitrate.search(line)
                    m_sp = re_speed.search(line)
                    m_fr = re_frame.search(line)

                    if m_fps:
                        try:
                            self.fps = float(m_fps.group(1))
                        except ValueError:
                            pass
                    if m_br:
                        self.bitrate = m_br.group(1).strip()
                    if m_sp:
                        self.speed = m_sp.group(1).strip()
                    if m_fr:
                        try:
                            self.frame = int(m_fr.group(1))
                        except ValueError:
                            pass

                    # Emit stats periodically every ~1s
                    now = time.time()
                    if now - last_stat_emit >= 1.0:
                        self._broadcast_stats()
                        last_stat_emit = now
                else:
                    # Log meaningful diagnostics (filter out pure banner spam and harmless fontconfig notices)
                    if "fontconfig error: cannot load default config file" in line.lower():
                        continue
                    if any(kw in line.lower() for kw in ["error", "warning", "fail", "connection", "connected", "rtmp"]):
                        lvl = "warning" if "warning" in line.lower() else ("error" if "error" in line.lower() else "info")
                        self._broadcast_log(f"[FFmpeg] {line}", lvl)

            except Exception as e:
                break

        # Process exited
        exit_code = self.process.poll() if self.process else None
        if not self._stop_requested:
            if exit_code != 0:
                self.status = "error"
                self.last_error = f"Stream ended unexpectedly with exit code {exit_code}."
                self._broadcast_log(f"Stream disconnected (exit code {exit_code}). Please check your stream key and connection.", "error")
            else:
                self.status = "idle"
                self._broadcast_log("Stream stopped gracefully.", "info")
        else:
            self.status = "idle"
            self._broadcast_log("Stream stopped by user.", "info")

        self._broadcast_stats()

    def stop_stream(self):
        if self.status not in {"streaming", "starting"}:
            return

        self._stop_requested = True
        self.status = "stopping"
        self._broadcast_log("Stopping live broadcast...", "info")
        self._broadcast_stats()

        if self.process:
            try:
                # Try sending 'q' to stdin for clean FLV/RTMP finalization
                if self.process.stdin:
                    try:
                        self.process.stdin.write("q\n")
                        self.process.stdin.flush()
                    except Exception:
                        pass

                # Give it 2 seconds to gracefully terminate
                try:
                    self.process.wait(timeout=2.0)
                except subprocess.TimeoutExpired:
                    self.process.terminate()
                    try:
                        self.process.wait(timeout=2.0)
                    except subprocess.TimeoutExpired:
                        self.process.kill()
            except Exception as e:
                pass
            finally:
                self.process = None

        self.status = "idle"
        self.start_epoch = 0
        self.fps = 0.0
        self.bitrate = "0 kbps"
        self.speed = "0.0x"
        self.frame = 0
        self.current_song_idx = -1
        self.current_song_info = None
        self._clear_now_playing_file()
        self._broadcast_log("Stream is now offline.", "info")
        self._broadcast_stats()
