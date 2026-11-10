import asyncio
import os
import shutil
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import StreamConfig, get_safe_config_dict, load_config, save_config
from .demo_generator import ensure_demo_media
from .playlist_manager import PlaylistManager
from .video_playlist_manager import VideoPlaylistManager, format_duration as format_video_dur, probe_video as probe_video_info
from .streamer import StreamEngine

BASE_DIR = Path(__file__).resolve().parent.parent
MEDIA_DIR = BASE_DIR / "media"
AUDIO_DIR = MEDIA_DIR / "audio"
VISUALS_DIR = MEDIA_DIR / "visuals"
VIDEOS_DIR = MEDIA_DIR / "videos"
VIDEO_PLAYLIST_DIR = MEDIA_DIR / "video_playlist"
STATIC_DIR = BASE_DIR / "static"


app = FastAPI(title="SongStream - 24/7 YouTube Live Broadcaster")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize core services
pm = PlaylistManager()
vpm = VideoPlaylistManager()
cfg = load_config()
engine = StreamEngine(pm, vpm)

# Ensure at least demo assets exist so the app is immediately ready
ensure_demo_media()
pm._load()
vpm._load()

# WebSocket active client registry
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)

ws_manager = ConnectionManager()

# Bridge StreamEngine callbacks to asyncio WebSocket broadcasts
loop: Optional[asyncio.AbstractEventLoop] = None

def stream_engine_listener(payload: dict):
    global loop
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(ws_manager.broadcast(payload), loop)


@app.on_event("startup")
async def startup_event():
    global loop
    loop = asyncio.get_running_loop()
    engine.subscribe_logs(stream_engine_listener)


class StopStreamRequest(BaseModel):
    profile_id: Optional[str] = None


# API Routes
@app.get("/api/status")
def get_status():
    stats = engine.get_stats().model_dump()
    stats["active_visual"] = cfg.active_visual_id or (VISUALS_DIR / "demo_lofi_sunset.png").name
    stats["total_tracks"] = len(pm.get_tracks())
    stats["total_playlist_videos"] = len(vpm.get_items())
    return stats


@app.get("/api/config")
def get_config_endpoint():
    return get_safe_config_dict(cfg)


class UpdateConfigRequest(BaseModel):
    profile_id: Optional[str] = None
    rtmp_url: Optional[str] = None
    stream_key: Optional[str] = None
    resolution: Optional[str] = None
    fps: Optional[int] = None
    video_bitrate: Optional[str] = None
    audio_bitrate: Optional[str] = None
    preset: Optional[str] = None
    visualizer_style: Optional[str] = None
    visualizer_color: Optional[str] = None
    overlay_title: Optional[str] = None
    banner_align: Optional[str] = None
    banner_valign: Optional[str] = None
    banner_pos_x: Optional[int] = None
    banner_pos_y: Optional[int] = None
    banner_custom_pos: Optional[bool] = None
    show_now_playing: Optional[bool] = None
    now_playing_scale: Optional[float] = None
    now_playing_color: Optional[str] = None
    now_playing_label: Optional[str] = None
    now_playing_font_size: Optional[int] = None
    now_playing_font_weight: Optional[str] = None
    now_playing_design: Optional[str] = None
    now_playing_align: Optional[str] = None
    now_playing_valign: Optional[str] = None
    now_playing_pos_x: Optional[int] = None
    now_playing_pos_y: Optional[int] = None
    now_playing_custom_pos: Optional[bool] = None
    now_playing_text_transform: Optional[str] = None
    active_visual_id: Optional[str] = None
    stream_mode: Optional[str] = None
    active_video_id: Optional[str] = None
    loop_video: Optional[bool] = None
    show_banner_in_video: Optional[bool] = None
    show_banner_in_playlist: Optional[bool] = None
    playlist_loop_single_id: Optional[str] = None


