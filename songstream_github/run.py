import os
import sys
import webbrowser
import uvicorn

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "127.0.0.1")
    url = f"http://{host}:{port}"
    print("=" * 60)
    print(f"🎵 SongStream Studio starting at: {url}")
    print("=" * 60)
    
    try:
        webbrowser.open(url)
    except Exception:
        pass

    uvicorn.run("backend.main:app", host=host, port=port, reload=False)
