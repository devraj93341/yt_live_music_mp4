/**
 * SongStream In-Browser Live Canvas & Audio Visualizer Renderer
 *
 * Architecture:
 * - Independent Music Artwork Channel (this.musicVideo & this.musicImage):
 *   Used exclusively for 24/7 Lo-Fi Music Radio. Looping, permanently muted,
 *   never interferes with audio playback or broadcast videos.
 * - Independent Broadcast Video Channel (this.broadcastVideo):
 *   Used exclusively for Direct MP4 Video and Playlist Play modes.
 *   Connected to monitor play/pause/scrubber controls and sequence events.
 */
class VisualizerRenderer {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.canvas.width = 1920;
    this.canvas.height = 1080;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.width = this.canvas.width;
    this.height = this.canvas.height;

    this.style = 'waves'; // 'waves', 'spectrum', 'none'
    this.colorTheme = 'cyan_neon';

    // 1. Independent Music Artwork Channel
    this.musicImage = null;
    this.musicVideo = null;
    this.musicCurrentUrl = null;

    // 2. Independent Broadcast Video Channel (Direct Video / Playlist)
    this.broadcastVideo = null;
    this.broadcastCurrentUrl = null;

    // Web Audio analyzer
    this.analyser = null;
    this.dataArray = null;

    this.animFrameId = null;
    this.simulatedTime = 0;
    this.volume = 0.8;
    this.isMuted = false;
    this.isLooping = true;
    this.onVideoEnded = null;
    this.onVideoTimeUpdate = null;
    this.onVideoPlayStateChange = null;

    this.colorThemes = {
      cyan_neon: ['#00f2fe', '#4facfe'],
      purple_neon: ['#d946ef', '#8b5cf6'],
      sunset: ['#f43f5e', '#fb923c'],
      matrix: ['#22c55e', '#10b981'],
      amber: ['#f59e0b', '#d97706'],
    };

