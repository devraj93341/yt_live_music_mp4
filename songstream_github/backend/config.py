import json
import os
from pathlib import Path
from typing import Optional
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_FILE = BASE_DIR / "config.json"


class StreamConfig(BaseModel):
    rtmp_url: str = Field(default="rtmp://a.rtmp.youtube.com/live2", description="RTMP Ingest Server URL")
    stream_key: str = Field(default="", description="YouTube Live Stream Key")
    resolution: str = Field(default="1920x1080", description="Video Resolution (e.g. 1920x1080 Full HD, 3840x2160 4K UHD)")
    fps: int = Field(default=60, description="Framerate (30 or 60 fps)")
    video_bitrate: str = Field(default="6000k", description="Video Bitrate")
    audio_bitrate: str = Field(default="320k", description="Audio Bitrate (Studio Master)")
    preset: str = Field(default="veryfast", description="FFmpeg x264 preset")
    visualizer_style: str = Field(default="waves", description="'waves', 'spectrum', or 'none'")
    visualizer_color: str = Field(default="cyan_neon", description="Color scheme for visualizer")
    overlay_title: str = Field(default="SongStream Ultra HD Radio", description="Top header / title overlay")
    banner_align: str = Field(default="left", description="Banner title alignment: 'left', 'center', 'right'")
    banner_valign: str = Field(default="up", description="Banner title vertical position: 'up' (top) or 'down' (bottom)")
    banner_pos_x: int = Field(default=2, description="Banner title horizontal position (X) in % (0 to 100)")
    banner_pos_y: int = Field(default=3, description="Banner title vertical position (Y) in % (0 to 100)")
    banner_custom_pos: bool = Field(default=False, description="Whether custom banner coordinates are enabled")
    show_now_playing: bool = Field(default=True, description="Whether to show now-playing badge")
    now_playing_scale: float = Field(default=0.75, description="Scale factor for now playing badge dimension (0.4 to 2.0)")
    now_playing_color: str = Field(default="#00f2fe", description="Hex color for Now Playing badge text and accent")
    now_playing_label: str = Field(default="Now Playing", description="Custom written text label for Now Playing badge")
    now_playing_font_size: int = Field(default=13, description="Font size in px for Now Playing Badge Written Text (10 to 32)")
    now_playing_font_weight: str = Field(default="800", description="Font weight / boldness: '400', '600', '700', '800', '900'")
    now_playing_design: str = Field(default="pill", description="Badge design style: 'pill', 'neon', 'outline', 'gradient', 'minimal'")
    now_playing_align: str = Field(default="left", description="Alignment: 'left', 'center', 'right'")
    now_playing_valign: str = Field(default="down", description="Vertical position: 'up' (top) or 'down' (bottom)")
    now_playing_pos_x: int = Field(default=2, description="Horizontal position (X) in % from 0 to 100")
    now_playing_pos_y: int = Field(default=88, description="Vertical position (Y) in % from 0 to 100 (0=top, 100=bottom)")
    now_playing_custom_pos: bool = Field(default=False, description="Whether custom X/Y coordinate positioning is enabled")
    now_playing_text_transform: str = Field(default="uppercase", description="Text transform: 'uppercase', 'capitalize', 'none'")
    active_visual_id: str = Field(default="demo_lofi_sunset_4k.png", description="ID/filename of active visual background")
    stream_mode: str = Field(default="radio", description="'radio' (music playlist + visual) or 'video' (direct MP4 video broadcast)")
    active_video_id: str = Field(default="demo_lofi_broadcast.mp4", description="Filename of active direct MP4 video")
    loop_video: bool = Field(default=True, description="Loop MP4 video continuously")
    show_banner_in_video: bool = Field(default=False, description="Show stream banner title in Direct Video mode")
    show_banner_in_playlist: bool = Field(default=False, description="Show stream banner title in Playlist Play mode")
    playlist_loop_single_id: Optional[str] = Field(default=None, description="Video ID to loop exclusively in Playlist Play mode")


def load_config() -> StreamConfig:
    if CONFIG_FILE.exists():
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                return StreamConfig(**data)
        except Exception:
            pass
    cfg = StreamConfig()
    save_config(cfg)
    return cfg


def save_config(cfg: StreamConfig):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg.model_dump(), f, indent=2)


def get_safe_config_dict(cfg: StreamConfig) -> dict:
    data = cfg.model_dump()
    raw_key = data.get("stream_key", "")
    if len(raw_key) > 6:
        data["stream_key_masked"] = raw_key[:3] + "..." + raw_key[-4:]
        data["has_stream_key"] = True
    elif len(raw_key) > 0:
        data["stream_key_masked"] = "******"
        data["has_stream_key"] = True
    else:
        data["stream_key_masked"] = ""
        data["has_stream_key"] = False
    return data
