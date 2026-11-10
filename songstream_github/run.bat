@echo off
title SongStream - 24/7 YouTube Live Music Studio
echo ========================================================
echo        SongStream - 24/7 YouTube Live Music Studio       
echo ========================================================
echo.

:: Check for Python
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not installed or not in PATH!
    echo Please install Python 3.10+ from python.org and add it to PATH.
    pause
    exit /b 1
)

:: Check for FFmpeg
ffmpeg -version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] FFmpeg is not installed or not in PATH!
    echo Please install FFmpeg and make sure 'ffmpeg' command is in your PATH.
    pause
    exit /b 1
)

echo [1/3] Checking Python dependencies...
python -m pip install -r requirements.txt --quiet

echo [2/3] Starting SongStream Server at http://localhost:8000 ...
start "" "http://localhost:8000"

echo [3/3] Launching FastAPI + Uvicorn backend...
echo Press Ctrl+C in this console to stop the server.
echo.
python -m uvicorn backend.main:app --host 0.0.0.0 --port 8000

pause