@app.post("/api/config")
def update_config_endpoint(req: UpdateConfigRequest):
    fields = req.model_dump(exclude_unset=True)
    update_badge = False

    for k, v in fields.items():
        if k == "profile_id":
            continue
        if v is None and k != "playlist_loop_single_id":
            continue
        if isinstance(v, str):
            v = v.strip()
        if k in ("banner_align", "banner_valign", "now_playing_design", "now_playing_align", "now_playing_valign", "now_playing_text_transform"):
            v = v.lower()
        elif k in ("banner_pos_x", "banner_pos_y", "now_playing_pos_x", "now_playing_pos_y"):
            v = max(0, min(100, int(v)))
        elif k == "now_playing_scale":
            v = round(max(0.4, min(2.0, float(v))), 2)
        elif k == "now_playing_font_size":
            v = max(8, min(48, int(v)))
        elif k == "playlist_loop_single_id":
            v = v or None
        elif k == "stream_key":
            if v.startswith("******") or "..." in v:
                continue

        setattr(cfg, k, v)
        if engine.active_cfg and hasattr(engine.active_cfg, k):
            setattr(engine.active_cfg, k, v)

        if k == "overlay_title":
            engine.update_banner_title(cfg.overlay_title)
        elif k.startswith("now_playing_") and k not in ("now_playing_align", "now_playing_valign", "now_playing_pos_x", "now_playing_pos_y", "now_playing_custom_pos"):
            update_badge = True

    if update_badge:
        engine.update_now_playing_badge(cfg)

    save_config(cfg)
    safe_cfg = get_safe_config_dict(cfg)
    # Broadcast config change via WebSocket to keep all monitors in sync
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(
            ws_manager.broadcast({"type": "config_update", "config": safe_cfg}),
            loop
        )
    return {"status": "success", "config": safe_cfg}


class StartStreamRequest(BaseModel):
    test_mode: bool = False
    profile_id: Optional[str] = None


@app.post("/api/stream/start")
def start_stream_endpoint(req: StartStreamRequest):
    if not req.test_mode:
        if not cfg.stream_key or not cfg.stream_key.strip():
            raise HTTPException(status_code=400, detail="YouTube Stream Key is required in Settings to start broadcasting.")
        if not cfg.rtmp_url or not cfg.rtmp_url.strip():
            raise HTTPException(status_code=400, detail="RTMP URL is required.")

    try:
        engine.start_stream(cfg, test_mode=req.test_mode)
        return {"status": "started", "stats": engine.get_stats().model_dump()}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/stream/stop")
def stop_stream_endpoint(req: Optional[StopStreamRequest] = None):
    engine.stop_stream()
    return {"status": "stopped", "stats": engine.get_stats().model_dump()}


# Playlist Endpoints
@app.get("/api/playlist")
def get_playlist_endpoint():
    return pm.get_tracks()


@app.post("/api/playlist/upload")
async def upload_audio_endpoint(files: List[UploadFile] = File(...)):
    uploaded_tracks = []
    allowed_exts = {".mp3", ".wav", ".aac", ".m4a", ".ogg", ".flac"}

    for upload_file in files:
        ext = Path(upload_file.filename).suffix.lower()
        if ext not in allowed_exts:
            continue

        temp_dest = AUDIO_DIR / f"_upload_{upload_file.filename}"
        with open(temp_dest, "wb") as buffer:
            shutil.copyfileobj(upload_file.file, buffer)

        track = pm.add_file(temp_dest, upload_file.filename)
        uploaded_tracks.append(track)

    return {"uploaded": len(uploaded_tracks), "tracks": pm.get_tracks()}


@app.delete("/api/playlist/{track_id}")
def delete_track_endpoint(track_id: str):
    success = pm.delete_track(track_id)
    if not success:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"status": "deleted", "tracks": pm.get_tracks()}


@app.delete("/api/playlist")
def clear_playlist_endpoint():
    count = pm.clear_all_tracks()
    return {"status": "cleared", "deleted_count": count, "tracks": []}


class MoveTrackRequest(BaseModel):
    track_id: str
    direction: str  # "up", "down", "first", "last"


@app.post("/api/playlist/move")
def move_track_endpoint(req: MoveTrackRequest):
    success = pm.move(req.track_id, req.direction)
    if not success:
        raise HTTPException(status_code=400, detail="Unable to move track")
    return {"status": "moved", "tracks": pm.get_tracks()}


