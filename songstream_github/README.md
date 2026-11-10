# 🎵 SongStream Studio - 24/7 YouTube Live Music Broadcaster

**SongStream** is a modern, high-performance web application and streaming engine built to broadcast **24/7 music/radio live streams directly to YouTube Live** (and other RTMP platforms like Twitch, Kick, or Facebook Live).

It features a browser-based broadcast studio dashboard, seamless playlist sequencing, real-time audio visualizers, dynamic "Now Playing" on-screen overlays, and a live encoding engine powered by FastAPI and FFmpeg.

---

## ✨ Features

- **🚀 24/7 YouTube Live RTMP Engine**: Connects directly to YouTube Live ingestion servers (`rtmp://a.rtmp.youtube.com/live2`) using YouTube-recommended H.264/AAC encoding parameters (2-second GOP keyframes, 44.1kHz audio).
- **🎶 Seamless Audio Playlist**:
  - Drag-and-drop upload for multiple songs (`.mp3`, `.wav`, `.aac`, `.flac`, `.ogg`, `.m4a`).
  - Automatic ID3 tag metadata extraction (song title, artist, duration, bitrate) via Mutagen.
  - Glitch-free continuous audio loop — no audio clipping or PTS timestamp drift between songs.
- **🎨 Visuals & Background Loops**:
  - Support for looping background video files (`.mp4`, `.webm`) or high-res artwork (`.png`, `.jpg`, `.gif`).
  - Bundled synthetic **lo-fi sunset artwork generator** and **ambient chill tracks** for instant 1-click testing.
- **🌊 Real-time Audio Visualizers**:
  - Choose between **Dynamic Waveforms** (oscilloscope) or **Frequency Spectrum Bars**.
  - 5 aesthetic color themes (Neon Cyan, Electric Purple, Sunset Rose, Matrix Green, Warm Amber).
- **🏷️ Dynamic On-Screen Overlays**:
  - Configurable top stream banner title (e.g. *Lofi Hip Hop Radio - Beats to Relax/Study to*).
  - Dynamic **"Now Playing"** badge that automatically reloads and displays the current track and artist on-stream as songs advance without interrupting the live broadcast.
- **🎧 In-Browser Live Studio Monitor**:
  - 16:9 canvas preview rendering the active visual background and real-time audio reactive waves via Web Audio API.
  - Built-in audio player with scrub bar, play/pause, volume slider, and track preview.
- **🧪 Local Test Stream Mode**:
  - Test encoding performance, CPU usage, and filter graph locally before broadcasting to YouTube.
- **📊 Real-time Stream Console**:
  - WebSocket-powered terminal feed streaming FFmpeg logs, FPS, Bitrate, Speed, Uptime, and connection status live to the browser.
- **🔒 Secure Stream Key Management**:
  - Masked stream key inputs with local configuration persistence (`config.json`).

---

## 🛠️ Tech Stack