    this.startLoop();
  }

  // Backwards compatibility getter
  get bgVideo() {
    const mode = window.getAppMode ? window.getAppMode() : 'radio';
    return (mode === 'video' || mode === 'playlist_play')
      ? (this.broadcastVideo || this.musicVideo)
      : (this.musicVideo || this.broadcastVideo);
  }

  get currentUrl() {
    const mode = window.getAppMode ? window.getAppMode() : 'radio';
    return (mode === 'video' || mode === 'playlist_play')
      ? this.broadcastCurrentUrl
      : this.musicCurrentUrl;
  }

  setAnalyser(analyser) {
    this.analyser = analyser;
    if (this.analyser) {
      const bufferLength = this.analyser.frequencyBinCount;
      this.dataArray = new Uint8Array(bufferLength);
    }
  }

  /* =========================================================================
     CHANNEL 1: MUSIC RADIO ARTWORK BACKGROUND (ISOLATED & INDEPENDENT)
     ========================================================================= */
  setMusicBackground(url, isVideo = false) {
    if (!url) return;
    this.musicCurrentUrl = url;

    if (isVideo) {
      // Clear image
      this.musicImage = null;

      if (!this.musicVideo) {
        this.musicVideo = document.createElement('video');
        this.musicVideo.id = 'musicArtworkBgVideo';
        this.musicVideo.crossOrigin = 'anonymous';
        this.musicVideo.playsInline = true;
        this.musicVideo.setAttribute('playsinline', '');
        this.musicVideo.muted = true;
        this.musicVideo.setAttribute('muted', '');
        this.musicVideo.defaultMuted = true;
        this.musicVideo.autoplay = true;
        this.musicVideo.setAttribute('autoplay', '');
        this.musicVideo.loop = true;
        this.musicVideo.volume = 0;
        this.musicVideo.style.position = 'fixed';
        this.musicVideo.style.left = '-9999px';
        this.musicVideo.style.top = '-9999px';
        this.musicVideo.style.width = '1px';
        this.musicVideo.style.height = '1px';
        this.musicVideo.style.opacity = '0';
        this.musicVideo.style.pointerEvents = 'none';
        document.body.appendChild(this.musicVideo);

        // Auto-loop on ended
        this.musicVideo.addEventListener('ended', () => {
          if (this.musicVideo) {
            this.musicVideo.currentTime = 0;
            this.musicVideo.play().catch(() => {});
          }
        });

        // Self-heal: keep playing continuously without stopping
        this.musicVideo.addEventListener('pause', () => {
          const mode = window.getAppMode ? window.getAppMode() : 'radio';
          if (mode === 'radio' && this.musicVideo) {
            setTimeout(() => {
              if (this.musicVideo && this.musicVideo.paused) {
                this.musicVideo.play().catch(() => {});
              }
            }, 50);
          }
        });

        this.musicVideo.addEventListener('error', (err) => {
          console.warn('[Visualizer] Music video background error:', err);
        });
      }

      this.musicVideo.muted = true;
      this.musicVideo.loop = true;

      const cur = decodeURI(this.musicVideo.src || '');
      const tgt = decodeURI(url || '');
      const isSame = (cur === tgt) || cur.endsWith(tgt);

      const playMusicVideo = () => {
        if (!this.musicVideo) return;
        this.musicVideo.muted = true;
        this.musicVideo.play().catch(() => {});
      };

      if (!isSame) {
        this.musicVideo.src = url;
        this.musicVideo.load();
        if (this.musicVideo.readyState >= 2) {
          playMusicVideo();
        } else {
          this.musicVideo.addEventListener('canplay', playMusicVideo, { once: true });
          this.musicVideo.addEventListener('loadeddata', playMusicVideo, { once: true });
        }
      } else {
        if (this.musicVideo.paused) {
          playMusicVideo();
        }
      }
    } else {
      // Image Artwork Background
      this.clearMusicVideo();
      const img = new Image();
      if (!url.startsWith('data:')) {
        img.crossOrigin = 'anonymous';
      }
      img.onload = () => {
        this.musicImage = img;
      };
      img.onerror = () => {
        const fb = new Image();
        fb.onload = () => {
          this.musicImage = fb;
        };
        fb.src = url;
      };
      img.src = url;
    }
  }

  clearMusicVideo() {
    if (this.musicVideo) {
      try {
        this.musicVideo.pause();
        this.musicVideo.removeAttribute('src');
        this.musicVideo.load();
        if (this.musicVideo.parentNode) {
          this.musicVideo.parentNode.removeChild(this.musicVideo);
        }
      } catch (e) {}
      this.musicVideo = null;
    }
  }

  /* =========================================================================
     CHANNEL 2: BROADCAST VIDEO (DIRECT VIDEO & PLAYLIST PLAY - ISOLATED)
     ========================================================================= */
  setBroadcastVideo(url, isLooping = false) {
    if (!url) return;
    this.broadcastCurrentUrl = url;

    if (!this.broadcastVideo) {
      this.broadcastVideo = document.createElement('video');
      this.broadcastVideo.id = 'broadcastVideoPlayer';
      this.broadcastVideo.crossOrigin = 'anonymous';
      this.broadcastVideo.playsInline = true;
      this.broadcastVideo.muted = this.isMuted;
      this.broadcastVideo.loop = isLooping;
      this.broadcastVideo.volume = this.volume;
      this.broadcastVideo.style.position = 'fixed';
      this.broadcastVideo.style.left = '-9999px';
      this.broadcastVideo.style.top = '-9999px';
      this.broadcastVideo.style.width = '1px';
      this.broadcastVideo.style.height = '1px';
      this.broadcastVideo.style.opacity = '0';
      this.broadcastVideo.style.pointerEvents = 'none';
      document.body.appendChild(this.broadcastVideo);

      this.broadcastVideo.addEventListener('timeupdate', () => {
        if (this.onVideoTimeUpdate && this.broadcastVideo) {
          this.onVideoTimeUpdate(this.broadcastVideo.currentTime, this.broadcastVideo.duration || 0);
        }
      });

      this.broadcastVideo.addEventListener('play', () => {
        if (this.onVideoPlayStateChange) {
          this.onVideoPlayStateChange(true);
        }
      });

      this.broadcastVideo.addEventListener('pause', () => {
        if (this.onVideoPlayStateChange) {
          this.onVideoPlayStateChange(false);
        }
      });

      this.broadcastVideo.addEventListener('ended', () => {
        if (this.onVideoEnded) {
          this.onVideoEnded();
        }
      });

      this.broadcastVideo.addEventListener('error', (err) => {
        console.warn('[Visualizer] Broadcast video error:', err);
      });
    }

    this.broadcastVideo.loop = isLooping;
    this.broadcastVideo.muted = this.isMuted;
    this.broadcastVideo.volume = this.volume;

    const cur = decodeURI(this.broadcastVideo.src || '');
    const tgt = decodeURI(url || '');
    const isSame = (cur === tgt) || cur.endsWith(tgt);

    const playBroadcast = () => {
      if (!this.broadcastVideo) return;
      this.broadcastVideo.play().catch((err) => {
        if (err.name === 'NotAllowedError') {
          this.broadcastVideo.muted = true;
          this.broadcastVideo.play().catch(() => {});
        }
      });
    };

    if (!isSame) {
      this.broadcastVideo.src = url;
      this.broadcastVideo.load();
      this.broadcastVideo.addEventListener('canplay', playBroadcast, { once: true });
      playBroadcast();
    } else {
      if (this.broadcastVideo.ended || this.broadcastVideo.currentTime >= (this.broadcastVideo.duration || 0)) {
        this.broadcastVideo.currentTime = 0;
      }
      playBroadcast();
    }
  }

  stopBroadcastVideo() {
    if (this.broadcastVideo) {
      this.broadcastVideo.pause();
      this.broadcastVideo.currentTime = 0;
      if (this.onVideoPlayStateChange) {
        this.onVideoPlayStateChange(false);
      }
      if (this.onVideoTimeUpdate) {
        this.onVideoTimeUpdate(0, this.broadcastVideo.duration || 0);
      }
    }
  }

  clearBroadcastVideo() {
    if (this.broadcastVideo) {
      try {
        this.broadcastVideo.pause();
        this.broadcastVideo.removeAttribute('src');
        this.broadcastVideo.load();
        if (this.broadcastVideo.parentNode) {
          this.broadcastVideo.parentNode.removeChild(this.broadcastVideo);
        }
      } catch (e) {}
      this.broadcastVideo = null;
      this.broadcastCurrentUrl = null;
    }
  }

  /* =========================================================================
     BACKWARDS-COMPATIBILITY METHODS FOR EXISTING APP CONTROLS
     ========================================================================= */
  setBackground(url, isVideo = false, autoPlay = true) {
    const mode = window.getAppMode ? window.getAppMode() : 'radio';
    if (mode === 'video' || mode === 'playlist_play') {
      this.setBroadcastVideo(url, Boolean(this.isLooping));
    } else {
      this.setMusicBackground(url, isVideo);
    }
  }

  stopVideo(destroy = false) {
    this.stopBroadcastVideo();
    if (destroy) {
      this.clearBroadcastVideo();
    }
  }

  clearVideo() {
    this.clearBroadcastVideo();
    this.clearMusicVideo();
  }

  pauseVideo() {
    if (this.broadcastVideo) {
      this.broadcastVideo.pause();
    }
  }

  resumeVideo() {
    if (this.broadcastVideo && this.broadcastVideo.paused) {
      this.broadcastVideo.play().catch(() => {});
    }
  }

  togglePlayVideo() {
    if (!this.broadcastVideo) return false;
    if (this.broadcastVideo.paused) {
      this.resumeVideo();
      return true;
    } else {
      this.pauseVideo();
      return false;
    }
  }

  seekVideo(timeInSec) {
    if (this.broadcastVideo && !isNaN(timeInSec) && isFinite(timeInSec)) {
      this.broadcastVideo.currentTime = Math.max(0, Math.min(this.broadcastVideo.duration || 0, timeInSec));
    }
  }

  setVideoLoop(shouldLoop) {
    this.isLooping = Boolean(shouldLoop);
    if (this.broadcastVideo) {
      this.broadcastVideo.loop = this.isLooping;
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    if (this.broadcastVideo) {
      this.broadcastVideo.volume = this.volume;
      this.broadcastVideo.muted = (this.volume === 0 || this.isMuted);
    }
  }

  setMute(isMuted) {
    this.isMuted = Boolean(isMuted);
    if (this.broadcastVideo) {
      this.broadcastVideo.muted = this.isMuted;
    }
  }

  isVideoPlaying() {
    return Boolean(this.broadcastVideo && !this.broadcastVideo.paused && !this.broadcastVideo.ended);
  }

  isVideoPaused() {
    return Boolean(this.broadcastVideo && this.broadcastVideo.paused);
  }

  setVisualizerConfig(style, colorTheme) {
    this.style = style || 'waves';
    this.colorTheme = colorTheme || 'cyan_neon';
  }

  /* =========================================================================
     MAIN RENDER LOOP (DRAWS ACCORDING TO ACTIVE BROADCAST MODE)
     ========================================================================= */
  startLoop() {
    const render = () => {
      this.draw();
      this.animFrameId = requestAnimationFrame(render);
    };
    render();
  }

  draw() {
    const { ctx, width, height } = this;
    this.simulatedTime += 0.03;

    const mode = window.getAppMode ? window.getAppMode() : 'radio';

    // 1. Draw Background based on active mode
    if (mode === 'video' || mode === 'playlist_play') {
      // Broadcast Video Mode (Direct MP4 or Sequential Playlist)
      if (this.broadcastVideo && this.broadcastVideo.readyState >= 2) {
        ctx.drawImage(this.broadcastVideo, 0, 0, width, height);
      } else {
        this.drawFallbackGradient(ctx, width, height);
      }
    } else {
      // Music Radio Mode (Artwork Visualizer - Image or Looping Background Video)
      if (this.musicVideo && this.musicVideo.readyState >= 2) {
        ctx.drawImage(this.musicVideo, 0, 0, width, height);
      } else if (this.musicImage && this.musicImage.complete && this.musicImage.naturalWidth > 0) {
        ctx.drawImage(this.musicImage, 0, 0, width, height);
      } else {
        this.drawFallbackGradient(ctx, width, height);
      }
    }

    // 2. Draw Audio Visualizer (only in Music Radio mode)
    if (mode === 'radio' && this.style !== 'none') {
      const themeColors = this.colorThemes[this.colorTheme] || this.colorThemes['cyan_neon'];
      if (this.style === 'waves') {
        this.drawWaveform(themeColors);
      } else if (this.style === 'spectrum') {
        this.drawSpectrum(themeColors);
      }
    }
  }

  drawFallbackGradient(ctx, width, height) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#0f172a');
    grad.addColorStop(1, '#020617');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  drawWaveform(colors) {
    const { ctx, width, height } = this;
    const waveY = height * 0.82;
    const waveHeight = height * 0.12;

    ctx.save();
    ctx.lineWidth = 3;
    const grad = ctx.createLinearGradient(0, waveY - waveHeight, width, waveY + waveHeight);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1]);
    ctx.strokeStyle = grad;
    ctx.shadowColor = colors[0];
    ctx.shadowBlur = 10;

    ctx.beginPath();

    let hasAudio = false;
    if (this.analyser && this.dataArray) {
      this.analyser.getByteTimeDomainData(this.dataArray);
      for (let i = 0; i < 20; i++) {
        if (Math.abs(this.dataArray[i * 10] - 128) > 2) {
          hasAudio = true;
          break;
        }
      }
    }

    if (hasAudio) {
      const sliceWidth = width / this.dataArray.length;
      let x = 0;
      for (let i = 0; i < this.dataArray.length; i++) {
        const v = this.dataArray[i] / 128.0;
        const y = waveY + (v - 1.0) * waveHeight * 1.5;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
    } else {
      // Ambient animated sine wave when idle
      const points = 120;
      for (let i = 0; i <= points; i++) {
        const x = (i / points) * width;
        const y =
          waveY +
          Math.sin(i * 0.12 + this.simulatedTime) * 12 +
          Math.cos(i * 0.06 - this.simulatedTime * 0.8) * 8;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
    }

    ctx.stroke();
    ctx.restore();
  }

  drawSpectrum(colors) {
    const { ctx, width, height } = this;
    const maxBarHeight = height * 0.22;
    const barCount = 64;
    const barWidth = (width / barCount) * 0.75;
    const barSpacing = (width / barCount) * 0.25;

    ctx.save();
    let hasAudio = false;

    if (this.analyser && this.dataArray) {
      this.analyser.getByteFrequencyData(this.dataArray);
      for (let i = 0; i < 15; i++) {
        if (this.dataArray[i] > 5) {
          hasAudio = true;
          break;
        }
      }
    }

    for (let i = 0; i < barCount; i++) {
      let val = 0;
      if (hasAudio && this.dataArray) {
        const dataIdx = Math.floor((i / barCount) * (this.dataArray.length * 0.6));
        val = this.dataArray[dataIdx] / 255.0;
      } else {
        val = (Math.sin(i * 0.3 + this.simulatedTime * 1.5) * 0.5 + 0.5) * 0.25;
      }

      const barH = Math.max(4, val * maxBarHeight);
      const x = i * (barWidth + barSpacing) + barSpacing / 2;
      const y = height - barH - 20;

      const grad = ctx.createLinearGradient(0, y, 0, y + barH);
      grad.addColorStop(0, colors[1]);
      grad.addColorStop(1, colors[0]);

      ctx.fillStyle = grad;
      ctx.shadowColor = colors[0];
      ctx.shadowBlur = 6;
      ctx.fillRect(x, y, barWidth, barH);
    }

    ctx.restore();
  }
}

window.VisualizerRenderer = VisualizerRenderer;
