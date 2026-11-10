/**
 * SongStream Studio - Main Application Logic
 */
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialize Visualizer & Audio Player
  const visualizer = new VisualizerRenderer('previewCanvas');
  const player = new PreviewPlayer(visualizer);

  // 2. State
  let appConfig = {};
  let currentPlaylist = [];
  let currentVisuals = [];
  let currentVideos = [];
  let currentPlaylistPlay = [];
  let ws = null;
  let uptimeInterval = null;
  let streamUptimeSec = 0;

  // DOM Elements
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const uptimeMetric = document.getElementById('uptimeMetric');
  const fpsMetric = document.getElementById('fpsMetric');
  const bitrateMetric = document.getElementById('bitrateMetric');
  const speedMetric = document.getElementById('speedMetric');
  const monitorResolutionTag = document.getElementById('monitorResolutionTag');

  const btnStartLive = document.getElementById('btnStartLive');
  const btnStartTest = document.getElementById('btnStartTest');
  const btnStopStream = document.getElementById('btnStopStream');
  const btnStopTestStream = document.getElementById('btnStopTestStream');

  const consoleLogs = document.getElementById('consoleLogs');
  const btnClearConsole = document.getElementById('btnClearConsole');
  const wsStatusPill = document.getElementById('wsStatusPill');

  const overlayTopTitle = document.getElementById('overlayTopTitle');
  const overlayNowPlaying = document.getElementById('overlayNowPlaying');

  const btnPlayerPlay = document.getElementById('btnPlayerPlay');
  const btnPlayerStop = document.getElementById('btnPlayerStop');
  const btnPlayerNext = document.getElementById('btnPlayerNext');
  const playIcon = document.getElementById('playIcon');
  const pauseIcon = document.getElementById('pauseIcon');
  const playerScrub = document.getElementById('playerScrub');
  const playerCurrentTime = document.getElementById('playerCurrentTime');
  const playerTotalTime = document.getElementById('playerTotalTime');
  const playerVolume = document.getElementById('playerVolume');

  function formatTime(secs) {
    if (isNaN(secs) || secs <= 0 || !isFinite(secs)) return '00:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  window.getAppMode = () => appConfig.stream_mode || 'radio';

  let lastNowPlayingTitle = '';
  function triggerNowPlayingFadeIn(title, artist) {
    if (!overlayNowPlaying) return;
    // Now Playing overlay belongs STRICTLY to Music Radio mode
    if (appConfig.stream_mode !== 'radio' || appConfig.show_now_playing === false) {
      overlayNowPlaying.style.display = 'none';
      return;
    }

    const titleEl = document.getElementById('overlaySongTitle');
    const artistEl = document.getElementById('overlaySongArtist');
    if (!titleEl) return;

    const newTitle = title || '';
    const newArtist = artist || '';
    if (!newTitle) return;

    overlayNowPlaying.style.display = 'flex';

    if (newTitle !== lastNowPlayingTitle || !overlayNowPlaying.classList.contains('fade-in')) {
      lastNowPlayingTitle = newTitle;
      titleEl.textContent = newTitle;
      if (artistEl) artistEl.textContent = newArtist;
      if (overlaySongLabel) overlaySongLabel.textContent = appConfig.now_playing_label || 'Now Playing';

      overlayNowPlaying.classList.remove('fade-in');
      void overlayNowPlaying.offsetWidth;
      overlayNowPlaying.classList.add('fade-in');
    } else {
      titleEl.textContent = newTitle;
      if (artistEl) artistEl.textContent = newArtist;
      if (overlaySongLabel) overlaySongLabel.textContent = appConfig.now_playing_label || 'Now Playing';
    }
  }
  window.triggerNowPlayingFadeIn = triggerNowPlayingFadeIn;

  // Now Playing Badge Customization Controls (Size, Color, Written Text)
  const sliderNowPlayingScale = document.getElementById('cfgNowPlayingScale');
  const labelNowPlayingScale = document.getElementById('nowPlayingScaleValue');
  const presetSizeBtns = document.querySelectorAll('.preset-size-btn');

  const inputNowPlayingColor = document.getElementById('cfgNowPlayingColor');
  const labelNowPlayingColorCode = document.getElementById('nowPlayingColorCode');
  const presetColorBtns = document.querySelectorAll('.preset-color-btn');

  const inputNowPlayingLabel = document.getElementById('cfgNowPlayingLabel');
  const overlaySongLabel = document.getElementById('overlaySongLabel');

  function hexToRgba(hex, alpha = 0.6) {
    if (!hex || !hex.startsWith('#')) return `rgba(0, 242, 254, ${alpha})`;
    const h = hex.replace('#', '');
    const num = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
    if (isNaN(num)) return `rgba(0, 242, 254, ${alpha})`;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function setBadgeScale(scale, save = false) {
    scale = Math.max(0.4, Math.min(2.0, parseFloat(scale) || 0.75));
    appConfig.now_playing_scale = scale;
    if (overlayNowPlaying) {
      overlayNowPlaying.style.setProperty('--badge-scale', scale);
    }
    const pct = Math.round(scale * 100);
    if (sliderNowPlayingScale) sliderNowPlayingScale.value = pct;
    if (labelNowPlayingScale) labelNowPlayingScale.textContent = `${pct}%`;

    presetSizeBtns.forEach((btn) => {
      const btnScale = parseInt(btn.dataset.scale);
      btn.classList.toggle('active', btnScale === pct);
    });

    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ now_playing_scale: scale }),
      }).catch(() => {});
    }
  }

  function setBadgeColor(color, save = false) {
    if (!color) color = '#00f2fe';
    appConfig.now_playing_color = color;
    if (overlayNowPlaying) {
      overlayNowPlaying.style.setProperty('--badge-color', color);
      overlayNowPlaying.style.setProperty('--badge-glow', hexToRgba(color, 0.6));
    }
    if (overlaySongLabel) {
      if (appConfig.now_playing_design !== 'gradient') {
        overlaySongLabel.style.color = color;
      } else {
        overlaySongLabel.style.color = '';
      }
    }
    if (inputNowPlayingColor && inputNowPlayingColor.value !== color) {
      inputNowPlayingColor.value = color;
    }
    if (labelNowPlayingColorCode) {
      labelNowPlayingColorCode.textContent = color;
      labelNowPlayingColorCode.style.color = color;
      labelNowPlayingColorCode.style.borderColor = hexToRgba(color, 0.4);
      labelNowPlayingColorCode.style.background = hexToRgba(color, 0.12);
    }

    presetColorBtns.forEach((btn) => {
      const match = (btn.dataset.color || '').toLowerCase() === color.toLowerCase();
      btn.classList.toggle('active', match);
    });

    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ now_playing_color: color }),
      }).catch(() => {});
    }
  }

  function setBadgeLabel(text, save = false) {
    const labelText = (text !== undefined && text !== null && text.trim() !== '') ? text.trim() : 'Now Playing';
    appConfig.now_playing_label = labelText;
    if (overlaySongLabel) {
      overlaySongLabel.textContent = labelText;
    }
    if (inputNowPlayingLabel && inputNowPlayingLabel.value !== labelText) {
      inputNowPlayingLabel.value = labelText;
    }
    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ now_playing_label: labelText }),
      }).catch(() => {});
    }
  }

  // 1. Badge Design Style
  const presetDesignBtns = document.querySelectorAll('.preset-design-btn');
  function setBadgeDesign(design, save = false) {
    if (!design) design = 'pill';
    appConfig.now_playing_design = design;
    if (overlayNowPlaying) {
      overlayNowPlaying.classList.remove('design-pill', 'design-neon', 'design-outline', 'design-gradient', 'design-minimal');
      overlayNowPlaying.classList.add(`design-${design}`);
    }
    if (overlaySongLabel) {
      if (design === 'gradient') {
        overlaySongLabel.style.color = '';
      } else if (appConfig.now_playing_color) {
        overlaySongLabel.style.color = appConfig.now_playing_color;
      }
    }
    presetDesignBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.design === design);
    });
    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ now_playing_design: design }),
      }).catch(() => {});
    }
  }

  // 2. Alignment (Above Description)
  const presetAlignBtns = document.querySelectorAll('.preset-align-btn');
  const presetValignBtns = document.querySelectorAll('.preset-valign-btn');
  const labelNowPlayingAlign = document.getElementById('nowPlayingAlignVal');
  const chkCustomCoordinates = document.getElementById('chkCustomCoordinates');
  const customCoordControls = document.getElementById('customCoordControls');
  const rngNowPlayingPosX = document.getElementById('rngNowPlayingPosX');
  const numNowPlayingPosX = document.getElementById('numNowPlayingPosX');
  const rngNowPlayingPosY = document.getElementById('rngNowPlayingPosY');
  const numNowPlayingPosY = document.getElementById('numNowPlayingPosY');
  const btnResetCoordinates = document.getElementById('btnResetCoordinates');

  function updateAlignLabel() {
    if (!labelNowPlayingAlign) return;
    if (appConfig.now_playing_custom_pos) {
      const x = appConfig.now_playing_pos_x ?? 2;
      const y = appConfig.now_playing_pos_y ?? 88;
      labelNowPlayingAlign.textContent = `Custom (X: ${x}%, Y: ${y}%)`;
      return;
    }
    const h = appConfig.now_playing_align || 'left';
    const v = appConfig.now_playing_valign || 'down';
    const hText = h === 'center' ? 'Center' : h === 'right' ? 'Right' : 'Left';
    const vText = v === 'up' ? 'Up (Top)' : 'Down (Bottom)';
    labelNowPlayingAlign.textContent = `${hText} • ${vText}`;
  }

  function applyCustomCoordinatesDOM() {
    if (!overlayNowPlaying) return;
    const isCustom = Boolean(appConfig.now_playing_custom_pos);
    overlayNowPlaying.classList.toggle('custom-coordinates', isCustom);
    if (isCustom) {
      const x = appConfig.now_playing_pos_x ?? 2;
      const y = appConfig.now_playing_pos_y ?? 88;
      overlayNowPlaying.style.setProperty('--badge-pos-x', `${x}%`);
      overlayNowPlaying.style.setProperty('--badge-pos-y', `${y}%`);
    } else {
      overlayNowPlaying.style.removeProperty('--badge-pos-x');
      overlayNowPlaying.style.removeProperty('--badge-pos-y');
    }
    if (customCoordControls) {
      customCoordControls.style.opacity = isCustom ? '1' : '0.5';
      customCoordControls.style.pointerEvents = isCustom ? 'auto' : 'none';
    }
    if (chkCustomCoordinates) {
      chkCustomCoordinates.checked = isCustom;
    }
    updateAlignLabel();
  }

  function setBadgeCoordinates(x, y, isCustom, save = false) {
    if (x !== undefined && x !== null) appConfig.now_playing_pos_x = Math.max(0, Math.min(100, parseInt(x, 10) || 0));
    if (y !== undefined && y !== null) appConfig.now_playing_pos_y = Math.max(0, Math.min(100, parseInt(y, 10) || 0));
    if (isCustom !== undefined && isCustom !== null) appConfig.now_playing_custom_pos = Boolean(isCustom);

    const posX = appConfig.now_playing_pos_x ?? 2;
    const posY = appConfig.now_playing_pos_y ?? 88;

    if (rngNowPlayingPosX) rngNowPlayingPosX.value = posX;
    if (numNowPlayingPosX) numNowPlayingPosX.value = posX;
    if (rngNowPlayingPosY) rngNowPlayingPosY.value = posY;
    if (numNowPlayingPosY) numNowPlayingPosY.value = posY;

    applyCustomCoordinatesDOM();

    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          now_playing_pos_x: posX,
          now_playing_pos_y: posY,
          now_playing_custom_pos: appConfig.now_playing_custom_pos,
        }),
      }).catch(() => {});
    }
  }

  if (chkCustomCoordinates) {
    chkCustomCoordinates.addEventListener('change', (e) => {
      setBadgeCoordinates(undefined, undefined, e.target.checked, true);
    });
  }

  if (rngNowPlayingPosX) {
    rngNowPlayingPosX.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (numNowPlayingPosX) numNowPlayingPosX.value = val;
      setBadgeCoordinates(val, undefined, true, false);
    });
    rngNowPlayingPosX.addEventListener('change', (e) => {
      setBadgeCoordinates(parseInt(e.target.value, 10), undefined, true, true);
    });
  }

  if (numNowPlayingPosX) {
    numNowPlayingPosX.addEventListener('input', (e) => {
      const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
      if (rngNowPlayingPosX) rngNowPlayingPosX.value = val;
      setBadgeCoordinates(val, undefined, true, false);
    });
    numNowPlayingPosX.addEventListener('change', (e) => {
      setBadgeCoordinates(parseInt(e.target.value, 10), undefined, true, true);
    });
  }

  if (rngNowPlayingPosY) {
    rngNowPlayingPosY.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (numNowPlayingPosY) numNowPlayingPosY.value = val;
      setBadgeCoordinates(undefined, val, true, false);
    });
    rngNowPlayingPosY.addEventListener('change', (e) => {
      setBadgeCoordinates(undefined, parseInt(e.target.value, 10), true, true);
    });
  }

  if (numNowPlayingPosY) {
    numNowPlayingPosY.addEventListener('input', (e) => {
      const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
      if (rngNowPlayingPosY) rngNowPlayingPosY.value = val;
      setBadgeCoordinates(undefined, val, true, false);
    });
    numNowPlayingPosY.addEventListener('change', (e) => {
      setBadgeCoordinates(undefined, parseInt(e.target.value, 10), true, true);
    });
  }

  if (btnResetCoordinates) {
    btnResetCoordinates.addEventListener('click', () => {
      setBadgeCoordinates(2, 88, false, true);
    });
  }

  function setBadgeAlign(align, save = false) {
    if (!align) align = 'left';
    appConfig.now_playing_align = align;
    // When preset buttons are clicked by user, disable custom coordinates so preset takes over
    if (save) {
      appConfig.now_playing_custom_pos = false;
    }
    applyCustomCoordinatesDOM();
    if (overlayNowPlaying) {
      overlayNowPlaying.classList.remove('align-left', 'align-center', 'align-right');
      overlayNowPlaying.classList.add(`align-${align}`);
    }
    presetAlignBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.align === align);
    });
    updateAlignLabel();
    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ now_playing_align: align, now_playing_custom_pos: false }),
      }).catch(() => {});
    }
  }

  function setBadgeValign(valign, save = false) {
    if (!valign) valign = 'down';
    appConfig.now_playing_valign = valign;
    // When preset buttons are clicked by user, disable custom coordinates so preset takes over
    if (save) {
      appConfig.now_playing_custom_pos = false;
    }
    applyCustomCoordinatesDOM();
    if (overlayNowPlaying) {
      overlayNowPlaying.classList.remove('valign-up', 'valign-down');
      overlayNowPlaying.classList.add(`valign-${valign}`);
    }
    presetValignBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.valign === valign);
    });
    updateAlignLabel();
    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ now_playing_valign: valign, now_playing_custom_pos: false }),
      }).catch(() => {});
    }
  }

  // 3. Written Text Size (Font Size)
  const sliderNowPlayingFontSize = document.getElementById('cfgNowPlayingFontSize');
  const labelNowPlayingFontSize = document.getElementById('nowPlayingFontSizeVal');
  const presetFSizeBtns = document.querySelectorAll('.preset-fsize-btn');
  function setBadgeFontSize(size, save = false) {
    size = Math.max(8, Math.min(36, parseInt(size, 10) || 13));
    appConfig.now_playing_font_size = size;
    if (overlayNowPlaying) {
      overlayNowPlaying.style.setProperty('--badge-font-size', `${size}px`);
    }
    if (sliderNowPlayingFontSize) sliderNowPlayingFontSize.value = size;
    if (labelNowPlayingFontSize) labelNowPlayingFontSize.textContent = `${size}px`;
    presetFSizeBtns.forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.size, 10) === size);
    });
    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ now_playing_font_size: size }),
      }).catch(() => {});
    }
  }

  // 4. Text Boldness / Weight
  const presetWeightBtns = document.querySelectorAll('.preset-weight-btn');
  const labelNowPlayingWeight = document.getElementById('nowPlayingWeightVal');
  function setBadgeWeight(weight, save = false) {
    if (!weight) weight = '800';
    const wtStr = String(weight);
    appConfig.now_playing_font_weight = wtStr;

    if (overlayNowPlaying) {
      overlayNowPlaying.style.setProperty('--badge-font-weight', wtStr);
      overlayNowPlaying.classList.remove('weight-400', 'weight-600', 'weight-700', 'weight-800', 'weight-900');
      overlayNowPlaying.classList.add(`weight-${wtStr}`);
    }
    if (overlaySongLabel) {
      overlaySongLabel.style.fontWeight = wtStr;
    }
    if (labelNowPlayingWeight) {
      const names = { '400': 'Regular (400)', '600': 'Semi (600)', '700': 'Bold (700)', '800': 'Heavy (800)', '900': 'Black (900)' };
      labelNowPlayingWeight.textContent = names[wtStr] || `${wtStr}`;
    }

    presetWeightBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.weight === wtStr);
    });

    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ now_playing_font_weight: wtStr }),
      }).catch(() => {});
    }
  }

  // 5. Text Capitalization / Transform
  const presetTransformBtns = document.querySelectorAll('.preset-transform-btn');
  function setBadgeTransform(transform, save = false) {
    if (!transform) transform = 'uppercase';
    appConfig.now_playing_text_transform = transform;
    if (overlayNowPlaying) {
      overlayNowPlaying.style.setProperty('--badge-text-transform', transform);
    }
    presetTransformBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.transform === transform);
    });
    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ now_playing_text_transform: transform }),
      }).catch(() => {});
    }
  }

  // Size events
  sliderNowPlayingScale?.addEventListener('input', (e) => {
    const scale = parseFloat(e.target.value) / 100;
    setBadgeScale(scale, false);
  });

  sliderNowPlayingScale?.addEventListener('change', (e) => {
    const scale = parseFloat(e.target.value) / 100;
    setBadgeScale(scale, true);
    showToast(`Now Playing size set to ${Math.round(scale * 100)}%`, 'info');
  });

  presetSizeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const scale = parseInt(btn.dataset.scale) / 100;
      setBadgeScale(scale, true);
      showToast(`Now Playing size set to ${Math.round(scale * 100)}%`, 'info');
    });
  });

  // Design events
  presetDesignBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const design = btn.dataset.design;
      setBadgeDesign(design, true);
      showToast(`Badge design set to ${design}`, 'info');
    });
  });

  // Alignment events
  presetAlignBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const align = btn.dataset.align;
      setBadgeAlign(align, true);
      showToast(`Badge aligned ${align}`, 'info');
    });
  });

  presetValignBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const valign = btn.dataset.valign;
      setBadgeValign(valign, true);
      showToast(`Badge vertical position: ${valign === 'up' ? 'Top (Up)' : 'Bottom (Down)'}`, 'info');
    });
  });

  // Font size events
  sliderNowPlayingFontSize?.addEventListener('input', (e) => {
    setBadgeFontSize(parseInt(e.target.value, 10), false);
  });
  sliderNowPlayingFontSize?.addEventListener('change', (e) => {
    const sz = parseInt(e.target.value, 10);
    setBadgeFontSize(sz, true);
    showToast(`Badge font size set to ${sz}px`, 'info');
  });
  presetFSizeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const sz = parseInt(btn.dataset.size, 10);
      setBadgeFontSize(sz, true);
      showToast(`Badge font size set to ${sz}px`, 'info');
    });
  });

  // Boldness / Weight events
  presetWeightBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const wt = btn.dataset.weight;
      setBadgeWeight(wt, true);
      showToast(`Badge boldness set to ${wt}`, 'info');
    });
  });

  // Text Transform events
  presetTransformBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const tr = btn.dataset.transform;
      setBadgeTransform(tr, true);
      showToast(`Badge text format: ${tr}`, 'info');
    });
  });

  // Color events
  inputNowPlayingColor?.addEventListener('input', (e) => {
    setBadgeColor(e.target.value, false);
  });

  inputNowPlayingColor?.addEventListener('change', (e) => {
    setBadgeColor(e.target.value, true);
    showToast(`Now Playing color set to ${e.target.value}`, 'info');
  });

  presetColorBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const color = btn.dataset.color;
      setBadgeColor(color, true);
      showToast(`Now Playing color set to ${color}`, 'info');
    });
  });

  // Label text events
  inputNowPlayingLabel?.addEventListener('input', (e) => {
    setBadgeLabel(e.target.value, false);
  });

  inputNowPlayingLabel?.addEventListener('change', (e) => {
    setBadgeLabel(e.target.value, true);
    showToast('Badge text updated', 'info');
  });

  // Stream Banner Title Auto-Sync & Real-Time Live Monitor Upgrades
  let bannerSaveTimer = null;
  function setStreamBannerTitle(title, save = false) {
    const cleanTitle = (title !== undefined && title !== null) ? title : '';
    appConfig.overlay_title = cleanTitle;

    // 1. Immediately update Live Monitor
    updateOverlayTitleVisibility();

    // 2. Synchronize all banner title inputs across tabs
    document.querySelectorAll('.stream-banner-title-input').forEach((inp) => {
      if (inp.value !== cleanTitle) {
        inp.value = cleanTitle;
      }
    });

    // 3. Auto-save to server
    if (save) {
      if (bannerSaveTimer) clearTimeout(bannerSaveTimer);
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overlay_title: cleanTitle.trim() }),
      }).catch((err) => console.warn('[SongStream] Failed to auto-save banner title:', err));
    }
  }

  // Bind all banner title inputs (Music tab, Video tab, Playlist tab)
  document.querySelectorAll('.stream-banner-title-input').forEach((inputEl) => {
    inputEl.addEventListener('input', (e) => {
      // If typing in video/playlist tab, ensure banner is marked visible for that mode
      if (inputEl.id === 'cfgVideoOverlayTitle' && !appConfig.show_banner_in_video) {
        const chk = document.getElementById('cfgShowVideoBannerTitle');
        if (chk) chk.checked = true;
        appConfig.show_banner_in_video = true;
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ show_banner_in_video: true }),
        }).catch(() => {});
      } else if (inputEl.id === 'cfgPlaylistOverlayTitle' && !appConfig.show_banner_in_playlist) {
        const chk = document.getElementById('cfgShowPlaylistBannerTitle');
        if (chk) chk.checked = true;
        appConfig.show_banner_in_playlist = true;
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ show_banner_in_playlist: true }),
        }).catch(() => {});
      }

      setStreamBannerTitle(e.target.value, false);
      if (bannerSaveTimer) clearTimeout(bannerSaveTimer);
      bannerSaveTimer = setTimeout(() => {
        setStreamBannerTitle(e.target.value, true);
      }, 600);
    });

    inputEl.addEventListener('change', (e) => {
      if (bannerSaveTimer) clearTimeout(bannerSaveTimer);
      setStreamBannerTitle(e.target.value, true);
      showToast('Stream banner title updated', 'info');
    });
  });

  // Clicking on monitor banner title scrolls to and focuses the active tab's banner title input
  overlayTopTitle?.addEventListener('click', () => {
    const activeInput = document.querySelector('.tab-content.active .stream-banner-title-input') || document.querySelector('.stream-banner-title-input');
    if (activeInput) {
      activeInput.focus();
      activeInput.select();
      activeInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
      activeInput.style.boxShadow = '0 0 16px var(--accent-cyan)';
      setTimeout(() => { activeInput.style.boxShadow = ''; }, 1500);
    }
  });

  // Stream Banner Title Alignment & Custom X,Y Screen Coordinates
  const presetBannerAlignBtns = document.querySelectorAll('.preset-banner-align-btn');
  const presetBannerValignBtns = document.querySelectorAll('.preset-banner-valign-btn');
  const labelBannerAlign = document.getElementById('bannerAlignVal');
  const chkBannerCustomCoordinates = document.getElementById('chkBannerCustomCoordinates');
  const bannerCustomCoordControls = document.getElementById('bannerCustomCoordControls');
  const rngBannerPosX = document.getElementById('rngBannerPosX');
  const numBannerPosX = document.getElementById('numBannerPosX');
  const rngBannerPosY = document.getElementById('rngBannerPosY');
  const numBannerPosY = document.getElementById('numBannerPosY');
  const btnResetBannerCoordinates = document.getElementById('btnResetBannerCoordinates');

  function updateBannerAlignLabel() {
    if (!labelBannerAlign) return;
    if (appConfig.banner_custom_pos) {
      const x = appConfig.banner_pos_x ?? 2;
      const y = appConfig.banner_pos_y ?? 3;
      labelBannerAlign.textContent = `Custom (X: ${x}%, Y: ${y}%)`;
      return;
    }
    const h = appConfig.banner_align || 'left';
    const v = appConfig.banner_valign || 'up';
    const hText = h === 'center' ? 'Center' : h === 'right' ? 'Right' : 'Left';
    const vText = v === 'down' ? 'Down (Bottom)' : 'Up (Top)';
    labelBannerAlign.textContent = `${hText} • ${vText}`;
  }

  function applyBannerCustomCoordinatesDOM() {
    if (!overlayTopTitle) return;
    const isCustom = Boolean(appConfig.banner_custom_pos);
    overlayTopTitle.classList.toggle('custom-coordinates', isCustom);
    if (isCustom) {
      const x = appConfig.banner_pos_x ?? 2;
      const y = appConfig.banner_pos_y ?? 3;
      overlayTopTitle.style.setProperty('--banner-pos-x', `${x}%`);
      overlayTopTitle.style.setProperty('--banner-pos-y', `${y}%`);
    } else {
      overlayTopTitle.style.removeProperty('--banner-pos-x');
      overlayTopTitle.style.removeProperty('--banner-pos-y');
    }
    if (bannerCustomCoordControls) {
      bannerCustomCoordControls.style.opacity = isCustom ? '1' : '0.5';
      bannerCustomCoordControls.style.pointerEvents = isCustom ? 'auto' : 'none';
    }
    if (chkBannerCustomCoordinates) {
      chkBannerCustomCoordinates.checked = isCustom;
    }
    updateBannerAlignLabel();
  }

  function setBannerCoordinates(x, y, isCustom, save = false) {
    if (x !== undefined && x !== null) appConfig.banner_pos_x = Math.max(0, Math.min(100, parseInt(x, 10) || 0));
    if (y !== undefined && y !== null) appConfig.banner_pos_y = Math.max(0, Math.min(100, parseInt(y, 10) || 0));
    if (isCustom !== undefined && isCustom !== null) appConfig.banner_custom_pos = Boolean(isCustom);

    const posX = appConfig.banner_pos_x ?? 2;
    const posY = appConfig.banner_pos_y ?? 3;

    if (rngBannerPosX) rngBannerPosX.value = posX;
    if (numBannerPosX) numBannerPosX.value = posX;
    if (rngBannerPosY) rngBannerPosY.value = posY;
    if (numBannerPosY) numBannerPosY.value = posY;

    applyBannerCustomCoordinatesDOM();

    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          banner_pos_x: posX,
          banner_pos_y: posY,
          banner_custom_pos: appConfig.banner_custom_pos,
        }),
      }).catch(() => {});
    }
  }

  if (chkBannerCustomCoordinates) {
    chkBannerCustomCoordinates.addEventListener('change', (e) => {
      setBannerCoordinates(undefined, undefined, e.target.checked, true);
    });
  }

  if (rngBannerPosX) {
    rngBannerPosX.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (numBannerPosX) numBannerPosX.value = val;
      setBannerCoordinates(val, undefined, true, false);
    });
    rngBannerPosX.addEventListener('change', (e) => {
      setBannerCoordinates(parseInt(e.target.value, 10), undefined, true, true);
    });
  }

  if (numBannerPosX) {
    numBannerPosX.addEventListener('input', (e) => {
      const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
      if (rngBannerPosX) rngBannerPosX.value = val;
      setBannerCoordinates(val, undefined, true, false);
    });
    numBannerPosX.addEventListener('change', (e) => {
      setBannerCoordinates(parseInt(e.target.value, 10), undefined, true, true);
    });
  }

  if (rngBannerPosY) {
    rngBannerPosY.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (numBannerPosY) numBannerPosY.value = val;
      setBannerCoordinates(undefined, val, true, false);
    });
    rngBannerPosY.addEventListener('change', (e) => {
      setBannerCoordinates(undefined, parseInt(e.target.value, 10), true, true);
    });
  }

  if (numBannerPosY) {
    numBannerPosY.addEventListener('input', (e) => {
      const val = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0));
      if (rngBannerPosY) rngBannerPosY.value = val;
      setBannerCoordinates(undefined, val, true, false);
    });
    numBannerPosY.addEventListener('change', (e) => {
      setBannerCoordinates(undefined, parseInt(e.target.value, 10), true, true);
    });
  }

  if (btnResetBannerCoordinates) {
    btnResetBannerCoordinates.addEventListener('click', () => {
      setBannerCoordinates(2, 3, false, true);
    });
  }

  function setBannerAlign(align, save = false) {
    if (!align) align = 'left';
    appConfig.banner_align = align;
    // When preset buttons are clicked by user, disable custom coordinates so preset takes over
    if (save) {
      appConfig.banner_custom_pos = false;
    }
    applyBannerCustomCoordinatesDOM();
    if (overlayTopTitle) {
      overlayTopTitle.classList.remove('align-left', 'align-center', 'align-right');
      overlayTopTitle.classList.add(`align-${align}`);
    }
    presetBannerAlignBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.align === align);
    });
    updateBannerAlignLabel();
    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banner_align: align, banner_custom_pos: false }),
      }).catch(() => {});
    }
  }

  function setBannerValign(valign, save = false) {
    if (!valign) valign = 'up';
    appConfig.banner_valign = valign;
    // When preset buttons are clicked by user, disable custom coordinates so preset takes over
    if (save) {
      appConfig.banner_custom_pos = false;
    }
    applyBannerCustomCoordinatesDOM();
    if (overlayTopTitle) {
      overlayTopTitle.classList.remove('valign-up', 'valign-down');
      overlayTopTitle.classList.add(`valign-${valign}`);
    }
    presetBannerValignBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.valign === valign);
    });
    updateBannerAlignLabel();
    if (save) {
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ banner_valign: valign, banner_custom_pos: false }),
      }).catch(() => {});
    }
  }

  presetBannerAlignBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setBannerAlign(btn.dataset.align, true);
    });
  });

  presetBannerValignBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      setBannerValign(btn.dataset.valign, true);
    });
  });

  // Live monitor: show/hide Now Playing badge instantly on checkbox toggle
  document.getElementById('cfgShowNowPlaying')?.addEventListener('change', (e) => {
    appConfig.show_now_playing = e.target.checked;
    if (overlayNowPlaying) {
      overlayNowPlaying.style.display =
        (appConfig.stream_mode === 'radio' && appConfig.show_now_playing !== false) ? 'flex' : 'none';
    }
  });

  // Live monitor: visualizer style and colour preview instantly on dropdown change
  document.getElementById('cfgVisualizerStyle')?.addEventListener('change', (e) => {
    appConfig.visualizer_style = e.target.value;
    visualizer.setVisualizerConfig(appConfig.visualizer_style, appConfig.visualizer_color);
  });

  document.getElementById('cfgVisualizerColor')?.addEventListener('change', (e) => {
    appConfig.visualizer_color = e.target.value;
    visualizer.setVisualizerConfig(appConfig.visualizer_style, appConfig.visualizer_color);
  });

  // ==========================================
  // Slideable Menu Bar (Side Navigation Drawer)
  // ==========================================
  const sideMenuOverlay = document.getElementById('sideMenuOverlay');
  const sideMenuBar = document.getElementById('sideMenuBar');
  const btnToggleSideMenu = document.getElementById('btnToggleSideMenu');
  const btnFloatingMenuToggle = document.getElementById('btnFloatingMenuToggle');
  const btnCloseSideMenu = document.getElementById('btnCloseSideMenu');
  const sideBadgeMusic = document.getElementById('sideBadgeMusic');
  const sideBadgeVideo = document.getElementById('sideBadgeVideo');
  const sideBadgePlaylist = document.getElementById('sideBadgePlaylist');
  const sideTracksCount = document.getElementById('sideTracksCount');
  const sideBtnGoLive = document.getElementById('sideBtnGoLive');
  const sideBtnStartTest = document.getElementById('sideBtnStartTest');
  const sideBtnStopStream = document.getElementById('sideBtnStopStream');

  function openSideMenu() {
    sideMenuBar?.classList.add('active');
    sideMenuOverlay?.classList.add('active');
    btnToggleSideMenu?.classList.add('active');
    syncSideMenuState();
  }

  function closeSideMenu() {
    sideMenuBar?.classList.remove('active');
    sideMenuOverlay?.classList.remove('active');
    btnToggleSideMenu?.classList.remove('active');
  }

  function toggleSideMenu() {
    if (sideMenuBar?.classList.contains('active')) {
      closeSideMenu();
    } else {
      openSideMenu();
    }
  }

  btnToggleSideMenu?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSideMenu();
  });

  btnFloatingMenuToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    openSideMenu();
  });

  document.getElementById('btnQuickOpenMenu')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openSideMenu();
  });

  btnCloseSideMenu?.addEventListener('click', () => {
    closeSideMenu();
  });

  sideMenuOverlay?.addEventListener('click', () => {
    closeSideMenu();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && sideMenuBar?.classList.contains('active')) {
      closeSideMenu();
    }
  });

  // Touch swipe to close (leftwards swipe on drawer)
  let menuTouchStartX = 0;
  let menuTouchStartY = 0;
  sideMenuBar?.addEventListener('touchstart', (e) => {
    menuTouchStartX = e.touches[0].clientX;
    menuTouchStartY = e.touches[0].clientY;
  }, { passive: true });

  sideMenuBar?.addEventListener('touchend', (e) => {
    const deltaX = e.changedTouches[0].clientX - menuTouchStartX;
    const deltaY = e.changedTouches[0].clientY - menuTouchStartY;
    if (deltaX < -45 && Math.abs(deltaX) > Math.abs(deltaY)) {
      closeSideMenu();
    }
  }, { passive: true });

  function syncSideMenuState() {
    // 1. Sync Active Mode Highlight
    const activeMode = appConfig.stream_mode || 'radio';
    document.querySelectorAll('.side-menu-item[data-mode]').forEach(btn => {
      const match = btn.dataset.mode === activeMode;
      btn.classList.toggle('active', match);
    });

    if (sideBadgeMusic) sideBadgeMusic.style.display = activeMode === 'radio' ? 'inline-block' : 'none';
    if (sideBadgeVideo) sideBadgeVideo.style.display = activeMode === 'video' ? 'inline-block' : 'none';
    if (sideBadgePlaylist) sideBadgePlaylist.style.display = activeMode === 'playlist_play' ? 'inline-block' : 'none';

    // 2. Sync Tracks Count
    if (sideTracksCount && currentPlaylist) {
      sideTracksCount.textContent = currentPlaylist.length;
    }

    // 3. Sync Quick Action Buttons in Menu
    if (sideBtnGoLive && sideBtnStartTest && sideBtnStopStream) {
      const isStreaming = statusText && statusText.textContent.includes('LIVE');
      const isStarting = statusText && statusText.textContent.includes('STARTING');
      if (isStreaming || isStarting) {
        sideBtnGoLive.style.display = 'none';
        sideBtnStartTest.style.display = 'none';
        sideBtnStopStream.style.display = 'inline-flex';
        sideBtnStopStream.disabled = isStarting;
      } else {
        sideBtnGoLive.style.display = 'inline-flex';
        sideBtnStartTest.style.display = 'inline-flex';
        sideBtnStopStream.style.display = 'none';
        sideBtnGoLive.disabled = false;
        sideBtnStartTest.disabled = false;
      }
    }
  }

  // Handle Side Menu Items Navigation
  document.querySelectorAll('.side-menu-item, .side-menu-subitem').forEach(item => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const targetTab = item.dataset.targetTab;
      const mode = item.dataset.mode;
      const sub = item.dataset.sub;
      const focus = item.dataset.focus;

      if (targetTab) {
        switchTab(targetTab, mode || null);
      }

      if (sub === 'subViewTracks') {
        btnSubTabTracks?.click();
      } else if (sub === 'subViewVisuals') {
        btnSubTabVisuals?.click();
      }

      if (focus === 'streamKey') {
        const keyEl = document.getElementById('cfgStreamKey');
        if (keyEl) {
          keyEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          keyEl.focus();
        }
      } else if (focus === 'encoder') {
        const encEl = document.querySelector('.preset-selector-grid');
        if (encEl) encEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (focus === 'badge') {
        const badgeEl = document.getElementById('groupNowPlayingConfig');
        if (badgeEl) {
          badgeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          badgeEl.style.borderColor = 'var(--accent-cyan)';
          badgeEl.style.boxShadow = '0 0 16px rgba(0, 242, 254, 0.4)';
          setTimeout(() => {
            badgeEl.style.borderColor = '';
            badgeEl.style.boxShadow = '';
          }, 1800);
        }
      } else if (focus === 'bannerTitle') {
        const titleEl = document.getElementById('cfgOverlayTitle');
        if (titleEl) {
          titleEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          titleEl.focus();
          titleEl.select();
          titleEl.style.boxShadow = '0 0 16px var(--accent-cyan)';
          setTimeout(() => { titleEl.style.boxShadow = ''; }, 1800);
        }
      }

      if (item.classList.contains('side-menu-subitem')) {
        document.querySelectorAll('.side-menu-subitem').forEach(s => s.classList.remove('active'));
        item.classList.add('active');
      }

      syncSideMenuState();
      setTimeout(closeSideMenu, 120);
    });
  });

  sideBtnGoLive?.addEventListener('click', () => {
    closeSideMenu();
    btnStartLive?.click();
  });

  sideBtnStartTest?.addEventListener('click', () => {
    closeSideMenu();
    btnStartTest?.click();
  });

  sideBtnStopStream?.addEventListener('click', () => {
    closeSideMenu();
    if (btnStopStream?.style.display !== 'none') {
      btnStopStream?.click();
    } else if (btnStopTestStream?.style.display !== 'none') {
      btnStopTestStream?.click();
    }
  });

  // Tabs & Mode Switching
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const activeSectionIcon = document.getElementById('activeSectionIcon');
  const activeSectionTitle = document.getElementById('activeSectionTitle');
  const activeSectionModeBadge = document.getElementById('activeSectionModeBadge');

  function updateActiveSectionHeader(targetId) {
    if (!activeSectionTitle) return;
    if (targetId === 'tabPlaylist') {
      if (activeSectionIcon) activeSectionIcon.textContent = '📻';
      activeSectionTitle.textContent = 'Music Radio';
      if (activeSectionModeBadge) {
        activeSectionModeBadge.textContent = 'Active Mode';
        activeSectionModeBadge.style.display = 'inline-block';
      }
    } else if (targetId === 'tabDirectVideo') {
      if (activeSectionIcon) activeSectionIcon.textContent = '🎬';
      activeSectionTitle.textContent = 'Direct Video';
      if (activeSectionModeBadge) {
        activeSectionModeBadge.textContent = 'Active Mode';
        activeSectionModeBadge.style.display = 'inline-block';
      }
    } else if (targetId === 'tabPlaylistPlay') {
      if (activeSectionIcon) activeSectionIcon.textContent = '📑';
      activeSectionTitle.textContent = 'Playlist Play';
      if (activeSectionModeBadge) {
        activeSectionModeBadge.textContent = 'Active Mode';
        activeSectionModeBadge.style.display = 'inline-block';
      }
    } else if (targetId === 'tabSettings') {
      if (activeSectionIcon) activeSectionIcon.textContent = '⚙️';
      activeSectionTitle.textContent = 'Studio Settings';
      if (activeSectionModeBadge) {
        activeSectionModeBadge.textContent = 'Config';
        activeSectionModeBadge.style.display = 'inline-block';
      }
    }
  }

  function switchTab(targetId, mode = null) {
    if (!mode) {
      if (targetId === 'tabPlaylist') mode = 'radio';
      else if (targetId === 'tabDirectVideo') mode = 'video';
      else if (targetId === 'tabPlaylistPlay') mode = 'playlist_play';
    }

    tabBtns.forEach((b) => {
      const match = b.getAttribute('data-tab') === targetId;
      b.classList.toggle('active', match);
    });
    tabContents.forEach((c) => {
      c.classList.toggle('active', c.id === targetId);
    });
    updateActiveSectionHeader(targetId);
    syncSideMenuState();

    if (mode) {
      appConfig.stream_mode = mode;
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream_mode: mode }),
      }).catch(() => {});

      // Adapt preview monitor strictly to active mode (no cross-contamination)
      if (mode === 'radio') {
        // Stop any broadcast video from Direct Video or Playlist Play
        visualizer.stopBroadcastVideo();

        const applyRadioBackground = () => {
          if (currentVisuals && currentVisuals.length) {
            const activeVis = currentVisuals.find(v => v.id === appConfig.active_visual_id) || currentVisuals[0];
            if (activeVis) visualizer.setMusicBackground(activeVis.url, activeVis.is_video);
          } else {
            loadVisuals().then(() => {
              if (currentVisuals && currentVisuals.length) {
                const activeVis = currentVisuals.find(v => v.id === appConfig.active_visual_id) || currentVisuals[0];
                if (activeVis) visualizer.setMusicBackground(activeVis.url, activeVis.is_video);
              }
            }).catch(() => {});
          }
        };
        applyRadioBackground();

        if (overlayNowPlaying) {
          overlayNowPlaying.style.display = appConfig.show_now_playing !== false ? 'flex' : 'none';
        }

        // Resume music player if it is not currently playing.
        // This ensures switching away and back to Music Radio immediately restores music!
        if (player && !player.isPlaying) {
          const startPlayback = () => {
            if (player && player.playlist && player.playlist.length > 0) {
              const targetIdx = (player.currentIndex >= 0 && player.currentIndex < player.playlist.length)
                ? player.currentIndex
                : player.playlist.findIndex(t => t.enabled !== false);
              const playIdx = targetIdx >= 0 ? targetIdx : 0;
              player.loadTrack(playIdx, true);
            }
          };

          if (player.playlist && player.playlist.length > 0) {
            startPlayback();
          } else {
            loadPlaylist().then(() => {
              startPlayback();
            }).catch(() => {});
          }
        }
      } else if (mode === 'video') {
        // Direct Video: STOP music player so music NEVER mixes with video!
        if (player && player.isPlaying) {
          player.stop();
        }
        if (currentVideos.length) {
          const activeVid = currentVideos.find(v => v.id === appConfig.active_video_id) || currentVideos[0];
          if (activeVid && !visualizer.isVideoPlaying()) visualizer.setBroadcastVideo(activeVid.url, true);
        }
        if (overlayNowPlaying) overlayNowPlaying.style.display = 'none';
      } else if (mode === 'playlist_play') {
        // Playlist Play: STOP music player so music NEVER mixes with playlist videos!
        if (player && player.isPlaying) {
          player.stop();
        }
        if (currentPlaylistPlay.length && !visualizer.isVideoPlaying()) {
          const startIdx = activePlaylistVideoIndex >= 0 ? activePlaylistVideoIndex : 0;
          const startVid = currentPlaylistPlay[startIdx];
          const shouldLoop = Boolean(startVid && appConfig.playlist_loop_single_id === startVid.id);
          visualizer.setBroadcastVideo(startVid.url, shouldLoop);
        }
        if (overlayNowPlaying) overlayNowPlaying.style.display = 'none';
      }
      updateOverlayTitleVisibility();
      updateMonitorControlsUI();
    }
  }

  function updateMonitorControlsUI() {
    const mode = appConfig.stream_mode || 'radio';
    if (mode === 'video') {
      // Direct Video: ONLY show Stop and Play/Pause, hide Next!
      if (btnPlayerPlay) btnPlayerPlay.style.display = 'inline-flex';
      if (btnPlayerStop) btnPlayerStop.style.display = 'inline-flex';
      if (btnPlayerNext) btnPlayerNext.style.display = 'none';

      const isPlaying = visualizer.isVideoPlaying();
      if (playIcon) playIcon.style.display = isPlaying ? 'none' : 'inline-block';
      if (pauseIcon) pauseIcon.style.display = isPlaying ? 'inline-block' : 'none';

      if (visualizer.bgVideo) {
        if (playerCurrentTime) playerCurrentTime.textContent = formatTime(visualizer.bgVideo.currentTime);
        if (playerTotalTime) playerTotalTime.textContent = formatTime(visualizer.bgVideo.duration);
        if (playerScrub) playerScrub.value = visualizer.bgVideo.duration > 0 ? (visualizer.bgVideo.currentTime / visualizer.bgVideo.duration) * 100 : 0;
      } else {
        if (playerCurrentTime) playerCurrentTime.textContent = '00:00';
        if (playerTotalTime) playerTotalTime.textContent = '00:00';
        if (playerScrub) playerScrub.value = 0;
      }
    } else if (mode === 'playlist_play') {
      if (btnPlayerPlay) btnPlayerPlay.style.display = 'inline-flex';
      if (btnPlayerStop) btnPlayerStop.style.display = 'inline-flex';
      if (btnPlayerNext) btnPlayerNext.style.display = 'inline-flex';

      const isPlaying = visualizer.isVideoPlaying();
      if (playIcon) playIcon.style.display = isPlaying ? 'none' : 'inline-block';
      if (pauseIcon) pauseIcon.style.display = isPlaying ? 'inline-block' : 'none';

      if (visualizer.bgVideo) {
        if (playerCurrentTime) playerCurrentTime.textContent = formatTime(visualizer.bgVideo.currentTime);
        if (playerTotalTime) playerTotalTime.textContent = formatTime(visualizer.bgVideo.duration);
        if (playerScrub) playerScrub.value = visualizer.bgVideo.duration > 0 ? (visualizer.bgVideo.currentTime / visualizer.bgVideo.duration) * 100 : 0;
      } else {
        if (playerCurrentTime) playerCurrentTime.textContent = '00:00';
        if (playerTotalTime) playerTotalTime.textContent = '00:00';
        if (playerScrub) playerScrub.value = 0;
      }
    } else {
      if (btnPlayerPlay) btnPlayerPlay.style.display = 'inline-flex';
      if (btnPlayerStop) btnPlayerStop.style.display = 'inline-flex';
      if (btnPlayerNext) btnPlayerNext.style.display = 'inline-flex';

      const isPlaying = player && player.isPlaying;
      if (playIcon) playIcon.style.display = isPlaying ? 'none' : 'inline-block';
      if (pauseIcon) pauseIcon.style.display = isPlaying ? 'inline-block' : 'none';

      if (player && player.audio) {
        if (playerCurrentTime) playerCurrentTime.textContent = formatTime(player.audio.currentTime);
        if (playerTotalTime) playerTotalTime.textContent = formatTime(player.audio.duration);
        if (playerScrub) playerScrub.value = player.audio.duration > 0 ? (player.audio.currentTime / player.audio.duration) * 100 : 0;
      }
    }
  }

  // Monitor Player Controls Handlers
  btnPlayerPlay?.addEventListener('click', () => {
    const mode = appConfig.stream_mode || 'radio';
    if (mode === 'radio') {
      player.togglePlay();
    } else if (mode === 'video') {
      if (visualizer.isVideoPlaying()) {
        visualizer.pauseVideo();
        showToast('Video preview paused', 'info');
      } else {
        if (visualizer.bgVideo && visualizer.currentUrl) {
          visualizer.resumeVideo();
          showToast('Video preview resumed', 'info');
        } else if (currentVideos.length > 0) {
          const activeVid = currentVideos.find(v => v.id === appConfig.active_video_id) || currentVideos[0];
          visualizer.setBroadcastVideo(activeVid.url, true);
          showToast(`Previewing: ${activeVid.name}`, 'info');
        }
      }
      syncVideoButtons();
    } else if (mode === 'playlist_play') {
      if (visualizer.isVideoPlaying()) {
        visualizer.pauseVideo();
        showToast('Playlist preview paused', 'info');
      } else {
        if (visualizer.bgVideo && visualizer.currentUrl) {
          visualizer.resumeVideo();
          showToast('Playlist preview resumed', 'info');
        } else if (currentPlaylistPlay.length > 0) {
          playPlaylistVideo(activePlaylistVideoIndex >= 0 ? activePlaylistVideoIndex : 0);
        }
      }
      syncPlaylistPlayButtons();
    }
    updateMonitorControlsUI();
  });

  btnPlayerStop?.addEventListener('click', () => {
    const mode = appConfig.stream_mode || 'radio';
    if (mode === 'radio') {
      player.stop();
      showToast('Music stopped', 'info');
    } else if (mode === 'video') {
      visualizer.stopVideo();
      syncVideoButtons();
      showToast('Video preview stopped', 'info');
    } else if (mode === 'playlist_play') {
      visualizer.stopVideo();
      activePlaylistVideoIndex = -1;
      syncPlaylistPlayButtons();
      showToast('Playlist preview stopped', 'info');
    }
    updateMonitorControlsUI();
  });

  btnPlayerNext?.addEventListener('click', () => {
    const mode = appConfig.stream_mode || 'radio';
    if (mode === 'radio') {
      player.playNext();
    } else if (mode === 'playlist_play') {
      playNextPlaylistVideo();
    }
    updateMonitorControlsUI();
  });

  playerScrub?.addEventListener('input', (e) => {
    const mode = appConfig.stream_mode || 'radio';
    const pct = parseFloat(e.target.value);
    if (mode === 'radio') {
      player.seek(pct);
    } else {
      if (visualizer.bgVideo && visualizer.bgVideo.duration) {
        visualizer.seekVideo((pct / 100) * visualizer.bgVideo.duration);
      }
    }
  });

  playerVolume?.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    player.setVolume(val);
    visualizer.setVolume(val);
  });

  visualizer.onVideoPlayStateChange = (isPlaying) => {
    if (appConfig.stream_mode !== 'radio') {
      if (playIcon) playIcon.style.display = isPlaying ? 'none' : 'inline-block';
      if (pauseIcon) pauseIcon.style.display = isPlaying ? 'inline-block' : 'none';
      syncVideoButtons();
      syncPlaylistPlayButtons();
    }
  };

  visualizer.onVideoTimeUpdate = (currentTime, duration) => {
    if (appConfig.stream_mode !== 'radio') {
      if (duration > 0 && playerScrub) {
        playerScrub.value = (currentTime / duration) * 100;
      }
      if (playerCurrentTime) playerCurrentTime.textContent = formatTime(currentTime);
      if (playerTotalTime) playerTotalTime.textContent = formatTime(duration);
    }
  };

  function updateOverlayTitleVisibility() {
    if (!overlayTopTitle) return;
    const mode = appConfig.stream_mode || 'radio';
    const titleVal = (appConfig.overlay_title !== undefined && appConfig.overlay_title !== null) ? appConfig.overlay_title : '';
    const displayTitle = titleVal.trim() !== '' ? titleVal : (mode === 'video' ? 'Direct MP4 Video Stream' : mode === 'playlist_play' ? 'Sequential Video Playlist' : 'SongStream 24/7 Radio');

    let textNode = document.getElementById('overlayTopTitleText');
    if (!textNode) {
      overlayTopTitle.innerHTML = `<span id="overlayTopTitleText"></span><span class="banner-edit-hint" title="Click to edit title">✏️</span>`;
      textNode = document.getElementById('overlayTopTitleText');
    }
    if (textNode) {
      textNode.textContent = displayTitle;
    }

    if (mode === 'radio') {
      overlayTopTitle.style.display = (titleVal.trim() !== '') ? 'flex' : 'none';
    } else if (mode === 'video') {
      overlayTopTitle.style.display = (appConfig.show_banner_in_video && titleVal.trim() !== '') ? 'flex' : 'none';
    } else if (mode === 'playlist_play') {
      overlayTopTitle.style.display = (appConfig.show_banner_in_playlist && titleVal.trim() !== '') ? 'flex' : 'none';
    }
  }

  function updateModeUI(mode) {
    if (mode === 'playlist_play') {
      switchTab('tabPlaylistPlay', mode);
    } else if (mode === 'video') {
      switchTab('tabDirectVideo', mode);
    } else {
      switchTab('tabPlaylist', mode);
    }
  }

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      const targetMode = btn.getAttribute('data-mode');
      switchTab(targetId, targetMode);
    });
  });

  // Music Radio Sub-Tabs (Tracks vs Artwork/Visualizer)
  const btnSubTabTracks = document.getElementById('btnSubTabTracks');
  const btnSubTabVisuals = document.getElementById('btnSubTabVisuals');
  const subViewTracks = document.getElementById('subViewTracks');
  const subViewVisuals = document.getElementById('subViewVisuals');

  btnSubTabTracks?.addEventListener('click', () => {
    btnSubTabTracks.classList.add('active');
    btnSubTabVisuals?.classList.remove('active');
    subViewTracks?.classList.add('active');
    subViewVisuals?.classList.remove('active');
    if (appConfig.stream_mode !== 'radio') {
      switchTab('tabPlaylist', 'radio');
    }
  });

  btnSubTabVisuals?.addEventListener('click', () => {
    btnSubTabVisuals.classList.add('active');
    btnSubTabTracks?.classList.remove('active');
    subViewVisuals?.classList.add('active');
    subViewTracks?.classList.remove('active');
    if (appConfig.stream_mode !== 'radio') {
      switchTab('tabPlaylist', 'radio');
    }
  });

  // Toggle Console Collapse
  const btnToggleConsole = document.getElementById('btnToggleConsole');
  btnToggleConsole?.addEventListener('click', () => {
    const isCollapsed = consoleLogs.classList.toggle('collapsed');
    btnToggleConsole.textContent = isCollapsed ? 'Expand' : 'Minimize';
  });

  // Quality Preset Buttons
  const presetCards = document.querySelectorAll('.preset-card');
  presetCards.forEach((card) => {
    card.addEventListener('click', () => {
      presetCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      const res = card.dataset.res;
      const fps = card.dataset.fps;
      const vbr = card.dataset.vbr;
      const abr = card.dataset.abr;
      const preset = card.dataset.preset;

      if (res) document.getElementById('cfgResolution').value = res;
      if (fps) document.getElementById('cfgFps').value = fps;
      if (vbr) document.getElementById('cfgVideoBitrate').value = vbr;
      if (abr) document.getElementById('cfgAudioBitrate').value = abr;
      if (preset) document.getElementById('cfgPreset').value = preset;

      monitorResolutionTag.textContent = `${res} @ ${fps}fps`;
      showToast(`Applied ${card.querySelector('.preset-name')?.textContent || res} Preset`, 'success');

      // Auto-persist preset to backend configuration immediately
      fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolution: res,
          fps: parseInt(fps),
          video_bitrate: vbr,
          audio_bitrate: abr,
          preset: preset,
        }),
      }).catch(console.error);
    });
  });

  // Toast Helper
  function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // Console Logging
  function appendLog(message, level = 'info', timestamp = null) {
    if (!timestamp) {
      timestamp = new Date().toTimeString().split(' ')[0];
    }
    const line = document.createElement('div');
    line.className = `log-line ${level}`;
    line.textContent = `[${timestamp}] ${message}`;
    consoleLogs.appendChild(line);

    // Auto-scroll
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
  }

  btnClearConsole.addEventListener('click', () => {
    consoleLogs.innerHTML = '';
  });

  // 3. WebSocket Setup
  function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      wsStatusPill.textContent = '● WS Connected';
      wsStatusPill.style.color = '#34d399';
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'init') {
          updateStreamStats(msg.stats);
          if (msg.logs && Array.isArray(msg.logs)) {
            msg.logs.forEach((log) => appendLog(log, 'info'));
          }
        } else if (msg.type === 'log') {
          appendLog(msg.message, msg.level || 'info', msg.time);
        } else if (msg.type === 'stats') {
          updateStreamStats(msg.data);
        } else if (msg.type === 'config_update') {
          if (msg.config) {
            appConfig = { ...appConfig, ...msg.config };
            if (msg.config.now_playing_color) {
              setBadgeColor(msg.config.now_playing_color, false);
            }
            if (msg.config.now_playing_design) {
              setBadgeDesign(msg.config.now_playing_design, false);
            }
            if (msg.config.now_playing_label !== undefined) {
              setBadgeLabel(msg.config.now_playing_label, false);
            }
            if (msg.config.now_playing_scale !== undefined) {
              setBadgeScale(msg.config.now_playing_scale, false);
            }
            if (msg.config.now_playing_font_size !== undefined) {
              setBadgeFontSize(msg.config.now_playing_font_size, false);
            }
            if (msg.config.now_playing_font_weight !== undefined) {
              setBadgeWeight(msg.config.now_playing_font_weight, false);
            }
            if (msg.config.now_playing_text_transform !== undefined) {
              setBadgeTransform(msg.config.now_playing_text_transform, false);
            }
            if (msg.config.now_playing_align !== undefined) {
              setBadgeAlign(msg.config.now_playing_align, false);
            }
            if (msg.config.now_playing_valign !== undefined) {
              setBadgeValign(msg.config.now_playing_valign, false);
            }
            if (msg.config.now_playing_pos_x !== undefined || msg.config.now_playing_pos_y !== undefined || msg.config.now_playing_custom_pos !== undefined) {
              setBadgeCoordinates(msg.config.now_playing_pos_x, msg.config.now_playing_pos_y, msg.config.now_playing_custom_pos, false);
            }
            if (msg.config.show_now_playing !== undefined) {
              const chk = document.getElementById('cfgShowNowPlaying');
              if (chk) chk.checked = Boolean(msg.config.show_now_playing);
              if (overlayNowPlaying) {
                overlayNowPlaying.style.display = (appConfig.stream_mode === 'radio' && msg.config.show_now_playing !== false) ? 'flex' : 'none';
              }
            }
            if (msg.config.active_visual_id) {
              applyActiveVisual(msg.config.active_visual_id);
            }
          }
        } else if (msg.type === 'visual_update') {
          if (msg.active_visual_id) {
            applyActiveVisual(msg.active_visual_id);
          }
        }
      } catch (e) {
        console.error('WS parse error:', e);
      }
    };

    ws.onclose = () => {
      wsStatusPill.textContent = '○ WS Reconnecting...';
      wsStatusPill.style.color = '#f87171';
      setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  // Format seconds to HH:MM:SS
  function formatUptime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }

  // Update UI Stats
  function updateStreamStats(stats) {
    if (!stats) return;

    statusBadge.className = 'status-badge';

    if (stats.status === 'streaming') {
      if (stats.is_test_mode) {
        statusBadge.classList.add('test');
        statusText.textContent = 'Testing Stream';
        btnStartLive.style.display = 'none';
        btnStartTest.style.display = 'none';
        btnStopStream.style.display = 'none';
        if (btnStopTestStream) {
          btnStopTestStream.style.display = 'inline-flex';
          btnStopTestStream.disabled = false;
        }
      } else {
        statusBadge.classList.add('streaming');
        statusText.textContent = 'Live on YouTube';
        btnStartLive.style.display = 'none';
        btnStartTest.style.display = 'none';
        btnStopStream.style.display = 'inline-flex';
        btnStopStream.disabled = false;
        if (btnStopTestStream) btnStopTestStream.style.display = 'none';
      }
    } else if (stats.status === 'starting') {
      statusBadge.classList.add('starting');
      btnStartLive.style.display = 'none';
      btnStartTest.style.display = 'none';

      if (stats.is_test_mode) {
        statusText.textContent = 'Starting Test...';
        btnStopStream.style.display = 'none';
        if (btnStopTestStream) {
          btnStopTestStream.style.display = 'inline-flex';
          btnStopTestStream.disabled = false;
        }
      } else {
        statusText.textContent = 'Starting Live...';
        btnStopStream.style.display = 'inline-flex';
        btnStopStream.disabled = false;
        if (btnStopTestStream) btnStopTestStream.style.display = 'none';
      }
    } else if (stats.status === 'stopping') {
      statusBadge.classList.add('starting');
      statusText.textContent = 'Stopping...';
      btnStartLive.disabled = true;
      btnStartTest.disabled = true;
      btnStopStream.disabled = true;
      if (btnStopTestStream) btnStopTestStream.disabled = true;
    } else {
      statusBadge.classList.add(stats.status === 'error' ? 'error' : 'idle');
      statusText.textContent = stats.status === 'error' ? 'Error' : 'Offline';
      btnStartLive.style.display = 'inline-flex';
      btnStartTest.style.display = 'inline-flex';
      btnStartLive.disabled = false;
      btnStartTest.disabled = false;
      btnStopStream.style.display = 'none';
      btnStopStream.disabled = false;
      if (btnStopTestStream) {
        btnStopTestStream.style.display = 'none';
        btnStopTestStream.disabled = false;
      }
    }

    fpsMetric.textContent = stats.fps ? stats.fps.toFixed(1) : '0.0';
    bitrateMetric.textContent = stats.bitrate || '0 kbps';
    speedMetric.textContent = stats.speed || '0.0x';

    streamUptimeSec = stats.uptime_seconds || 0;
    uptimeMetric.textContent = formatUptime(streamUptimeSec);

    // If streaming, update now playing and live monitor from backend
    if (stats.current_song) {
      if (appConfig.stream_mode === 'radio') {
        triggerNowPlayingFadeIn(stats.current_song.title, stats.current_song.artist);
      } else {
        if (overlayNowPlaying) overlayNowPlaying.style.display = 'none';
      }

      // Highlight active item across all lists
      const trackItems = document.querySelectorAll('#trackList .track-item');
      trackItems.forEach(el => {
        el.classList.toggle('playing', el.dataset.trackId === stats.current_song.track_id);
      });

      const vidItems = document.querySelectorAll('#videoList .track-item');
      vidItems.forEach(el => {
        el.classList.toggle('playing', el.dataset.videoId === stats.current_song.track_id);
      });

      const playlistItems = document.querySelectorAll('#playlistPlayList .track-item');
      playlistItems.forEach(el => {
        el.classList.toggle('playing', el.dataset.videoId === stats.current_song.track_id);
      });
    }

    // Keep active visual synchronized if reported in stats
    if (stats.active_visual && appConfig.active_visual_id !== stats.active_visual) {
      applyActiveVisual(stats.active_visual);
    }

    syncSideMenuState();
  }

  // 4. API Calls & Data Loaders
  async function loadConfig(isInitial = false) {
    try {
      const res = await fetch('/api/config');
      const data = await res.json();
      appConfig = (data && data.config) ? data.config : data;

      document.getElementById('cfgRtmpUrl').value = appConfig.rtmp_url || 'rtmp://a.rtmp.youtube.com/live2';
      document.getElementById('cfgResolution').value = appConfig.resolution || '1280x720';
      document.getElementById('cfgFps').value = appConfig.fps || 30;
      document.getElementById('cfgVideoBitrate').value = appConfig.video_bitrate || '3000k';
      document.getElementById('cfgAudioBitrate').value = appConfig.audio_bitrate || '192k';
      document.getElementById('cfgPreset').value = appConfig.preset || 'veryfast';

      document.getElementById('cfgVisualizerStyle').value = appConfig.visualizer_style || 'waves';
      document.getElementById('cfgVisualizerColor').value = appConfig.visualizer_color || 'cyan_neon';
      setStreamBannerTitle(appConfig.overlay_title || '', false);
      const bannerIsCustomVal = Boolean(appConfig.banner_custom_pos);
      const bannerAlignVal = appConfig.banner_align || 'left';
      setBannerAlign(bannerAlignVal, false);
      const bannerValignVal = appConfig.banner_valign || 'up';
      setBannerValign(bannerValignVal, false);
      const bannerPosXVal = typeof appConfig.banner_pos_x === 'number' ? appConfig.banner_pos_x : 2;
      const bannerPosYVal = typeof appConfig.banner_pos_y === 'number' ? appConfig.banner_pos_y : 3;
      setBannerCoordinates(bannerPosXVal, bannerPosYVal, bannerIsCustomVal, false);
      if (chkBannerCustomCoordinates) {
        chkBannerCustomCoordinates.checked = bannerIsCustomVal;
      }

      document.getElementById('cfgShowNowPlaying').checked = appConfig.show_now_playing !== false;

      const scaleVal = typeof appConfig.now_playing_scale === 'number' ? appConfig.now_playing_scale : 0.75;
      setBadgeScale(scaleVal, false);

      const colorVal = appConfig.now_playing_color || '#00f2fe';
      setBadgeColor(colorVal, false);

      const labelVal = appConfig.now_playing_label || 'Now Playing';
      setBadgeLabel(labelVal, false);

      const designVal = appConfig.now_playing_design || 'pill';
      setBadgeDesign(designVal, false);

      const isCustomVal = Boolean(appConfig.now_playing_custom_pos);
      const alignVal = appConfig.now_playing_align || 'left';
      setBadgeAlign(alignVal, false);

      const valignVal = appConfig.now_playing_valign || 'down';
      setBadgeValign(valignVal, false);

      const posXVal = typeof appConfig.now_playing_pos_x === 'number' ? appConfig.now_playing_pos_x : 2;
      const posYVal = typeof appConfig.now_playing_pos_y === 'number' ? appConfig.now_playing_pos_y : 88;
      setBadgeCoordinates(posXVal, posYVal, isCustomVal, false);
      if (chkCustomCoordinates) {
        chkCustomCoordinates.checked = isCustomVal;
      }

      const fsizeVal = typeof appConfig.now_playing_font_size === 'number' ? appConfig.now_playing_font_size : 13;
      setBadgeFontSize(fsizeVal, false);

      const weightVal = appConfig.now_playing_font_weight || '800';
      setBadgeWeight(weightVal, false);

      const transformVal = appConfig.now_playing_text_transform || 'uppercase';
      setBadgeTransform(transformVal, false);

      // Banner title visibility options for video and playlist modes
      const chkVideoBanner = document.getElementById('cfgShowVideoBannerTitle');
      if (chkVideoBanner) chkVideoBanner.checked = Boolean(appConfig.show_banner_in_video);

      const chkPlaylistBanner = document.getElementById('cfgShowPlaylistBannerTitle');
      if (chkPlaylistBanner) chkPlaylistBanner.checked = Boolean(appConfig.show_banner_in_playlist);

      updateOverlayTitleVisibility();
      if (overlayNowPlaying) {
        overlayNowPlaying.style.display = (appConfig.stream_mode === 'radio' && appConfig.show_now_playing !== false) ? 'flex' : 'none';
      }

      // Update visualizer engine config
      visualizer.setVisualizerConfig(appConfig.visualizer_style, appConfig.visualizer_color);
      let resLabel = `${appConfig.resolution} @ ${appConfig.fps}fps`;
      if (appConfig.resolution === '3840x2160') resLabel = `4K Ultra HD @ ${appConfig.fps}fps`;
      else if (appConfig.resolution === '2560x1440') resLabel = `2K Quad HD @ ${appConfig.fps}fps`;
      else if (appConfig.resolution === '1920x1080') resLabel = `Full HD 1080p @ ${appConfig.fps}fps`;
      else if (appConfig.resolution === '1280x720') resLabel = `720p HD @ ${appConfig.fps}fps`;
      monitorResolutionTag.textContent = resLabel;

      // Highlight matching preset card
      presetCards.forEach((card) => {
        const isMatch = card.dataset.res === appConfig.resolution && parseInt(card.dataset.fps) === appConfig.fps;
        card.classList.toggle('active', isMatch);
      });

      // Switch to active stream mode tab only on initial app load, not on every apply
      if (isInitial) {
        if (appConfig.stream_mode === 'playlist_play') {
          switchTab('tabPlaylistPlay', 'playlist_play');
        } else if (appConfig.stream_mode === 'video') {
          switchTab('tabDirectVideo', 'video');
        } else {
          switchTab('tabPlaylist', 'radio');
        }
      }

      // Stream Key Mask Status
      const keyStatusBadge = document.getElementById('keyStatusBadge');
      const keyInput = document.getElementById('cfgStreamKey');
      if (appConfig.has_stream_key) {
        keyStatusBadge.textContent = 'Configured ✓';
        keyStatusBadge.style.color = '#34d399';
        keyInput.value = appConfig.stream_key_masked;
      } else {
        keyStatusBadge.textContent = 'Not Set';
        keyStatusBadge.style.color = '#f87171';
        keyInput.value = '';
      }
    } catch (e) {
      console.error('Failed to load config:', e);
    }
  }

  async function loadPlaylist() {
    try {
      const res = await fetch('/api/playlist');
      currentPlaylist = await res.json();
      renderPlaylist(currentPlaylist);
      player.setPlaylist(currentPlaylist);
    } catch (e) {
      console.error('Failed to load playlist:', e);
    }
  }

  function renderPlaylist(tracks) {
    const listEl = document.getElementById('trackList');
    listEl.innerHTML = '';

    const selectBar = document.getElementById('tracksSelectBar');
    const selectSummary = document.getElementById('tracksSelectSummary');

    let totalDuration = 0;
    tracks.forEach((t) => (totalDuration += t.duration));
    const selectedCount = tracks.filter((t) => t.enabled !== false).length;

    const metaSummary = document.getElementById('playlistMetaSummary');
    metaSummary.textContent = `${tracks.length} tracks (${selectedCount} selected) • ${player.formatTime(totalDuration)} total`;
    if (sideTracksCount) sideTracksCount.textContent = tracks.length;

    if (selectBar) {
      if (tracks.length > 0) {
        selectBar.style.display = 'flex';
        if (selectSummary) {
          selectSummary.innerHTML = `<span>●</span> <strong>${selectedCount} of ${tracks.length}</strong> tracks selected to play`;
        }
      } else {
        selectBar.style.display = 'none';
      }
    }

    if (!tracks.length) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 24px; color: var(--text-dim); font-size: 0.85rem;">
          No tracks in playlist yet. Drop some audio files above or click "Load Demo Music"!
        </div>
      `;
      return;
    }

    tracks.forEach((track, index) => {
      const isEnabled = track.enabled !== false;
      const item = document.createElement('div');
      item.className = 'track-item';
      if (!isEnabled) {
        item.classList.add('disabled-item');
      }
      item.dataset.trackId = track.id;
      const isCurrent = player.currentIndex === index;
      const isPlaying = isCurrent && player.isPlaying;
      if (isCurrent) {
        item.classList.add('playing');
      }

      item.innerHTML = `
        <div class="track-left">
          <input type="checkbox" class="track-checkbox" ${isEnabled ? 'checked' : ''} title="${isEnabled ? 'Uncheck to skip track' : 'Check to include track'}">
          <span class="track-number">${(index + 1).toString().padStart(2, '0')}</span>
          <div class="btn-preview-group">
            <button class="btn btn-secondary btn-sm btn-play-track" title="${isPlaying ? 'Pause Preview' : 'Play Preview'}">${isPlaying ? '⏸' : '▶'}</button>
            <button class="btn btn-secondary btn-sm btn-stop-track" title="Stop Preview">⏹</button>
          </div>
          <div class="track-meta">
            <div class="track-title-row">
              <span class="track-title" title="${track.title}">${track.title}</span>
              <span class="tag-badge ${isEnabled ? 'queued' : 'skipped'}">${isEnabled ? 'IN QUEUE' : 'SKIPPED'}</span>
            </div>
            <span class="track-artist">${track.artist}</span>
          </div>
        </div>
        <div class="track-right">
          <div class="seq-btn-group">
            <button class="btn-seq btn-track-first" title="Play First (Move to Top)" ${index === 0 ? 'disabled' : ''}>⏫</button>
            <button class="btn-seq btn-track-up" title="Move Up" ${index === 0 ? 'disabled' : ''}>▲</button>
            <button class="btn-seq btn-track-down" title="Move Down" ${index === tracks.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="btn-seq btn-track-last" title="Play Last (Move to Bottom)" ${index === tracks.length - 1 ? 'disabled' : ''}>⏬</button>
          </div>
          <span class="track-duration">${track.duration_formatted}</span>
          <button class="btn btn-danger btn-sm btn-del-item btn-del-track" title="Remove track">✕</button>
        </div>
      `;

      item.querySelector('.track-checkbox').addEventListener('change', async (e) => {
        e.stopPropagation();
        await toggleTrack(track.id, e.target.checked);
      });

      item.querySelector('.btn-play-track').addEventListener('click', (e) => {
        e.stopPropagation();
        if (appConfig.stream_mode !== 'radio') {
          switchTab('tabPlaylist', 'radio');
        } else {
          if (currentVisuals && currentVisuals.length) {
            const activeVis = currentVisuals.find(v => v.id === appConfig.active_visual_id) || currentVisuals[0];
            if (activeVis) {
              visualizer.setMusicBackground(activeVis.url, activeVis.is_video);
            }
          }
          if (overlayNowPlaying) {
            overlayNowPlaying.style.display = appConfig.show_now_playing !== false ? 'flex' : 'none';
          }
        }
        if (player.currentIndex === index && player.isPlaying) {
          player.togglePlay();
        } else {
          player.loadTrack(index, true);
        }
        syncTrackListButtons();
      });

      item.querySelector('.btn-stop-track').addEventListener('click', (e) => {
        e.stopPropagation();
        player.stop();
        syncTrackListButtons();
      });

      item.querySelector('.btn-track-first')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await moveTrack(track.id, 'first');
      });

      item.querySelector('.btn-track-up')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await moveTrack(track.id, 'up');
      });

      item.querySelector('.btn-track-down')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await moveTrack(track.id, 'down');
      });

      item.querySelector('.btn-track-last')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await moveTrack(track.id, 'last');
      });

      item.querySelector('.btn-del-track').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Remove "${track.title}" from playlist?`)) {
          await deleteTrack(track.id);
        }
      });

      listEl.appendChild(item);
    });
  }

  function syncTrackListButtons() {
    const items = document.querySelectorAll('#trackList .track-item');
    items.forEach((item, idx) => {
      const isCurrent = player.currentIndex === idx;
      const isPlaying = isCurrent && player.isPlaying;
      item.classList.toggle('playing', isCurrent);
      const playBtn = item.querySelector('.btn-play-track');
      if (playBtn) {
        playBtn.textContent = isPlaying ? '⏸' : '▶';
        playBtn.title = isPlaying ? 'Pause Preview' : 'Play Preview';
      }
    });
  }

  async function moveTrack(trackId, direction) {
    try {
      const res = await fetch('/api/playlist/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: trackId, direction: direction }),
      });
      if (res.ok) {
        const data = await res.json();
        currentPlaylist = data.tracks || [];
        renderPlaylist(currentPlaylist);
        player.setPlaylist(currentPlaylist);
        showToast(`Moved track ${direction}`, 'info');
      } else {
        showToast('Failed to reorder track', 'error');
      }
    } catch (e) {
      showToast('Error reordering track', 'error');
    }
  }

  async function deleteTrack(trackId) {
    try {
      const currentPlaying = player.playlist[player.currentIndex];
      const isCurrent = currentPlaying && currentPlaying.id === trackId;

      const res = await fetch(`/api/playlist/${trackId}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Track removed', 'info');
        if (isCurrent) {
          player.audio.pause();
          player.currentIndex = -1;
        }
        await loadPlaylist();
      }
    } catch (e) {
      showToast('Failed to delete track', 'error');
    }
  }

  async function toggleTrack(trackId, enabled) {
    try {
      const res = await fetch('/api/playlist/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ track_id: trackId, enabled: enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        currentPlaylist = data.tracks || [];
        renderPlaylist(currentPlaylist);
        player.setPlaylist(currentPlaylist);
        showToast(enabled ? 'Track selected for playback' : 'Track skipped (will not play)', 'info');
      } else {
        showToast('Failed to toggle track', 'error');
      }
    } catch (e) {
      showToast('Error toggling track', 'error');
    }
  }

  async function selectAllTracks(enabled) {
    try {
      const res = await fetch('/api/playlist/select_all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabled }),
      });
      if (res.ok) {
        const data = await res.json();
        currentPlaylist = data.tracks || [];
        renderPlaylist(currentPlaylist);
        player.setPlaylist(currentPlaylist);
        showToast(enabled ? 'All tracks selected' : 'All tracks deselected', 'info');
      } else {
        showToast('Failed to update track selection', 'error');
      }
    } catch (e) {
      showToast('Error updating track selection', 'error');
    }
  }

  document.getElementById('btnSelectAllTracks')?.addEventListener('click', () => selectAllTracks(true));
  document.getElementById('btnDeselectAllTracks')?.addEventListener('click', () => selectAllTracks(false));

  // Clear all tracks from playlist
  document.getElementById('btnClearPlaylist')?.addEventListener('click', async () => {
    if (!currentPlaylist.length) {
      showToast('Playlist is already empty', 'info');
      return;
    }
    if (confirm(`Are you sure you want to remove all ${currentPlaylist.length} tracks from the playlist?`)) {
      showToast('Removing all tracks...', 'info');
      try {
        const res = await fetch('/api/playlist', { method: 'DELETE' });
        if (res.ok) {
          player.audio.pause();
          player.currentIndex = -1;
          showToast('All tracks removed from playlist', 'success');
          loadPlaylist();
        } else {
          showToast('Failed to clear playlist', 'error');
        }
      } catch (e) {
        showToast('Error clearing playlist', 'error');
      }
    }
  });

  async function loadVisuals() {
    try {
      const res = await fetch('/api/visuals');
      const data = await res.json();
      currentVisuals = data.visuals || [];
      renderVisuals(data.active, currentVisuals);
    } catch (e) {
      console.error('Failed to load visuals:', e);
    }
  }

  function renderVisuals(activeId, visuals) {
    const grid = document.getElementById('visualsGrid');
    grid.innerHTML = '';

    if (!visuals.length) {
      grid.innerHTML = `<div style="grid-column: span 2; text-align: center; color: var(--text-dim); padding: 16px;">No visuals found.</div>`;
      return;
    }

    visuals.forEach((v) => {
      const card = document.createElement('div');
      card.className = `visual-thumb-card ${v.id === activeId ? 'active' : ''}`;
      card.dataset.id = v.id;

      if (v.is_video) {
        card.innerHTML = `
          <video src="${v.url}" muted loop playsinline></video>
          <span class="visual-card-badge">VIDEO</span>
          <button class="visual-card-delete-btn" title="Delete this visual">✕</button>
          <span class="visual-card-title">${v.name}</span>
        `;
      } else {
        card.innerHTML = `
          <img src="${v.url}" alt="${v.name}" loading="lazy">
          <span class="visual-card-badge">IMAGE</span>
          <button class="visual-card-delete-btn" title="Delete this visual">✕</button>
          <span class="visual-card-title">${v.name}</span>
        `;
      }

      const delBtn = card.querySelector('.visual-card-delete-btn');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete background visual "${v.name}"?`)) {
          await deleteVisual(v.id);
        }
      });

      card.addEventListener('click', () => selectVisual(v.id, v.url, v.is_video));
      grid.appendChild(card);

      // If active, initialize music background visualizer once if not already playing
      if (v.id === activeId && (!appConfig.stream_mode || appConfig.stream_mode === 'radio')) {
        if (!visualizer.musicCurrentUrl) {
          visualizer.setMusicBackground(v.url, v.is_video);
        }
      }
    });
  }

  async function deleteVisual(visualId) {
    try {
      const res = await fetch(`/api/visuals/${encodeURIComponent(visualId)}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Background visual deleted', 'info');
        loadVisuals();
      } else {
        showToast('Failed to delete visual', 'error');
      }
    } catch (e) {
      showToast('Error deleting visual', 'error');
    }
  }

  // Clear all uploaded visuals
  document.getElementById('btnClearVisuals')?.addEventListener('click', async () => {
    if (confirm('Remove all uploaded backgrounds and reset to default?')) {
      showToast('Cleaning visual uploads...', 'info');
      try {
        const res = await fetch('/api/visuals', { method: 'DELETE' });
        if (res.ok) {
          showToast('Custom visuals removed and reset to default', 'success');
          loadVisuals();
        } else {
          showToast('Failed to remove visuals', 'error');
        }
      } catch (e) {
        showToast('Error removing visuals', 'error');
      }
    }
  });

  // ==========================================
  // DIRECT MP4 VIDEO (SINGLE VIDEO BROADCAST)
  // ==========================================
  async function loadVideos() {
    try {
      const res = await fetch('/api/media/videos');
      const data = await res.json();
      currentVideos = data.videos || [];

      const countLabel = document.getElementById('videoCountLabel');
      if (countLabel) {
        countLabel.textContent = `${currentVideos.length} video${currentVideos.length === 1 ? '' : 's'}`;
      }

      renderVideos(currentVideos, data.active);

      if (typeof data.loop_video === 'boolean') {
        const loopCheckbox = document.getElementById('cfgLoopVideo');
        if (loopCheckbox) loopCheckbox.checked = data.loop_video;
      }
      if (data.show_banner_in_video !== undefined) {
        appConfig.show_banner_in_video = data.show_banner_in_video;
        const chk = document.getElementById('cfgShowVideoBannerTitle');
        if (chk) chk.checked = Boolean(data.show_banner_in_video);
      }
    } catch (e) {
      console.error('Failed to load videos:', e);
    }
  }

  function renderVideos(videos, activeId) {
    const listEl = document.getElementById('videoList');
    if (!listEl) return;
    listEl.innerHTML = '';

    if (!videos.length) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 24px 16px; color: var(--text-dim); font-size: 0.85rem;">
          <div style="font-size: 1.6rem; margin-bottom: 6px;">🎬</div>
          No MP4 video uploaded yet. Drop an MP4 video above to broadcast live!
        </div>
      `;
      return;
    }

    videos.forEach((video) => {
      const item = document.createElement('div');
      item.className = 'track-item';
      item.dataset.videoId = video.id;
      const isActive = video.id === activeId;
      if (isActive) item.classList.add('playing');

      const audioBadge = video.has_audio
        ? `<span class="tag-badge has-audio" title="Native stereo audio">🔊 AUDIO</span>`
        : `<span class="tag-badge no-audio" title="Auto-generates compliant audio">🔇 AUTO-SYNC</span>`;

      const activeBadge = isActive
        ? `<span class="tag-badge active-broadcast">★ ACTIVE BROADCAST</span>`
        : '';

      const isCurrentVid = visualizer.currentUrl === video.url;
      const isVidPlaying = isCurrentVid && visualizer.isVideoPlaying();

      item.innerHTML = `
        <div class="track-left">
          <div class="btn-preview-group">
            <button class="btn btn-secondary btn-sm btn-play-video" title="${isVidPlaying ? 'Pause Video Preview' : 'Play Video Preview'}">${isVidPlaying ? '⏸' : '▶'}</button>
            <button class="btn btn-secondary btn-sm btn-stop-video" title="Stop Video Preview">⏹</button>
          </div>
          <div class="track-meta">
            <div class="track-title-row">
              <span class="track-title" title="${video.filename}">${video.name}</span>
              ${activeBadge}
              ${audioBadge}
              <span class="tag-badge resolution">${video.resolution}</span>
            </div>
            <span class="track-artist">${video.duration_formatted} • ${video.size_formatted} • ${video.filename}</span>
          </div>
        </div>
        <div class="track-right">
          <span class="track-duration">${video.duration_formatted}</span>
          ${!isActive ? `<button class="btn btn-secondary btn-sm btn-select-video" style="padding: 4px 10px; font-size: 0.74rem;" title="Set as broadcast video">Select</button>` : ''}
          <button class="btn btn-danger btn-sm btn-del-item btn-del-video" title="Delete video">✕</button>
        </div>
      `;

      // Preview / Pause / Play
      item.querySelector('.btn-play-video').addEventListener('click', (e) => {
        e.stopPropagation();
        if (player && player.isPlaying) {
          player.stop();
        }
        if (visualizer.currentUrl === video.url) {
          if (visualizer.isVideoPaused()) {
            visualizer.resumeVideo();
            showToast(`Resumed: ${video.name}`, 'info');
          } else {
            visualizer.pauseVideo();
            showToast(`Paused: ${video.name}`, 'info');
          }
        } else {
          if (overlayNowPlaying) overlayNowPlaying.style.display = 'none';
          visualizer.setBroadcastVideo(video.url, true);
          showToast(`Previewing: ${video.name}`, 'info');
        }
        syncVideoButtons();
      });

      // Stop Preview
      item.querySelector('.btn-stop-video').addEventListener('click', (e) => {
        e.stopPropagation();
        if (visualizer.broadcastCurrentUrl === video.url) {
          visualizer.stopBroadcastVideo();
          showToast(`Stopped preview: ${video.name}`, 'info');
        }
        syncVideoButtons();
      });

      // Select active video
      item.querySelector('.btn-select-video')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const res = await fetch('/api/media/videos/select', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_id: video.id, stream_mode: 'video' }),
          });
          if (res.ok) {
            showToast(`Selected "${video.name}" for live broadcast`, 'success');
            if (player && player.isPlaying) player.stop();
            if (overlayNowPlaying) overlayNowPlaying.style.display = 'none';
            visualizer.setBroadcastVideo(video.url, true);
            appConfig.stream_mode = 'video';
            updateModeUI('video');
            await loadVideos();
          }
        } catch (err) {
          showToast('Failed to select video', 'error');
        }
      });

      // Delete
      item.querySelector('.btn-del-video').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete video "${video.name}"?`)) {
          try {
            const res = await fetch(`/api/media/videos/${encodeURIComponent(video.id)}`, { method: 'DELETE' });
            if (res.ok) {
              showToast('Video deleted', 'info');
              await loadVideos();
            }
          } catch (err) {
            showToast('Error deleting video', 'error');
          }
        }
      });

      listEl.appendChild(item);
    });

    if (!visualizer.broadcastCurrentUrl && videos.length && appConfig.stream_mode === 'video' && statusText && statusText.textContent === 'Offline') {
      const activeObj = videos.find(v => v.id === activeId) || videos[0];
      visualizer.setBroadcastVideo(activeObj.url, true);
    }
  }

  function syncVideoButtons() {
    document.querySelectorAll('#videoList .track-item').forEach(el => {
      const vidId = el.dataset.videoId;
      const vidObj = currentVideos.find(v => v.id === vidId);
      const playBtn = el.querySelector('.btn-play-video');
      if (vidObj && playBtn) {
        const isCurrent = visualizer.currentUrl === vidObj.url;
        const isPlaying = isCurrent && visualizer.isVideoPlaying();
        playBtn.textContent = isPlaying ? '⏸' : '▶';
        playBtn.title = isPlaying ? 'Pause Video Preview' : 'Play Video Preview';
      }
    });
    updateMonitorControlsUI();
  }

  // Direct video upload events
  const btnUploadDirectVideo = document.getElementById('btnUploadDirectVideo');
  const directVideoFileInput = document.getElementById('directVideoFileInput');
  const videoDropzone = document.getElementById('videoDropzone');

  btnUploadDirectVideo?.addEventListener('click', () => directVideoFileInput.click());
  videoDropzone?.addEventListener('click', () => directVideoFileInput.click());

  ['dragenter', 'dragover'].forEach((eventName) => {
    videoDropzone?.addEventListener(eventName, (e) => {
      e.preventDefault();
      videoDropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    videoDropzone?.addEventListener(eventName, (e) => {
      e.preventDefault();
      videoDropzone.classList.remove('dragover');
    });
  });

  videoDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length) uploadDirectVideoFile(files[0]);
  });

  directVideoFileInput?.addEventListener('change', (e) => {
    if (e.target.files.length) uploadDirectVideoFile(e.target.files[0]);
  });

  async function uploadDirectVideoFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    showToast(`Uploading video: ${file.name}...`, 'info');
    try {
      const res = await fetch('/api/media/videos/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        showToast('MP4 video uploaded and selected for direct streaming!', 'success');
        appConfig.stream_mode = 'video';
        updateModeUI('video');
        await loadVideos();
      } else {
        showToast('Failed to upload video', 'error');
      }
    } catch (e) {
      showToast('Network error uploading video', 'error');
    }
  }

  // ==========================================
  // PLAYLIST PLAY (MULTI-VIDEO SEQUENTIAL BROADCASTER)
  // ==========================================
  let activePlaylistVideoIndex = -1;

  async function loadPlaylistPlay() {
    try {
      const res = await fetch('/api/playlist_play');
      const data = await res.json();
      currentPlaylistPlay = data.items || [];
      if (data.playlist_loop_single_id !== undefined) {
        appConfig.playlist_loop_single_id = data.playlist_loop_single_id;
      }
      if (data.show_banner_in_playlist !== undefined) {
        appConfig.show_banner_in_playlist = data.show_banner_in_playlist;
        const chk = document.getElementById('cfgShowPlaylistBannerTitle');
        if (chk) chk.checked = Boolean(data.show_banner_in_playlist);
      }
      renderPlaylistPlay(
        currentPlaylistPlay,
        data.total_duration_formatted || '00:00',
        data.count || 0,
        data.selected_count ?? currentPlaylistPlay.filter((i) => i.enabled !== false).length
      );
    } catch (e) {
      console.error('Failed to load playlist_play:', e);
    }
  }

  function playPlaylistVideo(index) {
    if (!currentPlaylistPlay || !currentPlaylistPlay.length) return;
    if (index < 0 || index >= currentPlaylistPlay.length) index = 0;
    activePlaylistVideoIndex = index;
    const video = currentPlaylistPlay[index];
    if (!video) return;

    if (player && player.isPlaying) {
      player.stop();
    }

    visualizer.setMute(false);
    const shouldLoop = Boolean(video && appConfig.playlist_loop_single_id === video.id);
    visualizer.setVideoLoop(shouldLoop);
    visualizer.setBroadcastVideo(video.url, shouldLoop);

    const seqNumber = (index + 1).toString().padStart(2, '0');
    if (overlayNowPlaying) overlayNowPlaying.style.display = 'none';
    syncPlaylistPlayButtons();
    updateMonitorControlsUI();
  }

  function onPlaylistVideoEnded() {
    if (appConfig.stream_mode !== 'playlist_play') return;
    if (activePlaylistVideoIndex >= 0 && activePlaylistVideoIndex < currentPlaylistPlay.length) {
      const currVid = currentPlaylistPlay[activePlaylistVideoIndex];
      if (currVid && appConfig.playlist_loop_single_id === currVid.id) {
        if (visualizer.bgVideo) {
          visualizer.bgVideo.currentTime = 0;
          visualizer.bgVideo.play().catch(() => {});
        }
        return;
      }
    }
    playNextPlaylistVideo();
  }

  function playNextPlaylistVideo() {
    if (!currentPlaylistPlay || !currentPlaylistPlay.length) return;
    const hasEnabled = currentPlaylistPlay.some((v) => v.enabled !== false);
    if (!hasEnabled) {
      visualizer.stopVideo();
      activePlaylistVideoIndex = -1;
      syncPlaylistPlayButtons();
      updateMonitorControlsUI();
      return;
    }

    let nextIdx = (activePlaylistVideoIndex + 1) % currentPlaylistPlay.length;
    let attempts = 0;
    while (attempts < currentPlaylistPlay.length) {
      const candidate = currentPlaylistPlay[nextIdx];
      if (candidate && candidate.enabled !== false) {
        playPlaylistVideo(nextIdx);
        showToast(`Auto-playing next: #${(nextIdx + 1).toString().padStart(2, '0')} ${candidate.title}`, 'info');
        return;
      }
      nextIdx = (nextIdx + 1) % currentPlaylistPlay.length;
      attempts++;
    }
    visualizer.stopVideo();
    activePlaylistVideoIndex = -1;
    syncPlaylistPlayButtons();
    updateMonitorControlsUI();
  }

  // Connect visualizer ended event for loops and sequential playback
  visualizer.onVideoEnded = () => {
    const mode = appConfig.stream_mode || 'radio';
    if (mode === 'radio') {
      // Artwork/Visualizer: background video continues to play without stop continuously in repetition
      if (visualizer.bgVideo) {
        visualizer.bgVideo.currentTime = 0;
        visualizer.bgVideo.play().catch(() => {});
      }
    } else if (mode === 'video') {
      // Direct Video Mode: Always loop continuously in preview
      if (visualizer.bgVideo) {
        visualizer.bgVideo.currentTime = 0;
        visualizer.bgVideo.play().catch(() => {});
      }
    } else if (mode === 'playlist_play') {
      onPlaylistVideoEnded();
    }
  };

  function renderPlaylistPlay(items, totalDurationFormatted, count, selectedCount) {
    const listEl = document.getElementById('playlistPlayList');
    if (!listEl) return;
    listEl.innerHTML = '';

    const selectBar = document.getElementById('playlistPlaySelectBar');
    const selectSummary = document.getElementById('playlistPlaySelectSummary');
    if (selectedCount === undefined) {
      selectedCount = items.filter((v) => v.enabled !== false).length;
    }

    const summaryEl = document.getElementById('playlistPlaySummary');
    if (summaryEl) {
      summaryEl.textContent = `${count} videos (${selectedCount} selected) • ${totalDurationFormatted} total • Broadcasts one by one 24/7`;
    }

    const countLabel = document.getElementById('playlistPlayCountLabel');
    if (countLabel) {
      countLabel.textContent = `${selectedCount} / ${count} videos queued`;
    }

    if (selectBar) {
      if (items.length > 0) {
        selectBar.style.display = 'flex';
        if (selectSummary) {
          selectSummary.innerHTML = `<span>●</span> <strong>${selectedCount} of ${items.length}</strong> videos selected to broadcast`;
        }
      } else {
        selectBar.style.display = 'none';
      }
    }

    if (!items.length) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 28px 16px; color: var(--text-dim); font-size: 0.85rem;">
          <div style="font-size: 1.6rem; margin-bottom: 6px;">📑</div>
          No videos in playlist yet. Drop multiple MP4 videos above or click "+ Upload Videos" to broadcast them sequentially!
        </div>
      `;
      return;
    }

    items.forEach((video, index) => {
      const isEnabled = video.enabled !== false;
      const isLoopingThis = (appConfig.playlist_loop_single_id === video.id);
      const item = document.createElement('div');
      item.className = 'track-item';
      if (!isEnabled) {
        item.classList.add('disabled-item');
      }
      item.dataset.videoId = video.id;

      const audioBadge = video.has_audio
        ? `<span class="tag-badge has-audio" title="Native audio track detected">🔊 AUDIO</span>`
        : `<span class="tag-badge no-audio" title="Auto-normalized with broadcast-compliant audio">🔇 AUTO-SYNC</span>`;

      const queueBadge = `<span class="tag-badge ${isEnabled ? 'queued' : 'skipped'}">${isEnabled ? 'QUEUED' : 'SKIPPED'}</span>`;
      const loopBadge = isLoopingThis
        ? `<span class="tag-badge loop-only" title="Exclusively looping this video">🔂 LOOPING</span>`
        : '';

      const seqNumber = (index + 1).toString().padStart(2, '0');
      const isCurrentVid = visualizer.currentUrl === video.url;
      const isVidPlaying = isCurrentVid && visualizer.isVideoPlaying();

      item.innerHTML = `
        <div class="track-left">
          <input type="checkbox" class="track-checkbox" ${isEnabled ? 'checked' : ''} title="${isEnabled ? 'Uncheck to skip video' : 'Check to include video in broadcast'}">
          <span class="track-number" style="font-weight: 700; color: var(--accent-cyan);">#${seqNumber}</span>
          <div class="btn-preview-group">
            <button class="btn btn-secondary btn-sm btn-play-playlist-video" title="${isVidPlaying ? 'Pause Video Preview' : 'Play Video Preview'}">${isVidPlaying ? '⏸' : '▶'}</button>
            <button class="btn btn-secondary btn-sm btn-stop-playlist-video" title="Stop Video Preview">⏹</button>
          </div>
          <div class="track-meta">
            <div class="track-title-row">
              <span class="track-title" title="${video.filename}">${video.title}</span>
              ${loopBadge}
              ${queueBadge}
              ${audioBadge}
              <span class="tag-badge resolution">${video.resolution}</span>
            </div>
            <span class="track-artist">${video.duration_formatted} • ${video.size_formatted} • ${video.filename}</span>
          </div>
        </div>
        <div class="track-right">
          <button class="btn-loop-video ${isLoopingThis ? 'loop-active' : ''}" title="${isLoopingThis ? 'Looping this video only (Click to disable and resume sequential play)' : 'Loop this video only'}">🔂</button>
          <div class="seq-btn-group">
            <button class="btn-seq btn-move-first" title="Play First (Move to Top)" ${index === 0 ? 'disabled' : ''}>⏫</button>
            <button class="btn-seq btn-move-up" title="Move Up" ${index === 0 ? 'disabled' : ''}>▲</button>
            <button class="btn-seq btn-move-down" title="Move Down" ${index === items.length - 1 ? 'disabled' : ''}>▼</button>
            <button class="btn-seq btn-move-last" title="Play Last (Move to Bottom)" ${index === items.length - 1 ? 'disabled' : ''}>⏬</button>
          </div>
          <span class="track-duration">${video.duration_formatted}</span>
          <button class="btn btn-danger btn-sm btn-del-item btn-del-playlist-video" title="Remove video from playlist">✕</button>
        </div>
      `;

      // Checkbox Toggle
      item.querySelector('.track-checkbox').addEventListener('change', async (e) => {
        e.stopPropagation();
        await togglePlaylistItem(video.id, e.target.checked);
      });

      // Single Video Loop Toggle
      item.querySelector('.btn-loop-video')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        const isCurrentlyLooping = (appConfig.playlist_loop_single_id === video.id);
        const newLoopId = isCurrentlyLooping ? null : video.id;
        appConfig.playlist_loop_single_id = newLoopId;

        if (visualizer.currentUrl === video.url) {
          visualizer.setVideoLoop(!isCurrentlyLooping);
        }

        try {
          await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ playlist_loop_single_id: newLoopId }),
          });
        } catch (err) {}

        renderPlaylistPlay(
          currentPlaylistPlay,
          totalDurationFormatted,
          count,
          selectedCount
        );

        if (newLoopId) {
          showToast(`Looping only "${video.title}" continuously`, 'info');
        } else {
          showToast('Single video loop disabled — Sequential playlist playback active', 'info');
        }
      });

      // Preview / Play / Pause
      item.querySelector('.btn-play-playlist-video').addEventListener('click', (e) => {
        e.stopPropagation();
        if (player && player.isPlaying) {
          player.audio.pause();
        }
        if (activePlaylistVideoIndex === index && visualizer.currentUrl === video.url) {
          if (visualizer.isVideoPaused()) {
            visualizer.resumeVideo();
            showToast(`Resumed: #${seqNumber} ${video.title}`, 'info');
          } else {
            visualizer.pauseVideo();
            showToast(`Paused: #${seqNumber} ${video.title}`, 'info');
          }
        } else {
          playPlaylistVideo(index);
          showToast(`Playing: #${seqNumber} ${video.title}`, 'info');
        }
        syncPlaylistPlayButtons();
      });

      // Stop Preview
      item.querySelector('.btn-stop-playlist-video').addEventListener('click', (e) => {
        e.stopPropagation();
        if (visualizer.currentUrl === video.url) {
          visualizer.stopVideo();
          activePlaylistVideoIndex = -1;
          showToast(`Stopped: #${seqNumber} ${video.title}`, 'info');
        }
        syncPlaylistPlayButtons();
      });

      // Move to First
      item.querySelector('.btn-move-first')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await movePlaylistPlayItem(video.id, 'first');
      });

      // Move Up
      item.querySelector('.btn-move-up')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await movePlaylistPlayItem(video.id, 'up');
      });

      // Move Down
      item.querySelector('.btn-move-down')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await movePlaylistPlayItem(video.id, 'down');
      });

      // Move to Last
      item.querySelector('.btn-move-last')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await movePlaylistPlayItem(video.id, 'last');
      });

      // Delete
      item.querySelector('.btn-del-playlist-video').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Remove "${video.title}" from playlist?`)) {
          await deletePlaylistPlayItem(video.id);
        }
      });

      listEl.appendChild(item);
    });

    if (!visualizer.currentUrl && items.length && appConfig.stream_mode === 'playlist_play' && statusText && statusText.textContent === 'Offline') {
      const initialIdx = activePlaylistVideoIndex >= 0 ? activePlaylistVideoIndex : 0;
      visualizer.setBroadcastVideo(items[initialIdx].url, false);
    }
  }

  function syncPlaylistPlayButtons() {
    document.querySelectorAll('#playlistPlayList .track-item').forEach((el) => {
      const vidId = el.dataset.videoId;
      const vidObj = currentPlaylistPlay.find((v) => v.id === vidId);
      const playBtn = el.querySelector('.btn-play-playlist-video');
      if (vidObj && playBtn) {
        const isCurrent = visualizer.currentUrl === vidObj.url;
        const isPlaying = isCurrent && visualizer.isVideoPlaying();
        playBtn.textContent = isPlaying ? '⏸' : '▶';
        playBtn.title = isPlaying ? 'Pause Video Preview' : 'Play Video Preview';
        el.classList.toggle('playing', isCurrent);
      }
    });
    updateMonitorControlsUI();
  }

  async function togglePlaylistItem(videoId, enabled) {
    try {
      const res = await fetch('/api/playlist_play/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId, enabled: enabled }),
      });
      if (res.ok) {
        await loadPlaylistPlay();
        showToast(enabled ? 'Video queued for broadcast' : 'Video skipped from broadcast queue', 'info');
      } else {
        showToast('Failed to toggle video', 'error');
      }
    } catch (e) {
      showToast('Error toggling video', 'error');
    }
  }

  async function selectAllVideos(enabled) {
    try {
      const res = await fetch('/api/playlist_play/select_all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: enabled }),
      });
      if (res.ok) {
        await loadPlaylistPlay();
        showToast(enabled ? 'All videos selected' : 'All videos deselected', 'info');
      } else {
        showToast('Error updating video selection', 'error');
      }
    } catch (e) {
      showToast('Error updating video selection', 'error');
    }
  }

  document.getElementById('btnSelectAllVideos')?.addEventListener('click', () => selectAllVideos(true));
  document.getElementById('btnDeselectAllVideos')?.addEventListener('click', () => selectAllVideos(false));

  async function movePlaylistPlayItem(videoId, direction) {
    try {
      const res = await fetch('/api/playlist_play/move', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId, direction: direction }),
      });
      if (res.ok) {
        await loadPlaylistPlay();
      }
    } catch (e) {
      showToast('Error reordering video playlist', 'error');
    }
  }

  async function deletePlaylistPlayItem(videoId) {
    try {
      const res = await fetch(`/api/playlist_play/${encodeURIComponent(videoId)}`, { method: 'DELETE' });
      if (res.ok) {
        showToast('Video removed from playlist', 'info');
        await loadPlaylistPlay();
      } else {
        showToast('Failed to delete video from playlist', 'error');
      }
    } catch (e) {
      showToast('Error deleting video', 'error');
    }
  }

  // Clear all in playlist_play
  document.getElementById('btnClearPlaylistPlay')?.addEventListener('click', async () => {
    if (!currentPlaylistPlay.length) {
      showToast('Video playlist is already empty', 'info');
      return;
    }
    if (confirm(`Remove all ${currentPlaylistPlay.length} videos from the playlist?`)) {
      showToast('Clearing video playlist...', 'info');
      try {
        const res = await fetch('/api/playlist_play', { method: 'DELETE' });
        if (res.ok) {
          showToast('All videos cleared from playlist', 'success');
          await loadPlaylistPlay();
        } else {
          showToast('Failed to clear playlist', 'error');
        }
      } catch (e) {
        showToast('Error clearing playlist', 'error');
      }
    }
  });

  // Multi-video upload handlers for playlist_play
  const btnUploadPlaylistPlay = document.getElementById('btnUploadPlaylistPlay');
  const playlistPlayFileInput = document.getElementById('playlistPlayFileInput');
  const playlistPlayDropzone = document.getElementById('playlistPlayDropzone');

  btnUploadPlaylistPlay?.addEventListener('click', () => playlistPlayFileInput.click());
  playlistPlayDropzone?.addEventListener('click', () => playlistPlayFileInput.click());

  ['dragenter', 'dragover'].forEach((eventName) => {
    playlistPlayDropzone?.addEventListener(eventName, (e) => {
      e.preventDefault();
      playlistPlayDropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    playlistPlayDropzone?.addEventListener(eventName, (e) => {
      e.preventDefault();
      playlistPlayDropzone.classList.remove('dragover');
    });
  });

  playlistPlayDropzone?.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length) uploadPlaylistPlayFiles(files);
  });

  playlistPlayFileInput?.addEventListener('change', (e) => {
    if (e.target.files.length) uploadPlaylistPlayFiles(e.target.files);
  });

  async function uploadPlaylistPlayFiles(files) {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    showToast(`Uploading ${files.length} video(s) to playlist...`, 'info');
    try {
      const res = await fetch('/api/playlist_play/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        showToast(`Added ${data.uploaded_count || files.length} video(s) to playlist!`, 'success');
        appConfig.stream_mode = 'playlist_play';
        updateModeUI('playlist_play');
        await loadPlaylistPlay();
      } else {
        showToast('Failed to upload videos', 'error');
      }
    } catch (e) {
      showToast('Network error uploading videos', 'error');
    }
  }

  document.getElementById('cfgLoopVideo')?.addEventListener('change', async (e) => {
    await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loop_video: e.target.checked }),
    });
    showToast(e.target.checked ? '24/7 video playlist loop enabled' : 'Playlist loop disabled', 'info');
  });

  document.getElementById('cfgShowVideoBannerTitle')?.addEventListener('change', async (e) => {
    appConfig.show_banner_in_video = e.target.checked;
    updateOverlayTitleVisibility();
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_banner_in_video: e.target.checked }),
      });
      showToast(e.target.checked ? 'Stream banner title shown on video' : 'Stream banner title hidden on video', 'info');
    } catch (err) {
      showToast('Error saving banner setting', 'error');
    }
  });

  document.getElementById('cfgShowPlaylistBannerTitle')?.addEventListener('change', async (e) => {
    appConfig.show_banner_in_playlist = e.target.checked;
    updateOverlayTitleVisibility();
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ show_banner_in_playlist: e.target.checked }),
      });
      showToast(e.target.checked ? 'Stream banner title shown on playlist' : 'Stream banner title hidden on playlist', 'info');
    } catch (err) {
      showToast('Error saving banner setting', 'error');
    }
  });

  function applyActiveVisual(visualId) {
    if (!visualId) return;
    appConfig.active_visual_id = visualId;
    // Highlight the card in visualsGrid
    document.querySelectorAll('#visualsGrid .visual-thumb-card').forEach(card => {
      card.classList.toggle('active', card.dataset.id === visualId);
    });
    // Find the visual data object
    const v = currentVisuals.find(item => item.id === visualId);
    if (v) {
      visualizer.setMusicBackground(v.url, v.is_video);
    } else {
      loadVisuals().then(() => {
        const found = currentVisuals.find(item => item.id === visualId);
        if (found) visualizer.setMusicBackground(found.url, found.is_video);
      }).catch(() => {});
    }
  }

  async function selectVisual(visualId, url, isVideo) {
    // 1. Immediately apply background independently to Music Radio channel
    appConfig.active_visual_id = visualId;
    visualizer.setMusicBackground(url, isVideo);

    // 2. Immediately update the visual cards UI highlight
    document.querySelectorAll('#visualsGrid .visual-thumb-card').forEach(card => {
      card.classList.toggle('active', card.dataset.id === visualId);
    });

    if (appConfig.stream_mode !== 'radio') {
      switchTab('tabPlaylist', 'radio');
    }

    // 3. Persist to server in the background
    try {
      const res = await fetch('/api/visuals/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visual_id: visualId }),
      });
      if (res.ok) {
        showToast('Music background updated', 'success');
      }
    } catch (e) {
      console.warn('Failed to save visual selection:', e);
    }
  }

  // 5. File Uploads (Drag & Drop)
  const audioDropzone = document.getElementById('audioDropzone');
  const audioFileInput = document.getElementById('audioFileInput');

  audioDropzone.addEventListener('click', () => audioFileInput.click());

  ['dragenter', 'dragover'].forEach((eventName) => {
    audioDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      audioDropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    audioDropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      audioDropzone.classList.remove('dragover');
    });
  });

  audioDropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length) uploadAudioFiles(files);
  });

  audioFileInput.addEventListener('change', (e) => {
    if (e.target.files.length) uploadAudioFiles(e.target.files);
  });

  async function uploadAudioFiles(files) {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }

    showToast(`Uploading ${files.length} audio file(s)...`, 'info');
    try {
      const res = await fetch('/api/playlist/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        showToast('Music uploaded successfully!', 'success');
        loadPlaylist();
      } else {
        showToast('Failed to upload audio files', 'error');
      }
    } catch (e) {
      showToast('Network error while uploading', 'error');
    }
  }

  // Visual Upload
  const btnUploadVisual = document.getElementById('btnUploadVisual');
  const visualFileInput = document.getElementById('visualFileInput');

  btnUploadVisual.addEventListener('click', () => visualFileInput.click());
  visualFileInput.addEventListener('change', async (e) => {
    if (!e.target.files.length) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);

    showToast(`Uploading background: ${file.name}...`, 'info');
    try {
      const res = await fetch('/api/visuals/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        showToast('Background uploaded!', 'success');
        loadVisuals();
      } else {
        showToast('Upload failed. Use PNG, JPG, or MP4.', 'error');
      }
    } catch (e) {
      showToast('Error uploading background', 'error');
    }
  });

  // Load Demo Tracks Button
  document.getElementById('btnLoadDemoTracks').addEventListener('click', async () => {
    showToast('Synthesizing demo lo-fi tracks & sunset artwork...', 'info');
    try {
      const res = await fetch('/api/demo/generate', { method: 'POST' });
      if (res.ok) {
        showToast('Demo music and visuals ready!', 'success');
        await loadPlaylist();
        await loadVisuals();
      }
    } catch (e) {
      showToast('Failed to generate demo tracks', 'error');
    }
  });

  // 6. Settings Handlers
  document.getElementById('btnToggleKeyMask').addEventListener('click', (e) => {
    const keyInput = document.getElementById('cfgStreamKey');
    if (keyInput.type === 'password') {
      keyInput.type = 'text';
      e.target.textContent = 'Hide';
    } else {
      keyInput.type = 'password';
      e.target.textContent = 'Show';
    }
  });

  document.getElementById('btnClearStreamKey')?.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stream_key: '' }),
      });
      if (res.ok) {
        const keyInput = document.getElementById('cfgStreamKey');
        if (keyInput) keyInput.value = '';
        const keyStatusBadge = document.getElementById('keyStatusBadge');
        if (keyStatusBadge) {
          keyStatusBadge.textContent = 'Not Set';
          keyStatusBadge.style.color = '#f87171';
        }
        showToast('YouTube stream key removed', 'info');
        loadConfig();
      }
    } catch (e) {
      showToast('Failed to remove stream key', 'error');
    }
  });

  // Save Encoder Settings
  document.getElementById('btnSaveConfig').addEventListener('click', async () => {
    const keyVal = document.getElementById('cfgStreamKey').value.trim();
    const payload = {
      rtmp_url: document.getElementById('cfgRtmpUrl').value.trim(),
      resolution: document.getElementById('cfgResolution').value,
      fps: parseInt(document.getElementById('cfgFps').value),
      video_bitrate: document.getElementById('cfgVideoBitrate').value,
      audio_bitrate: document.getElementById('cfgAudioBitrate').value,
      preset: document.getElementById('cfgPreset').value,
    };

    if (keyVal === '') {
      payload.stream_key = '';
    } else if (keyVal && !keyVal.includes('...')) {
      payload.stream_key = keyVal;
    }

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showToast('Encoder settings saved!', 'success');
        loadConfig();
      } else {
        showToast('Failed to save settings', 'error');
      }
    } catch (e) {
      showToast('Network error saving settings', 'error');
    }
  });

  // Save Visuals & Overlay Settings
  document.getElementById('btnSaveVisualsConfig').addEventListener('click', async () => {
    const style = document.getElementById('cfgVisualizerStyle').value;
    const color = document.getElementById('cfgVisualizerColor').value;
    const title = document.getElementById('cfgOverlayTitle').value.trim();
    const showNowPlaying = document.getElementById('cfgShowNowPlaying').checked;
    const nowPlayingScale = sliderNowPlayingScale ? parseFloat(sliderNowPlayingScale.value) / 100 : 0.75;
    const nowPlayingColor = inputNowPlayingColor ? inputNowPlayingColor.value : '#00f2fe';
    const nowPlayingLabel = inputNowPlayingLabel ? inputNowPlayingLabel.value.trim() : 'Now Playing';

    const payload = {
      visualizer_style: style,
      visualizer_color: color,
      overlay_title: title,
      banner_align: appConfig.banner_align || 'left',
      banner_valign: appConfig.banner_valign || 'up',
      banner_pos_x: numBannerPosX ? parseInt(numBannerPosX.value, 10) : (appConfig.banner_pos_x ?? 2),
      banner_pos_y: numBannerPosY ? parseInt(numBannerPosY.value, 10) : (appConfig.banner_pos_y ?? 3),
      banner_custom_pos: chkBannerCustomCoordinates ? chkBannerCustomCoordinates.checked : Boolean(appConfig.banner_custom_pos),
      show_now_playing: showNowPlaying,
      now_playing_scale: nowPlayingScale,
      now_playing_color: nowPlayingColor,
      now_playing_label: nowPlayingLabel,
      now_playing_design: appConfig.now_playing_design || 'pill',
      now_playing_align: appConfig.now_playing_align || 'left',
      now_playing_valign: appConfig.now_playing_valign || 'down',
      now_playing_pos_x: numNowPlayingPosX ? parseInt(numNowPlayingPosX.value, 10) : (appConfig.now_playing_pos_x ?? 2),
      now_playing_pos_y: numNowPlayingPosY ? parseInt(numNowPlayingPosY.value, 10) : (appConfig.now_playing_pos_y ?? 88),
      now_playing_custom_pos: chkCustomCoordinates ? chkCustomCoordinates.checked : Boolean(appConfig.now_playing_custom_pos),
      now_playing_font_size: appConfig.now_playing_font_size || 13,
      now_playing_font_weight: appConfig.now_playing_font_weight || '800',
      now_playing_text_transform: appConfig.now_playing_text_transform || 'uppercase',
    };

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        showToast('Visual settings applied!', 'success');
        await loadConfig();
      }
    } catch (e) {
      showToast('Error applying visual settings', 'error');
    }
  });

  // 7. Stream Broadcast Control Handlers
  btnStartLive.addEventListener('click', async () => {
    if (appConfig.stream_mode === 'playlist_play') {
      if (!currentPlaylistPlay.length) {
        showToast('Video playlist is empty! Please upload MP4 videos to the Playlist Play tab first.', 'error');
        switchTab('tabPlaylistPlay', 'playlist_play');
        return;
      }
    } else if (appConfig.stream_mode === 'video') {
      if (!currentVideos.length) {
        showToast('No MP4 videos available! Please upload an MP4 video first.', 'error');
        switchTab('tabDirectVideo', 'video');
        return;
      }
    } else {
      if (!currentPlaylist.length) {
        showToast('Your playlist is empty! Add songs or click "+ Demo" first.', 'error');
        switchTab('tabPlaylist', 'radio');
        return;
      }
    }

    if (!appConfig.has_stream_key) {
      showToast('Please enter your YouTube Stream Key in the "Stream Setup" tab!', 'error');
      switchTab('tabSettings');
      return;
    }

    showToast('Starting YouTube Live broadcast...', 'info');
    updateStreamStats({
      status: 'starting',
      is_test_mode: false,
      uptime_seconds: 0,
      fps: 0,
      bitrate: '0 kbps',
      speed: '0.0x',
      frame: 0
    });
    try {
      const res = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_mode: false }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('🚀 Live Broadcast started!', 'success');
      } else {
        showToast(`Failed to start: ${data.detail || 'Check stream key'}`, 'error');
        updateStreamStats({ status: 'idle', is_test_mode: false });
      }
    } catch (e) {
      showToast('Error starting stream', 'error');
      updateStreamStats({ status: 'idle', is_test_mode: false });
    }
  });

  btnStartTest.addEventListener('click', async () => {
    if (appConfig.stream_mode === 'playlist_play') {
      if (!currentPlaylistPlay.length) {
        showToast('Video playlist is empty! Please upload MP4 videos to the Playlist Play tab first.', 'error');
        switchTab('tabPlaylistPlay', 'playlist_play');
        return;
      }
    } else if (appConfig.stream_mode === 'video') {
      if (!currentVideos.length) {
        showToast('No MP4 videos available! Please upload an MP4 video first.', 'error');
        switchTab('tabDirectVideo', 'video');
        return;
      }
    } else {
      if (!currentPlaylist.length) {
        showToast('Your playlist is empty! Add songs or click "+ Demo" first.', 'error');
        switchTab('tabPlaylist', 'radio');
        return;
      }
    }

    showToast('Starting local test stream...', 'info');
    updateStreamStats({
      status: 'starting',
      is_test_mode: true,
      uptime_seconds: 0,
      fps: 0,
      bitrate: '0 kbps',
      speed: '0.0x',
      frame: 0
    });

    try {
      const res = await fetch('/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test_mode: true }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('Local test stream running!', 'success');
      } else {
        showToast(`Test error: ${data.detail}`, 'error');
        updateStreamStats({ status: 'idle', is_test_mode: false });
      }
    } catch (e) {
      showToast('Error launching test stream', 'error');
      updateStreamStats({ status: 'idle', is_test_mode: false });
    }
  });

  // Stop Local Test Stream (Immediate, zero confirm prompt)
  btnStopTestStream?.addEventListener('click', async () => {
    showToast('Stopping test stream...', 'info');
    try {
      btnStopTestStream.disabled = true;
      const res = await fetch('/api/stream/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        showToast('Local test stream stopped.', 'success');
        updateStreamStats({
          status: 'idle',
          is_test_mode: false,
          uptime_seconds: 0,
          fps: 0,
          bitrate: '0 kbps',
          speed: '0.0x',
          frame: 0
        });
      } else {
        showToast('Failed to stop test stream', 'error');
        btnStopTestStream.disabled = false;
      }
    } catch (e) {
      showToast('Error stopping test stream', 'error');
      btnStopTestStream.disabled = false;
    }
  });

  // Stop Live YouTube Broadcast (Confirm popup for broadcast safety)
  btnStopStream.addEventListener('click', async () => {
    if (confirm('Stop the live YouTube broadcast?')) {
      showToast('Stopping live broadcast...', 'info');
      try {
        btnStopStream.disabled = true;
        const res = await fetch('/api/stream/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          showToast('Live broadcast stopped.', 'info');
          updateStreamStats({
            status: 'idle',
            is_test_mode: false,
            uptime_seconds: 0,
            fps: 0,
            bitrate: '0 kbps',
            speed: '0.0x',
            frame: 0
          });
        } else {
          showToast('Failed to stop stream', 'error');
          btnStopStream.disabled = false;
        }
      } catch (e) {
        showToast('Error stopping stream', 'error');
        btnStopStream.disabled = false;
      }
    }
  });

  // 8. Stream Key Modal Guide
  const modalHelp = document.getElementById('modalStreamKeyHelp');
  document.getElementById('btnOpenStreamKeyHelp').addEventListener('click', () => {
    modalHelp.classList.add('active');
  });

  document.getElementById('btnCloseModal').addEventListener('click', () => {
    modalHelp.classList.remove('active');
  });

  document.getElementById('btnGotItModal').addEventListener('click', () => {
    modalHelp.classList.remove('active');
  });

  modalHelp.addEventListener('click', (e) => {
    if (e.target === modalHelp) modalHelp.classList.remove('active');
  });

  // Initialize
  async function initApp() {
    connectWebSocket();
    await loadConfig(true);
    loadPlaylist();
    loadVisuals();
    loadVideos();
    loadPlaylistPlay();
  }
  initApp();

  // Status Polling Fallback (every 5 seconds)
  setInterval(async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const stats = await res.json();
        updateStreamStats(stats);
      }
    } catch (e) {}
  }, 5000);
});