- **Backend**: Python 3.11, [FastAPI](https://fastapi.tiangolo.com/), [Uvicorn](https://www.uvicorn.org/), [Mutagen](https://mutagen.readthedocs.io/), [Pillow](https://pillow.readthedocs.io/), [FFmpeg](https://ffmpeg.org/)
- **Frontend**: Modern HTML5, Vanilla JavaScript, Web Audio API, Canvas 2D, Responsive CSS with `color-scheme: dark;` support

---

## 🚀 Quick Start Guide

### 1. Prerequisites
- **Python 3.10+**: Ensure Python is installed and added to PATH.
- **FFmpeg**: Ensure `ffmpeg` and `ffprobe` are installed and accessible in your system terminal.

### 2. Launch the Application

#### Option A: 1-Click Launcher (Windows)
Double-click `run.bat` in the project root:
```bat
run.bat
```
This script automatically checks Python and FFmpeg, installs any missing packages, launches the server, and opens your browser at `http://localhost:8000`.

#### Option B: Terminal Command
```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the web studio
python run.py
```
Open **[http://localhost:8000](http://localhost:8000)** in your browser.

---

## 🔴 How to Broadcast to YouTube Live

### Step 1: Obtain Your YouTube Stream Key
1. Go to **[YouTube Studio](https://studio.youtube.com)**.
2. In the top-right corner, click **Create** ➔ **Go Live**.
3. In the left navigation, select **Stream** (encoder stream).
4. Under **Stream Settings**, find the **Stream key** field (format: `xxxx-xxxx-xxxx-xxxx-xxxx`).
5. Click **Copy**. *(Never share your stream key publicly!)*

> *Note: If you have never live streamed before on YouTube, YouTube requires a one-time 24-hour verification waiting period.*

### Step 2: Configure SongStream
1. Open the SongStream web studio (`http://localhost:8000`).
2. Navigate to the **"Stream Setup"** tab on the right panel.
3. Paste your YouTube stream key into the **YouTube Stream Key** field.
4. (Optional) Adjust your resolution (720p or 1080p), framerate (30 or 60 fps), and video bitrate (default: 3000 kbps).
5. Click **Save Encoder Settings**.

### Step 3: Add Music & Background
1. **Music Tab**: Drag and drop your MP3/WAV tracks, or click **"+ Load Demo Music"** for instant sample ambient tracks.
2. **Visuals Tab**: Select or upload your preferred background image or looping video, and pick your visualizer style (Waveform, Spectrum, or Clean).
3. Click **"Apply Visual Settings"**.

### Step 4: Go Live!
1. Click the red **"Go Live on YouTube"** button at the top right.
2. The status badge will change to **🔴 LIVE ON YOUTUBE**, and the console will show connection logs.
3. Go back to YouTube Studio — within 5–15 seconds, YouTube will show **"Excellent Connection"** and display your live stream!
4. Click **"Stop Broadcast"** in SongStream when you are ready to conclude your broadcast.

---

## ⚙️ Encoder Optimization Guidelines

| Resolution | Framerate | Recommended Video Bitrate | CPU Preset | Recommended For |
|---|---|---|---|---|
| **720p (1280x720)** | 30 FPS | `2500k` – `3000k` | `veryfast` | **Most stable for 24/7 radio** (minimal CPU load) |
| **1080p (1920x1080)** | 30 FPS | `4000k` – `4500k` | `veryfast` | Standard Full HD broadcast |
| **1080p (1920x1080)** | 60 FPS | `6000k` | `faster` or `veryfast` | High FPS gaming/visual streams |

---

## 📁 Project Structure

```
e:\songstream\
├── backend\
│   ├── config.py            # Stream & encoder configuration persistence
│   ├── demo_generator.py    # Generates initial lo-fi artwork and synth tracks
│   ├── main.py              # FastAPI application, REST endpoints, WebSocket
│   ├── playlist_manager.py  # Playlist state, ID3 metadata parser, audio compiler
│   └── streamer.py          # FFmpeg live broadcast engine & stats monitor
├── media\
│   ├── audio\               # Uploaded MP3/WAV/AAC songs
│   ├── visuals\             # Uploaded background images & video loops
│   └── cache\               # Dynamic compiled audio & now-playing text files
├── static\
│   ├── index.html           # Broadcast studio dashboard UI
│   ├── css\
│   │   └── style.css        # Modern cyber dark theme & responsive layout
│   └── js\
│       ├── app.js           # UI logic, WebSocket stats, API controller
│       ├── player.js        # In-browser audio player with Web Audio API
│       └── visualizer.js    # Canvas 2D reactive audio visualizer
├── requirements.txt         # Python package dependencies
├── run.bat                  # 1-click Windows launcher
├── run.py                   # Python entrypoint
└── README.md                # Documentation & YouTube Live instructions
```

---

## 🛡️ License
MIT License. Created for creators and broadcasters.
