/**
 * SongStream In-Browser Preview Audio Player with Web Audio API Analyzer
 */
class PreviewPlayer {
  constructor(visualizer) {
    this.visualizer = visualizer;
    this.audio = new Audio();
    this.audio.crossOrigin = 'anonymous';

    this.audioContext = null;
    this.analyser = null;
    this.source = null;
    this.isContextInit = false;

    this.playlist = [];
    this.currentIndex = -1;
    this.isPlaying = false;

    // UI elements
    this.btnPlay = document.getElementById('btnPlayerPlay');
    this.btnNext = document.getElementById('btnPlayerNext');
    this.playIcon = document.getElementById('playIcon');
    this.pauseIcon = document.getElementById('pauseIcon');
    this.scrub = document.getElementById('playerScrub');
    this.currTimeEl = document.getElementById('playerCurrentTime');
    this.totalTimeEl = document.getElementById('playerTotalTime');
    this.volumeEl = document.getElementById('playerVolume');

    this.overlayTitle = document.getElementById('overlaySongTitle');
    this.overlayArtist = document.getElementById('overlaySongArtist');

    this.bindEvents();
  }

  initAudioContext() {
    if (this.isContextInit) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.8;

      this.source = this.audioContext.createMediaElementSource(this.audio);
      this.source.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      if (this.visualizer) {
        this.visualizer.setAnalyser(this.analyser);
      }
      this.isContextInit = true;
    } catch (e) {
      console.warn('AudioContext initialization failed or blocked by autoplay policy:', e);
    }
  }

  bindEvents() {
    this.audio.addEventListener('timeupdate', () => {
      if (window.getAppMode && window.getAppMode() !== 'radio') return;
      if (!this.audio.duration) return;
      const progress = (this.audio.currentTime / this.audio.duration) * 100;
      this.scrub.value = progress;
      this.currTimeEl.textContent = this.formatTime(this.audio.currentTime);
      this.totalTimeEl.textContent = this.formatTime(this.audio.duration);
    });

    this.audio.addEventListener('ended', () => {
      if (window.getAppMode && window.getAppMode() !== 'radio') {
        this.stop();
        return;
      }
      this.playNext();
    });

    this.audio.addEventListener('play', () => {
      this.isPlaying = true;
      if (window.getAppMode && window.getAppMode() !== 'radio') return;
      this.playIcon.style.display = 'none';
      this.pauseIcon.style.display = 'inline-block';
    });

    this.audio.addEventListener('pause', () => {
      this.isPlaying = false;
      if (window.getAppMode && window.getAppMode() !== 'radio') return;
      this.playIcon.style.display = 'inline-block';
      this.pauseIcon.style.display = 'none';
    });
  }

  setVolume(val) {
    this.audio.volume = Math.max(0, Math.min(1, val));
  }

  seek(percent) {
    if (this.audio.duration) {
      this.audio.currentTime = (percent / 100) * this.audio.duration;
    }
  }

  setPlaylist(tracks) {
    this.playlist = tracks || [];
    if (this.currentIndex === -1 && this.playlist.length > 0) {
      const firstEnabled = this.playlist.findIndex((t) => t.enabled !== false);
      this.loadTrack(firstEnabled >= 0 ? firstEnabled : 0, false);
    }
  }

  loadTrack(index, autoPlay = true) {
    if (!this.playlist.length) return;
    if (index < 0 || index >= this.playlist.length) {
      index = 0;
    }
    this.currentIndex = index;
    const track = this.playlist[index];

    this.audio.src = `/media/audio/${encodeURIComponent(track.filename)}`;
    this.currTimeEl.textContent = '00:00';
    this.totalTimeEl.textContent = track.duration_formatted || '00:00';
    this.scrub.value = 0;

    // Update overlay badge with smooth fade-in
    if (window.triggerNowPlayingFadeIn) {
      window.triggerNowPlayingFadeIn(track.title, track.artist);
    } else {
      if (this.overlayTitle) this.overlayTitle.textContent = track.title;
      if (this.overlayArtist) this.overlayArtist.textContent = track.artist;
    }

    // Highlight row in playlist table
    document.querySelectorAll('.track-item').forEach((el, i) => {
      el.classList.toggle('playing', i === index);
    });

    if (autoPlay) {
      this.initAudioContext();
      if (this.audioContext && this.audioContext.state === 'suspended') {
        this.audioContext.resume();
      }
      this.audio.play().catch((err) => console.log('Playback paused:', err));
    }
  }

  pause() {
    this.audio.pause();
  }

  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.isPlaying = false;
    this.scrub.value = 0;
    this.currTimeEl.textContent = '00:00';
    this.playIcon.style.display = 'inline-block';
    this.pauseIcon.style.display = 'none';
    document.querySelectorAll('#trackList .track-item').forEach(el => el.classList.remove('playing'));
  }

  togglePlay() {
    this.initAudioContext();
    if (this.audioContext && this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    if (this.audio.paused) {
      if (this.currentIndex === -1 && this.playlist.length > 0) {
        const firstEnabled = this.playlist.findIndex((t) => t.enabled !== false);
        this.loadTrack(firstEnabled >= 0 ? firstEnabled : 0, true);
      } else {
        this.audio.play().catch(() => {});
      }
    } else {
      this.audio.pause();
    }
  }

  playNext() {
    if (!this.playlist.length) return;
    const hasEnabled = this.playlist.some((t) => t.enabled !== false);
    if (!hasEnabled) {
      this.stop();
      return;
    }
    let nextIdx = (this.currentIndex + 1) % this.playlist.length;
    let attempts = 0;
    while (attempts < this.playlist.length) {
      const candidate = this.playlist[nextIdx];
      if (candidate && candidate.enabled !== false) {
        this.loadTrack(nextIdx, true);
        return;
      }
      nextIdx = (nextIdx + 1) % this.playlist.length;
      attempts++;
    }
    this.stop();
  }

  formatTime(secs) {
    if (isNaN(secs) || secs <= 0) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
}

window.PreviewPlayer = PreviewPlayer;
