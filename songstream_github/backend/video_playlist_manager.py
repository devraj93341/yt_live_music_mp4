import json
import os
import subprocess
import uuid
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel

BASE_DIR = Path(__file__).resolve().parent.parent
VIDEO_PLAYLIST_DIR = BASE_DIR / "media" / "video_playlist"
CACHE_DIR = BASE_DIR / "media" / "cache"
VIDEO_PLAYLIST_JSON = BASE_DIR / "media" / "video_playlist.json"


class VideoPlaylistItem(BaseModel):
    id: str
    filename: str
    title: str
    duration: float
    duration_formatted: str
    width: int
    height: int
    resolution: str
    has_audio: bool
    size: int
    size_formatted: str
    url: str
    enabled: bool = True


class VideoScheduleItem(BaseModel):
    video_id: str
    title: str
    start_time: float
    end_time: float
    duration: float
    url: str = ""
    filename: str = ""


def format_duration(seconds: float) -> str:
    if seconds <= 0:
        return "00:00"
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hrs > 0:
        return f"{hrs:02d}:{mins:02d}:{secs:02d}"
    return f"{mins:02d}:{secs:02d}"


def format_size(bytes_size: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if bytes_size < 1024.0:
            return f"{bytes_size:.1f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.1f} GB"


def probe_video(file_path: Path) -> dict:
    duration = 0.0
    width = 1920
    height = 1080
    has_audio = False
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "stream=codec_type,codec_name,width,height,duration",
            "-show_entries", "format=duration,size",
            "-of", "json",
            str(file_path),
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
        data = json.loads(res.stdout)
        for s in data.get("streams", []):
            if s.get("codec_type") == "video":
                width = int(s.get("width", width))
                height = int(s.get("height", height))
            elif s.get("codec_type") == "audio":
                has_audio = True
        if "format" in data and "duration" in data["format"]:
            duration = float(data["format"]["duration"])
    except Exception:
        pass

    size = file_path.stat().st_size
    return {
        "width": width,
        "height": height,
        "duration": duration,
        "duration_formatted": format_duration(duration),
        "size": size,
        "size_formatted": format_size(size),
        "has_audio": has_audio,
    }


class VideoPlaylistManager:
    def __init__(self):
        VIDEO_PLAYLIST_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self.items: List[VideoPlaylistItem] = []
        self._load()

    def _load(self):
        saved_order = []
        saved_state = {}
        if VIDEO_PLAYLIST_JSON.exists():
            try:
                with open(VIDEO_PLAYLIST_JSON, "r", encoding="utf-8") as f:
                    raw = json.load(f)
                    for item in raw:
                        if isinstance(item, dict):
                            fn = item.get("filename")
                            if fn:
                                saved_order.append(fn)
                                saved_state[fn] = item.get("enabled", True)
                        elif isinstance(item, str):
                            saved_order.append(item)
                            saved_state[item] = True
            except Exception:
                saved_order = []

        valid_exts = {".mp4", ".mov", ".webm", ".mkv"}
        existing_files = {p.name: p for p in VIDEO_PLAYLIST_DIR.iterdir() if p.suffix.lower() in valid_exts and not p.name.startswith("_temp_")}

        items_dict = {}
        for name, path in existing_files.items():
            meta = probe_video(path)
            item_id = str(uuid.uuid5(uuid.NAMESPACE_URL, name))
            items_dict[name] = VideoPlaylistItem(
                id=item_id,
                filename=name,
                title=path.stem.replace("_", " ").title(),
                duration=meta["duration"],
                duration_formatted=meta["duration_formatted"],
                width=meta["width"],
                height=meta["height"],
                resolution=f"{meta['width']}x{meta['height']}",
                has_audio=meta["has_audio"],
                size=meta["size"],
                size_formatted=meta["size_formatted"],
                url=f"/media/video_playlist/{name}",
                enabled=saved_state.get(name, True),
            )

        ordered = []
        for filename in saved_order:
            if filename in items_dict:
                ordered.append(items_dict.pop(filename))
        ordered.extend(items_dict.values())
        self.items = ordered
        self._save()

    def _save(self):
        data = [{"filename": item.filename, "enabled": item.enabled} for item in self.items]
        with open(VIDEO_PLAYLIST_JSON, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def toggle_item(self, video_id: str, enabled: Optional[bool] = None) -> bool:
        it = self.get_item_by_id(video_id)
        if it:
            if enabled is not None:
                it.enabled = enabled
            else:
                it.enabled = not it.enabled
            self._save()
            return True
        return False

    def select_all(self, enabled: bool) -> None:
        for it in self.items:
            it.enabled = enabled
        self._save()

    def get_items(self) -> List[VideoPlaylistItem]:
        self._load()
        return self.items

    def get_item_by_id(self, item_id: str) -> Optional[VideoPlaylistItem]:
        for it in self.items:
            if it.id == item_id:
                return it
        return None

    def add_file(self, source_path: Path, filename: str) -> VideoPlaylistItem:
        dest_path = VIDEO_PLAYLIST_DIR / filename
        if dest_path.exists():
            stem = dest_path.stem
            suffix = dest_path.suffix
            filename = f"{stem}_{uuid.uuid4().hex[:6]}{suffix}"
            dest_path = VIDEO_PLAYLIST_DIR / filename

        source_path.replace(dest_path)
        meta = probe_video(dest_path)
        item_id = str(uuid.uuid5(uuid.NAMESPACE_URL, filename))
        item = VideoPlaylistItem(
            id=item_id,
            filename=filename,
            title=dest_path.stem.replace("_", " ").title(),
            duration=meta["duration"],
            duration_formatted=meta["duration_formatted"],
            width=meta["width"],
            height=meta["height"],
            resolution=f"{meta['width']}x{meta['height']}",
            has_audio=meta["has_audio"],
            size=meta["size"],
            size_formatted=meta["size_formatted"],
            url=f"/media/video_playlist/{filename}",
        )
        self.items.append(item)
        self._save()
        return item

    def delete_item(self, item_id: str) -> bool:
        item = self.get_item_by_id(item_id)
        if item:
            p = VIDEO_PLAYLIST_DIR / item.filename
            if p.exists():
                try:
                    p.unlink()
                except Exception:
                    pass
            self.items = [it for it in self.items if it.id != item_id]
            self._save()
            return True
        return False

    def clear_all(self) -> int:
        count = 0
        for it in self.items:
            p = VIDEO_PLAYLIST_DIR / it.filename
            if p.exists():
                try:
                    p.unlink()
                    count += 1
                except Exception:
                    pass
        self.items = []
        self._save()
        return count

    def reorder(self, item_ids: List[str]):
        id_to_item = {it.id: it for it in self.items}
        new_list = []
        for iid in item_ids:
            if iid in id_to_item:
                new_list.append(id_to_item[iid])
        for it in self.items:
            if it not in new_list:
                new_list.append(it)
        self.items = new_list
        self._save()

    def move(self, video_id: str, direction: str) -> bool:
        idx = next((i for i, it in enumerate(self.items) if it.id == video_id), -1)
        if idx == -1:
            return False
        if direction == "up" and idx > 0:
            self.items[idx], self.items[idx - 1] = self.items[idx - 1], self.items[idx]
            self._save()
            return True
        elif direction == "down" and idx < len(self.items) - 1:
            self.items[idx], self.items[idx + 1] = self.items[idx + 1], self.items[idx]
            self._save()
            return True
        elif direction in ("first", "top") and idx > 0:
            item = self.items.pop(idx)
            self.items.insert(0, item)
            self._save()
            return True
        elif direction in ("last", "bottom") and idx < len(self.items) - 1:
            item = self.items.pop(idx)
            self.items.append(item)
            self._save()
            return True
        return False

    def compile_master_playlist(self, target_width: int, target_height: int, fps: int, loop_single_id: Optional[str] = None, profile_id: Optional[str] = None) -> tuple[Path, List[VideoScheduleItem], float]:
        """
        Concatenates all selected videos in the playlist into a standardized Full HD/UHD
        master broadcast file with 48kHz audio. Returns (master_path, schedule, total_duration).
        If loop_single_id is provided, only that video is compiled into the broadcast file.
        """
        self._load()
        active_items = [it for it in self.items if getattr(it, "enabled", True)]
        if not active_items:
            raise ValueError("No videos selected! Please check at least one video in Playlist Play to broadcast.")

        if loop_single_id:
            single = next((it for it in self.items if it.id == loop_single_id), None)
            if single:
                active_items = [single]

        schedule: List[VideoScheduleItem] = []
        current_time = 0.0
        for it in active_items:
            dur = max(1.0, it.duration)
            schedule.append(
                VideoScheduleItem(
                    video_id=it.id,
                    title=it.title,
                    start_time=current_time,
                    end_time=current_time + dur,
                    duration=dur,
                    url=it.url,
                    filename=it.filename,
                )
            )
            current_time += dur

        total_duration = current_time
        cache_suffix = f"_{profile_id}" if profile_id else ""
        master_video_path = CACHE_DIR / f"master_video_playlist{cache_suffix}.mp4"
        meta_file = CACHE_DIR / f"master_video_playlist{cache_suffix}.meta"
        current_fp = json.dumps({
            "items": [{"f": it.filename, "s": it.size, "d": it.duration} for it in active_items],
            "res": f"{target_width}x{target_height}",
            "fps": fps,
            "loop_single_id": loop_single_id,
        }, sort_keys=True)

        if master_video_path.exists() and meta_file.exists():
            try:
                if meta_file.read_text(encoding="utf-8") == current_fp:
                    return master_video_path, schedule, total_duration
            except Exception:
                pass

        # If only 1 video: standardize to master directly
        if len(active_items) == 1:
            in_file = VIDEO_PLAYLIST_DIR / active_items[0].filename
            has_aud = active_items[0].has_audio
            dur = max(1.0, active_items[0].duration)
            cmd = ["ffmpeg", "-y", "-i", str(in_file)]
            if not has_aud:
                cmd.extend(["-f", "lavfi", "-i", f"aevalsrc=0:d={dur:.2f}:s=48000:c=stereo"])

            cmd.extend([
                "-vf", f"scale={target_width}:{target_height}:force_original_aspect_ratio=increase:flags=lanczos,crop={target_width}:{target_height},setsar=1,fps={fps}",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "320k",
                "-ar", "48000",
                "-ac", "2",
                "-shortest",
                str(master_video_path),
            ])
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                meta_file.write_text(current_fp, encoding="utf-8")
            except Exception:
                pass
            return master_video_path, schedule, total_duration

        # Multiple videos: Normalize and concatenate using FFmpeg filter_complex
        inputs = []
        filter_parts = []
        concat_segments = []

        for i, it in enumerate(active_items):
            in_file = VIDEO_PLAYLIST_DIR / it.filename
            inputs.extend(["-i", str(in_file)])
            # Normalize Video
            filter_parts.append(f"[{i}:v]scale={target_width}:{target_height}:force_original_aspect_ratio=increase:flags=lanczos,crop={target_width}:{target_height},setsar=1,fps={fps}[v{i}];")

            # Normalize Audio (generate exact silent duration if video has no audio)
            if it.has_audio:
                filter_parts.append(f"[{i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a{i}];")
            else:
                dur = max(1.0, it.duration)
                filter_parts.append(f"aevalsrc=0:d={dur:.2f}:s=48000:c=stereo[a{i}];")

            concat_segments.append(f"[v{i}][a{i}]")

        concat_in_str = "".join(concat_segments)
        filter_str = "".join(filter_parts) + f"{concat_in_str}concat=n={len(active_items)}:v=1:a=1[outv][outa]"

        cmd = [
            "ffmpeg", "-y",
            *inputs,
            "-filter_complex", filter_str,
            "-map", "[outv]",
            "-map", "[outa]",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "320k",
            "-ar", "48000",
            "-ac", "2",
            str(master_video_path),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            meta_file.write_text(current_fp, encoding="utf-8")
        except Exception:
            pass
        return master_video_path, schedule, total_duration