class ToggleTrackRequest(BaseModel):
    track_id: str
    enabled: Optional[bool] = None


@app.post("/api/playlist/toggle")
def toggle_track_endpoint(req: ToggleTrackRequest):
    success = pm.toggle_track(req.track_id, req.enabled)
    if not success:
        raise HTTPException(status_code=404, detail="Track not found")
    return {"status": "updated", "tracks": pm.get_tracks()}


class SelectAllRequest(BaseModel):
    enabled: bool


@app.post("/api/playlist/select_all")
def select_all_tracks_endpoint(req: SelectAllRequest):
    pm.select_all(req.enabled)
    return {"status": "updated", "tracks": pm.get_tracks()}


class ReorderRequest(BaseModel):
    track_ids: List[str]


@app.post("/api/playlist/reorder")
def reorder_playlist_endpoint(req: ReorderRequest):
    pm.reorder(req.track_ids)
    return {"status": "reordered", "tracks": pm.get_tracks()}


# Visuals Endpoints
@app.get("/api/visuals")
def get_visuals_endpoint():
    VISUALS_DIR.mkdir(parents=True, exist_ok=True)
    visuals = []
    valid_exts = {".png", ".jpg", ".jpeg", ".mp4", ".webm", ".gif"}

    for p in VISUALS_DIR.iterdir():
        if p.suffix.lower() in valid_exts:
            visuals.append({
                "id": p.name,
                "name": p.stem.replace("_", " ").title(),
                "filename": p.name,
                "is_video": p.suffix.lower() in {".mp4", ".webm"},
                "url": f"/media/visuals/{p.name}",
            })

    active = cfg.active_visual_id
    if not active and visuals:
        active = visuals[0]["id"]

    return {"active": active, "visuals": visuals}


@app.post("/api/visuals/upload")
async def upload_visual_endpoint(file: UploadFile = File(...)):
    ext = Path(file.filename).suffix.lower()
    valid_exts = {".png", ".jpg", ".jpeg", ".mp4", ".webm", ".gif"}
    if ext not in valid_exts:
        raise HTTPException(status_code=400, detail="Invalid visual file type. Use PNG, JPG, GIF, or MP4.")

    dest = VISUALS_DIR / file.filename
    with open(dest, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    cfg.active_visual_id = file.filename
    save_config(cfg)
    return {"status": "uploaded", "active": file.filename}


class SelectVisualRequest(BaseModel):
    visual_id: str


@app.post("/api/visuals/select")
def select_visual_endpoint(req: SelectVisualRequest):
    p = VISUALS_DIR / req.visual_id
    if not p.exists():
        raise HTTPException(status_code=404, detail="Visual file not found")

    cfg.active_visual_id = req.visual_id
    if engine.active_cfg:
        engine.active_cfg.active_visual_id = req.visual_id
    save_config(cfg)

    # Broadcast updated active visual to all connected clients
    if loop and loop.is_running():
        asyncio.run_coroutine_threadsafe(
            ws_manager.broadcast({
                "type": "visual_update",
                "active_visual_id": req.visual_id,
            }),
            loop
        )
    return {"status": "selected", "active": req.visual_id}


@app.delete("/api/visuals/{visual_id}")
def delete_visual_endpoint(visual_id: str):
    p = VISUALS_DIR / visual_id
    if p.exists():
        try:
            p.unlink()
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))

    # If the active visual was deleted, reassign active visual
    if cfg.active_visual_id == visual_id:
        remaining = [
            f.name for f in VISUALS_DIR.iterdir()
            if f.suffix.lower() in {".png", ".jpg", ".jpeg", ".mp4", ".webm", ".gif"}
        ]
        if remaining:
            cfg.active_visual_id = remaining[0]
        else:
            from .demo_generator import generate_demo_visual
            cfg.active_visual_id = generate_demo_visual()
        save_config(cfg)

    return {"status": "deleted", "active": cfg.active_visual_id}


