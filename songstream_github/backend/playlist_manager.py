import json
import os
import subprocess
import uuid
from pathlib import Path
from typing import List, Optional
from pydantic import BaseModel
from mutagen import File as MutagenFile

BASE_DIR = Path(__file__).resolve().parent.parent
AUDIO_DIR = BASE_DIR / "media" / "audio"
CACHE_DIR = BASE_DIR / "media" / "cache"
PLAYLIST_FILE = BASE_DIR / "media" / "playlist.json"


class Track(BaseModel):
    id: str
    filename: str
    title: str
    artist: str
    duration: float
    duration_formatted: str
    size: int
    size_formatted: str
    enabled: bool = True


class PlaylistScheduleItem(BaseModel):
    track_id: str
    title: str
    artist: str
    start_time: float
    end_time: float
    duration: float
    filename: str = ""
    url: str = ""


def format_duration(seconds: float) -> str:
    mins = int(seconds // 60)
    secs = int(seconds % 60)
    return f"{mins:02d}:{secs:02d}"


def format_size(bytes_size: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if bytes_size < 1024.0:
            return f"{bytes_size:.1f} {unit}"
        bytes_size /= 1024.0
    return f"{bytes_size:.1f} GB"


def extract_metadata(file_path: Path) -> dict:
    title = file_path.stem
    artist = "Unknown Artist"
    duration = 0.0

    try:
        audio = MutagenFile(str(file_path), easy=True)
        if audio is not None:
            if audio.tags:
                title = audio.tags.get("title", [title])[0]
                artist = audio.tags.get("artist", [artist])[0]
            if audio.info:
                duration = getattr(audio.info, "length", 0.0)
    except Exception:
        pass

    # Fallback to ffprobe if duration is 0
    if duration <= 0:
        try:
            cmd = [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(file_path),
            ]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
            duration = float(result.stdout.strip())
        except Exception:
            duration = 180.0  # default estimate

    size = file_path.stat().st_size
    return {
        "title": title,
        "artist": artist,
        "duration": duration,
        "duration_formatted": format_duration(duration),
        "size": size,
        "size_formatted": format_size(size),
    }


class PlaylistManager:
    def __init__(self):
        AUDIO_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        self.tracks: List[Track] = []
        self._load()

    def _load(self):
        saved_order = []
        saved_state = {}
        if PLAYLIST_FILE.exists():
            try:
                with open(PLAYLIST_FILE, "r", encoding="utf-8") as f:
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

        # Find all actual audio files on disk
        valid_exts = {".mp3", ".wav", ".aac", ".m4a", ".ogg", ".flac"}
        existing_files = {p.name: p for p in AUDIO_DIR.iterdir() if p.suffix.lower() in valid_exts and not p.name.startswith("_temp_")}

        tracks_dict = {}
        for name, path in existing_files.items():
            meta = extract_metadata(path)
            track_id = str(uuid.uuid5(uuid.NAMESPACE_URL, name))
            tracks_dict[name] = Track(
                id=track_id,
                filename=name,
                title=meta["title"],
                artist=meta["artist"],
                duration=meta["duration"],
                duration_formatted=meta["duration_formatted"],
                size=meta["size"],
                size_formatted=meta["size_formatted"],
                enabled=saved_state.get(name, True),
            )

        # Order according to saved_order, then append any new files
        ordered = []
        for filename in saved_order:
            if filename in tracks_dict:
                ordered.append(tracks_dict.pop(filename))
        ordered.extend(tracks_dict.values())
        self.tracks = ordered
        self._save()

    def _save(self):
        data = [{"filename": t.filename, "enabled": t.enabled} for t in self.tracks]
        with open(PLAYLIST_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def toggle_track(self, track_id: str, enabled: Optional[bool] = None) -> bool:
        t = self.get_track_by_id(track_id)
        if t:
            if enabled is not None:
                t.enabled = enabled
            else:
                t.enabled = not t.enabled
            self._save()
            return True
        return False

    def select_all(self, enabled: bool) -> None:
        for t in self.tracks:
            t.enabled = enabled
        self._save()

    def get_tracks(self) -> List[Track]:
        self._load()
        return self.tracks

    def get_track_by_id(self, track_id: str) -> Optional[Track]:
        for t in self.tracks:
            if t.id == track_id:
                return t
        return None

    def get_track_file(self, track_id: str) -> Optional[Path]:
        t = self.get_track_by_id(track_id)
        if t:
            p = AUDIO_DIR / t.filename
            if p.exists():
                return p
        return None

    def delete_track(self, track_id: str) -> bool:
        t = self.get_track_by_id(track_id)
        if t:
            p = AUDIO_DIR / t.filename
            if p.exists():
                try:
                    p.unlink()
                except Exception:
                    pass
            self.tracks = [trk for trk in self.tracks if trk.id != track_id]
            self._save()
            return True
        return False

    def move(self, track_id: str, direction: str) -> bool:
        idx = next((i for i, t in enumerate(self.tracks) if t.id == track_id), -1)
        if idx == -1:
            return False
        if direction == "up" and idx > 0:
            self.tracks[idx], self.tracks[idx - 1] = self.tracks[idx - 1], self.tracks[idx]
            self._save()
            return True
        elif direction == "down" and idx < len(self.tracks) - 1:
            self.tracks[idx], self.tracks[idx + 1] = self.tracks[idx + 1], self.tracks[idx]
            self._save()
            return True
        elif direction in ("first", "top") and idx > 0:
            item = self.tracks.pop(idx)
            self.tracks.insert(0, item)
            self._save()
            return True
        elif direction in ("last", "bottom") and idx < len(self.tracks) - 1:
            item = self.tracks.pop(idx)
            self.tracks.append(item)
            self._save()
            return True
        return False

    def clear_all_tracks(self) -> int:
        count = 0
        for t in self.tracks:
            p = AUDIO_DIR / t.filename
            if p.exists():
                try:
                    p.unlink()
                    count += 1
                except Exception:
                    pass
        self.tracks = []
        self._save()
        return count

    def reorder(self, track_ids: List[str]):
        id_to_track = {t.id: t for t in self.tracks}
        new_list = []
        for tid in track_ids:
            if tid in id_to_track:
                new_list.append(id_to_track[tid])
        # Add any missing
        for t in self.tracks:
            if t not in new_list:
                new_list.append(t)
        self.tracks = new_list
        self._save()

    def add_file(self, source_path: Path, filename: str) -> Track:
        dest_path = AUDIO_DIR / filename
        # If already exists, rename with unique suffix
        if dest_path.exists():
            stem = dest_path.stem
            suffix = dest_path.suffix
            filename = f"{stem}_{uuid.uuid4().hex[:6]}{suffix}"
            dest_path = AUDIO_DIR / filename

        source_path.replace(dest_path)
        meta = extract_metadata(dest_path)
        track_id = str(uuid.uuid5(uuid.NAMESPACE_URL, filename))
        trk = Track(
            id=track_id,
            filename=filename,
            title=meta["title"],
            artist=meta["artist"],
            duration=meta["duration"],
            duration_formatted=meta["duration_formatted"],
            size=meta["size"],
            size_formatted=meta["size_formatted"],
        )
        self.tracks.append(trk)
        self._save()
        return trk

    def compile_master_audio(self, profile_id: Optional[str] = None) -> tuple[Path, List[PlaylistScheduleItem], float]:
        """
        Compiles the selected playlist tracks into a single standardized 44.1kHz stereo AAC
        file for seamless 24/7 looping. Returns (master_path, schedule_items, total_duration).
        """
        self._load()
        active_tracks = [t for t in self.tracks if getattr(t, "enabled", True)]
        if not active_tracks:
            raise ValueError("No music tracks selected! Please select at least one track to play.")

        schedule: List[PlaylistScheduleItem] = []
        current_time = 0.0

        # Build timetable
        for trk in active_tracks:
            schedule.append(
                PlaylistScheduleItem(
                    track_id=trk.id,
                    title=trk.title,
                    artist=trk.artist,
                    start_time=current_time,
                    end_time=current_time + trk.duration,
                    duration=trk.duration,
                    filename=trk.filename,
                    url=f"/media/audio/{trk.filename}",
                )
            )
            current_time += trk.duration

        total_duration = current_time
        cache_suffix = f"_{profile_id}" if profile_id else ""
        master_audio_path = CACHE_DIR / f"master_broadcast_audio{cache_suffix}.aac"
        meta_file = CACHE_DIR / f"master_broadcast_audio{cache_suffix}.meta"
        current_fp = json.dumps([{"f": t.filename, "s": t.size, "d": t.duration} for t in active_tracks], sort_keys=True)

        if master_audio_path.exists() and meta_file.exists():
            try:
                if meta_file.read_text(encoding="utf-8") == current_fp:
                    return master_audio_path, schedule, total_duration
            except Exception:
                pass

        # If only 1 track, convert directly
        if len(active_tracks) == 1:
            in_file = AUDIO_DIR / active_tracks[0].filename
            cmd = [
                "ffmpeg", "-y",
                "-i", str(in_file),
                "-vn",
                "-acodec", "aac",
                "-ar", "48000",
                "-ac", "2",
                "-b:a", "320k",
                str(master_audio_path),
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                meta_file.write_text(current_fp, encoding="utf-8")
            except Exception:
                pass
            return master_audio_path, schedule, total_duration

        # Multiple tracks: use concat filter for glitch-free normalization
        inputs = []
        filter_parts = []
        for i, trk in enumerate(active_tracks):
            in_file = AUDIO_DIR / trk.filename
            inputs.extend(["-i", str(in_file)])
            filter_parts.append(f"[{i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a{i}];")

        concat_in = "".join(f"[a{i}]" for i in range(len(active_tracks)))
        filter_str = "".join(filter_parts) + f"{concat_in}concat=n={len(active_tracks)}:v=0:a=1[outa]"

        cmd = [
            "ffmpeg", "-y",
            *inputs,
            "-filter_complex", filter_str,
            "-map", "[outa]",
            "-acodec", "aac",
            "-b:a", "320k",
            "-ar", "48000",
            "-ac", "2",
            str(master_audio_path),
        ]
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            meta_file.write_text(current_fp, encoding="utf-8")
        except Exception:
            pass
        return master_audio_path, schedule, total_duration