@app.delete("/api/visuals")
def clear_all_visuals_endpoint():
    valid_exts = {".png", ".jpg", ".jpeg", ".mp4", ".webm", ".gif"}
    count = 0
    for p in VISUALS_DIR.iterdir():
        if p.suffix.lower() in valid_exts and p.name != "demo_lofi_sunset.png":
            try:
                p.unlink()
                count += 1
            except Exception:
                pass

    from .demo_generator import generate_demo_visual
    demo_name = generate_demo_visual()
    cfg.active_visual_id = demo_name
    save_config(cfg)
    return {"status": "cleared", "deleted_count": count, "active": demo_name}


# Video Media Endpoints (Direct MP4 Broadcasting)
@app.get("/api/media/videos")
def get_videos_endpoint():
    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    valid_exts = {".mp4", ".mov", ".webm", ".mkv"}
    videos = []

    for p in sorted(VIDEOS_DIR.iterdir()):
        if p.suffix.lower() in valid_exts and not p.name.startswith("_temp_"):
            info = probe_video_info(p)
            videos.append({
                "id": p.name,
                "name": p.stem.replace("_", " ").title(),
                "filename": p.name,
                "url": f"/media/videos/{p.name}",
                "width": info["width"],
                "height": info["height"],
                "resolution": f"{info['width']}x{info['height']}",
                "duration": info["duration"],
                "duration_formatted": info["duration_formatted"],
                "size_formatted": info["size_formatted"],
                "has_audio": info["has_audio"],
            })

    active = cfg.active_video_id
    valid_ids = {v["id"] for v in videos}
    if active not in valid_ids:
        active = videos[0]["id"] if videos else None
        if active:
            cfg.active_video_id = active
            save_config(cfg)

    return {
        "stream_mode": cfg.stream_mode,
        "active": active,
        "loop_video": cfg.loop_video,
        "show_banner_in_video": cfg.show_banner_in_video,
        "videos": videos,
    }


@app.post("/api/media/videos/upload")
async def upload_video_endpoint(file: UploadFile = File(...)):
    ext = Path(file.filename).suffix.lower()
    valid_exts = {".mp4", ".mov", ".webm", ".mkv"}
    if ext not in valid_exts:
        raise HTTPException(status_code=400, detail="Invalid video file type. Use MP4, MOV, WEBM, or MKV.")

    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    dest = VIDEOS_DIR / file.filename
    with open(dest, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    cfg.active_video_id = file.filename
    cfg.stream_mode = "video"
    save_config(cfg)
    return {"status": "uploaded", "active": file.filename, "stream_mode": "video"}


class SelectVideoRequest(BaseModel):
    video_id: str
    stream_mode: Optional[str] = "video"


@app.post("/api/media/videos/select")
def select_video_endpoint(req: SelectVideoRequest):
    cfg.active_video_id = req.video_id
    if req.stream_mode:
        cfg.stream_mode = req.stream_mode
    save_config(cfg)
    return {"status": "selected", "active": req.video_id, "stream_mode": cfg.stream_mode}


@app.delete("/api/media/videos/{video_id}")
def delete_video_endpoint(video_id: str):
    p = VIDEOS_DIR / video_id
    deleted = False
    if p.exists():
        try:
            p.unlink()
            deleted = True
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    return {"status": "deleted" if deleted else "not_found"}


# ==========================================
# PLAYLIST PLAY (MULTI-VIDEO SEQUENTIAL BROADCAST) ENDPOINTS
# ==========================================
@app.get("/api/playlist_play")
def get_playlist_play_endpoint():
    items = vpm.get_items()
    selected_items = [it for it in items if getattr(it, "enabled", True)]
    total_dur = sum(it.duration for it in selected_items)
    return {
        "items": items,
        "count": len(items),
        "selected_count": len(selected_items),
        "total_duration": total_dur,
        "total_duration_formatted": format_video_dur(total_dur),
        "playlist_loop_single_id": cfg.playlist_loop_single_id,
        "show_banner_in_playlist": cfg.show_banner_in_playlist,
    }


@app.post("/api/playlist_play/upload")
async def upload_playlist_play_endpoint(files: List[UploadFile] = File(...)):
    valid_exts = {".mp4", ".mov", ".webm", ".mkv"}
    uploaded_items = []
    VIDEO_PLAYLIST_DIR.mkdir(parents=True, exist_ok=True)

    for upload_file in files:
        ext = Path(upload_file.filename).suffix.lower()
        if ext not in valid_exts:
            continue

        temp_dest = VIDEO_PLAYLIST_DIR / f"_temp_{upload_file.filename}"
        with open(temp_dest, "wb") as buffer:
            shutil.copyfileobj(upload_file.file, buffer)

        item = vpm.add_file(temp_dest, upload_file.filename)
        uploaded_items.append(item)

    items = vpm.get_items()
    total_dur = sum(it.duration for it in items)
    return {
        "status": "uploaded",
        "uploaded_count": len(uploaded_items),
        "items": items,
        "count": len(items),
        "total_duration": total_dur,
        "total_duration_formatted": format_video_dur(total_dur),
    }


class PlaylistPlayReorderRequest(BaseModel):
    item_ids: List[str]


def _format_playlist_play_response(status: str, items: Optional[list] = None, deleted_count: Optional[int] = None) -> dict:
    all_items = items if items is not None else vpm.get_items()
    active = [it for it in all_items if getattr(it, "enabled", True)]
    total_dur = sum(it.duration for it in active)
    resp = {
        "status": status,
        "items": all_items,
        "count": len(all_items),
        "total_duration": total_dur,
        "total_duration_formatted": format_video_dur(total_dur),
    }
    if deleted_count is not None:
        resp["deleted_count"] = deleted_count
    return resp


@app.post("/api/playlist_play/reorder")
def reorder_playlist_play_endpoint(req: PlaylistPlayReorderRequest):
    vpm.reorder(req.item_ids)
    return _format_playlist_play_response("reordered")


class MovePlaylistItemRequest(BaseModel):
    video_id: str
    direction: str  # "up" or "down"


@app.post("/api/playlist_play/move")
def move_playlist_play_endpoint(req: MovePlaylistItemRequest):
    if not vpm.move(req.video_id, req.direction):
        raise HTTPException(status_code=400, detail="Unable to move playlist item")
    return _format_playlist_play_response("moved")


class TogglePlaylistItemRequest(BaseModel):
    video_id: str
    enabled: Optional[bool] = None


@app.post("/api/playlist_play/toggle")
def toggle_playlist_play_endpoint(req: TogglePlaylistItemRequest):
    if not vpm.toggle_item(req.video_id, req.enabled):
        raise HTTPException(status_code=404, detail="Video not found in playlist")
    return _format_playlist_play_response("updated")


@app.post("/api/playlist_play/select_all")
def select_all_playlist_play_endpoint(req: SelectAllRequest):
    vpm.select_all(req.enabled)
    return _format_playlist_play_response("updated")


@app.delete("/api/playlist_play/{video_id}")
def delete_playlist_play_endpoint(video_id: str):
    if not vpm.delete_item(video_id):
        raise HTTPException(status_code=404, detail="Video item not found in playlist")
    return _format_playlist_play_response("deleted")


@app.delete("/api/playlist_play")
def clear_playlist_play_endpoint():
    count = vpm.clear_all()
    return _format_playlist_play_response("cleared", items=[], deleted_count=count)


@app.post("/api/demo/generate")
def generate_demo_endpoint():
    result = ensure_demo_media()
    pm._load()
    return {"status": "generated", "data": result, "tracks": pm.get_tracks()}


# WebSocket for Live Logs & Real-time Stats
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await ws_manager.connect(websocket)
    try:
        # Send initial state and log history
        init_payload = {
            "type": "init",
            "stats": engine.get_stats().model_dump(),
            "logs": engine.recent_logs,
        }
        await websocket.send_json(init_payload)

        while True:
            # Keep connection alive & accept incoming ping/command
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


# Static File Mounts
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")


@app.get("/")
def read_root():
    return FileResponse(str(STATIC_DIR / "index.html"))
