// Reproductor TGVideo: Soporta ArtPlayer (avanzado) y Reproductor Nativo (HTML5)
import Artplayer from 'artplayer';
import { saveProgress, loadProgress } from './progress.js';
import { streamingAvailable, openStream } from './stream.js';
import { extractTitleAndYear } from '../metadata/tmdb.js';
import { prettyEpisodeName } from '../library/parse.js';
import { registerPlayerController, unregisterPlayerController } from '../ui/dpad.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));

/**
 * Formatea un título limpio y descriptivo sin repetir título ni año.
 */
export function formatPlayerTitle(title, file) {
  if (!title) return file?.label || 'Reproduciendo';

  const rawName = title.metadata?.name || title.nombre || '';
  const parsed = extractTitleAndYear(rawName);
  const cleanTitle = parsed.title || rawName;
  const year = title.metadata?.date?.slice(0, 4) || parsed.year || '';
  const yearSuffix = year ? ` (${year})` : '';

  if (title.tipo === 'serie') {
    const epNum = (file?.season || file?.episode)
      ? `T${file.season || 1}·E${String(file.episode || 1).padStart(2, '0')}`
      : '';
    const epName = file?.metadata?.name || file?.label || 'Episodio';
    return `${cleanTitle} · ${epNum ? epNum + ' - ' : ''}${epName}`;
  }

  if (title.isSaga) {
    const filmName = file?.metadata?.name || file?.sagaName || file?.label || cleanTitle;
    return filmName;
  }

  // Película estándar
  if (!file?.label) return `${cleanTitle}${yearSuffix}`;

  const cleanFileLabel = file.label
    .replace(/\b(19\d\d|20\d\d)\b/g, '')
    .replace(/[\[\(\]\)]/g, ' ')
    .trim();

  // Si la etiqueta del archivo es casi igual al nombre del título, no duplicar
  const normTitle = cleanTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  const normLabel = cleanFileLabel.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (normLabel === normTitle || normLabel.length === 0) {
    return `${cleanTitle}${yearSuffix}`;
  }

  const diffLabel = cleanFileLabel.replace(new RegExp(cleanTitle, 'gi'), '').trim();
  if (diffLabel && diffLabel.length > 2) {
    return `${cleanTitle}${yearSuffix} · ${diffLabel}`;
  }

  return `${cleanTitle}${yearSuffix}`;
}

function formatTime(secs) {
  if (!secs || isNaN(secs) || secs < 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function showToast(container, text) {
  let toast = container.querySelector('#pl-osd-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pl-osd-toast';
    toast.className = 'player-osd-toast';
    container.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function cycleAudio(video, container) {
  const tracks = (video.audioTracks && video.audioTracks.length > 0)
    ? Array.from(video.audioTracks)
    : [];
  if (tracks.length === 0) {
    showToast(container, 'Pista de audio: Predeterminada');
    return;
  }
  if (tracks.length === 1) {
    const label = tracks[0].label || tracks[0].language || 'Principal';
    showToast(container, `Audio único: ${label}`);
    return;
  }
  let cur = tracks.findIndex(t => t.enabled);
  if (cur === -1) cur = 0;
  const next = (cur + 1) % tracks.length;
  tracks.forEach((t, i) => { t.enabled = (i === next); });
  const label = tracks[next].label || tracks[next].language || `Pista ${next + 1}`;
  showToast(container, `Audio (${next + 1}/${tracks.length}): ${label}`);
}

function cycleSubtitles(video, container) {
  const tracks = (video.textTracks && video.textTracks.length > 0)
    ? Array.from(video.textTracks).filter(t => t.kind === 'subtitles' || t.kind === 'captions' || !t.kind)
    : [];
  if (tracks.length === 0) {
    showToast(container, 'No hay subtítulos en este archivo');
    return;
  }
  let cur = tracks.findIndex(t => t.mode === 'showing');
  let next = cur + 1;
  if (next >= tracks.length) next = -1;

  tracks.forEach((t, i) => {
    t.mode = (i === next) ? 'showing' : 'disabled';
  });

  if (next === -1) {
    showToast(container, 'Subtítulos: Desactivados');
  } else {
    const label = tracks[next].label || tracks[next].language || `Pista ${next + 1}`;
    showToast(container, `Subtítulos (${next + 1}/${tracks.length}): ${label}`);
  }
}

/**
 * Configura doble toque (móvil) y doble clic (escritorio) en izquierda/derecha
 */
function setupDoubleTapSkip({ container, video, skipSeconds = 10 }) {
  if (!container || !video) return () => {};

  const onDblClick = (e) => {
    if (e.target.closest('.player-tv-osd, .art-controls, .art-bottom, button, input, select')) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    const x = (e.clientX - rect.left) / rect.width;
    if (x <= 0.38) {
      e.preventDefault(); e.stopPropagation();
      video.currentTime = Math.max(0, (video.currentTime || 0) - skipSeconds);
      showToast(container, `⏪ -${skipSeconds}s`);
    } else if (x >= 0.62) {
      e.preventDefault(); e.stopPropagation();
      video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + skipSeconds);
      showToast(container, `+${skipSeconds}s ⏩`);
    }
  };

  let lastTapTime = 0;
  let lastTapX = 0;

  const onTouchEnd = (e) => {
    if (e.target.closest('.player-tv-osd, .art-controls, .art-bottom, button, input, select')) return;
    const touch = e.changedTouches?.[0];
    if (!touch) return;
    const rect = container.getBoundingClientRect();
    if (!rect.width) return;
    const x = (touch.clientX - rect.left) / rect.width;
    const now = Date.now();

    if (now - lastTapTime < 320 && Math.abs(touch.clientX - lastTapX) < 60) {
      if (x <= 0.38) {
        e.preventDefault(); e.stopPropagation();
        video.currentTime = Math.max(0, (video.currentTime || 0) - skipSeconds);
        showToast(container, `⏪ -${skipSeconds}s`);
      } else if (x >= 0.62) {
        e.preventDefault(); e.stopPropagation();
        video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + skipSeconds);
        showToast(container, `+${skipSeconds}s ⏩`);
      }
      lastTapTime = 0;
    } else {
      lastTapTime = now;
      lastTapX = touch.clientX;
    }
  };

  container.addEventListener('dblclick', onDblClick, true);
  container.addEventListener('touchend', onTouchEnd, { passive: false, capture: true });

  return () => {
    container.removeEventListener('dblclick', onDblClick, true);
    container.removeEventListener('touchend', onTouchEnd, { capture: true });
  };
}

export async function playFile({ client, peerOf, file, title, profile, resumeAt = 0, onClose, mount, sync }) {
  const localPref = typeof localStorage !== 'undefined' && profile?.id
    ? localStorage.getItem(`tgvideo_player_${profile.id}`)
    : null;
  const playerType = profile?.player || localPref || 'artplayer';

  const localSkip = typeof localStorage !== 'undefined' && profile?.id
    ? localStorage.getItem(`tgvideo_skip_${profile.id}`)
    : null;
  const skipSeconds = Number(profile?.skip_seconds || localSkip || 10);

  if (playerType === 'native') {
    return playNative({ client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount, sync });
  }
  return playArtplayer({ client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount, sync });
}

// -------------------------------------------------------------
// REPRODUCTOR NATIVO (HTML5) - Con OSD y controles TV completos
// -------------------------------------------------------------
async function playNative({ client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount, sync }) {
  const displayTitle = formatPlayerTitle(title, file);

  mount.innerHTML = `
    <div class="player player-native">
      <div class="player-tv-osd" id="pl-osd">
        <div class="player-osd-top">
          <button class="player-osd-btn" id="pl-btn-back" data-focusable>← Volver</button>
          <div class="player-osd-title">${escapeHtml(displayTitle)}</div>
          <button class="player-osd-btn player-osd-badge" id="pl-badge-toggle" title="Cambiar a ArtPlayer" data-focusable>Nativo ⇄</button>
        </div>
        <div class="player-osd-center">
          <button class="player-osd-btn" id="pl-btn-rw" data-focusable title="Atrasar">⏪ -${skipSeconds}s</button>
          <button class="player-osd-btn player-osd-btn-primary" id="pl-btn-playpause" data-focusable title="Reproducir/Pausar">⏯</button>
          <button class="player-osd-btn" id="pl-btn-ff" data-focusable title="Adelantar">+${skipSeconds}s ⏩</button>
          <button class="player-osd-btn" id="pl-btn-audio" data-focusable title="Cambiar audio">🔊 Audio</button>
          <button class="player-osd-btn" id="pl-btn-subs" data-focusable title="Cambiar subtítulos">💬 Subtítulos</button>
        </div>
        <div class="player-osd-bottom">
          <span class="player-osd-time" id="pl-time-cur">0:00</span>
          <div class="player-osd-bar-bg" id="pl-bar-bg">
            <div class="player-osd-bar-fill" id="pl-bar-fill"></div>
          </div>
          <span class="player-osd-time" id="pl-time-dur">0:00</span>
        </div>
      </div>
      <div class="player-osd-toast" id="pl-osd-toast"></div>
      <div class="player-codec-notice" id="pl-codec-notice" style="display:none;">
        <span>Safari no puede mostrar este formato de vídeo. Para iPhone, el archivo debe estar convertido a MP4 con vídeo H.264 y audio AAC.</span>
      </div>
      <div class="player-loading" id="pl-loading">
        <div class="loader"></div>
        <p id="pl-status">Conectando con Telegram…</p>
      </div>
      <video class="native-video" playsinline webkit-playsinline autoplay preload="auto"></video>
    </div>`;

  const playerEl = mount.querySelector('.player');
  const video = mount.querySelector('video');
  const loading = mount.querySelector('#pl-loading');
  const status = mount.querySelector('#pl-status');
  const osd = mount.querySelector('#pl-osd');
  const codecNotice = mount.querySelector('#pl-codec-notice');
  const timeCur = mount.querySelector('#pl-time-cur');
  const timeDur = mount.querySelector('#pl-time-dur');
  const barFill = mount.querySelector('#pl-bar-fill');
  const barBg = mount.querySelector('#pl-bar-bg');

  let cancelled = false;
  let stream = null;
  let url = null;
  let osdTimer = null;

  const showOsd = () => {
    osd.classList.remove('is-hidden');
    clearTimeout(osdTimer);
    if (!video.paused) {
      osdTimer = setTimeout(() => {
        osd.classList.add('is-hidden');
        if (osd.contains(document.activeElement)) document.activeElement.blur();
      }, 4000);
    }
  };

  const hideOsd = () => {
    clearTimeout(osdTimer);
    osd.classList.add('is-hidden');
    if (osd.contains(document.activeElement)) document.activeElement.blur();
  };

  playerEl.addEventListener('mousemove', showOsd);
  playerEl.addEventListener('click', (e) => {
    if (!e.target.closest('.player-tv-osd, button')) {
      if (osd.classList.contains('is-hidden')) showOsd();
      else hideOsd();
    }
  });

  video.addEventListener('play', () => {
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => {
      osd.classList.add('is-hidden');
      if (osd.contains(document.activeElement)) document.activeElement.blur();
    }, 2800);
  });

  video.addEventListener('pause', () => {
    clearTimeout(osdTimer);
    osd.classList.remove('is-hidden');
    if (sync && profile?.id && video.duration) {
      const progress = saveProgress(profile.id, file.key, video.currentTime, video.duration);
      sync.schedulePush({ profile, progress });
    }
  });

  const goFullscreen = () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const req = playerEl.requestFullscreen || playerEl.webkitRequestFullscreen;
    if (req) {
      Promise.resolve(req.call(playerEl, { navigationUI: 'hide' }))
        .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
        .catch(() => {
          if (video.webkitEnterFullscreen && video.readyState > 0) {
            try { video.webkitEnterFullscreen(); } catch (_) {}
          }
        });
    } else if (video.webkitEnterFullscreen && video.readyState > 0) {
      try { video.webkitEnterFullscreen(); } catch (_) {}
    }
  };

  const exitFullscreen = () => {
    try { screen.orientation?.unlock?.(); } catch (_) {}
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
    if (video.webkitExitFullscreen) try { video.webkitExitFullscreen(); } catch (_) {}
  };

  goFullscreen();

  const cleanupSkip = setupDoubleTapSkip({ container: playerEl, video, skipSeconds });

  const close = () => {
    if (cancelled) return;
    cancelled = true;
    unregisterPlayerController();
    cleanupSkip();
    clearTimeout(osdTimer);
    exitFullscreen();
    if (video.duration) {
      saveProgress(profile.id, file.key, video.currentTime, video.duration);
      if (sync && profile?.id) {
        const progress = saveProgress(profile.id, file.key, video.currentTime, video.duration);
        sync.schedulePush({ profile, progress });
      }
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    onClose?.();
  };

  // Botones OSD
  mount.querySelector('#pl-btn-back').onclick = close;

  mount.querySelector('#pl-badge-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const curTime = video.currentTime || resumeAt || 0;
    if (cancelled) return;
    cancelled = true;
    unregisterPlayerController();
    cleanupSkip();
    clearTimeout(osdTimer);
    exitFullscreen();
    if (video.duration) {
      saveProgress(profile.id, file.key, video.currentTime, video.duration);
    }
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    if (profile?.id) {
      localStorage.setItem(`tgvideo_player_${profile.id}`, 'artplayer');
      profile.player = 'artplayer';
    }
    playFile({ client, peerOf, file, title, profile, resumeAt: curTime, onClose, mount, sync });
  });

  mount.querySelector('#pl-btn-playpause').onclick = () => {
    if (video.paused) { video.play(); showToast(playerEl, '▶ Reproduciendo'); }
    else { video.pause(); showToast(playerEl, '⏸ Pausa'); }
    showOsd();
  };

  mount.querySelector('#pl-btn-rw').onclick = () => {
    video.currentTime = Math.max(0, (video.currentTime || 0) - skipSeconds);
    showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(video.currentTime)})`);
    showOsd();
  };

  mount.querySelector('#pl-btn-ff').onclick = () => {
    video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + skipSeconds);
    showToast(playerEl, `+${skipSeconds}s ⏩ (${formatTime(video.currentTime)})`);
    showOsd();
  };

  mount.querySelector('#pl-btn-audio').onclick = () => {
    cycleAudio(video, playerEl);
    showOsd();
  };

  mount.querySelector('#pl-btn-subs').onclick = () => {
    cycleSubtitles(video, playerEl);
    showOsd();
  };

  barBg.onclick = (e) => {
    const rect = barBg.getBoundingClientRect();
    if (rect.width && video.duration) {
      const pos = (e.clientX - rect.left) / rect.width;
      video.currentTime = pos * video.duration;
      showOsd();
    }
  };

  // Controlador TV para D-Pad / Mando Fire TV
  const tvController = {
    close: () => close(),
    onLeft: () => {
      const isFocusedInOsd = osd.contains(document.activeElement) && !osd.classList.contains('is-hidden');
      if (isFocusedInOsd) {
        const btns = [...osd.querySelectorAll('[data-focusable]')].filter(b => b.offsetParent);
        const idx = btns.indexOf(document.activeElement);
        if (idx > 0) {
          btns[idx - 1].focus();
          showOsd();
          return;
        }
      }
      video.currentTime = Math.max(0, (video.currentTime || 0) - skipSeconds);
      showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(video.currentTime)} / ${formatTime(video.duration)})`);
      showOsd();
    },
    onRight: () => {
      const isFocusedInOsd = osd.contains(document.activeElement) && !osd.classList.contains('is-hidden');
      if (isFocusedInOsd) {
        const btns = [...osd.querySelectorAll('[data-focusable]')].filter(b => b.offsetParent);
        const idx = btns.indexOf(document.activeElement);
        if (idx !== -1 && idx < btns.length - 1) {
          btns[idx + 1].focus();
          showOsd();
          return;
        }
      }
      video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + skipSeconds);
      showToast(playerEl, `⏩ +${skipSeconds}s (${formatTime(video.currentTime)} / ${formatTime(video.duration)})`);
      showOsd();
    },
    onUp: () => {
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
      } else {
        const cur = document.activeElement;
        if (cur?.id === 'pl-btn-playpause' || cur?.id === 'pl-btn-rw' || cur?.id === 'pl-btn-ff') {
          mount.querySelector('#pl-btn-back')?.focus();
        } else if (cur?.id === 'pl-btn-audio' || cur?.id === 'pl-btn-subs') {
          mount.querySelector('#pl-badge-toggle')?.focus();
        } else {
          mount.querySelector('#pl-btn-playpause')?.focus();
        }
        showOsd();
      }
    },
    onDown: () => {
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
      } else {
        const cur = document.activeElement;
        if (cur?.id === 'pl-btn-back' || cur?.id === 'pl-badge-toggle') {
          mount.querySelector('#pl-btn-playpause')?.focus();
          showOsd();
        } else {
          hideOsd();
        }
      }
    },
    onSelect: () => {
      if (osd.contains(document.activeElement) && !osd.classList.contains('is-hidden')) {
        document.activeElement.click();
        showOsd();
      } else {
        if (video.paused) { video.play(); showToast(playerEl, '▶ Reproduciendo'); }
        else { video.pause(); showToast(playerEl, '⏸ Pausa'); }
        showOsd();
      }
    },
  };

  registerPlayerController(tvController);

  try {
    const targetChannel = file?.channel || title?.channel;
    if (!targetChannel?.id || !targetChannel?.hash) throw new Error('Canal no encontrado para este archivo.');
    const peer = await peerOf(targetChannel);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (cancelled) return;
    if (!msg?.media?.document) throw new Error('Vídeo no encontrado en el canal.');

    const doc = msg.media.document;
    const size = Number(doc?.size?.toString?.() || doc?.size || file.size || 0);
    const mime = doc?.mimeType || file.mimeType || file.mime || 'video/mp4';
    if (size > 0 && await streamingAvailable()) {
      status.textContent = 'Abriendo túnel de streaming…';
      stream = openStream({ client, media: msg.media, size, mime, name: file.label || 'video' });
      if (cancelled) { stream.close(); return; }
      url = stream.url;
    } else {
      status.textContent = 'Descargando desde Telegram…';
      const buffer = await client.downloadMedia(msg.media, {
        progressCallback: (done, total) => {
          if (cancelled) return;
          const fullSize = Number(total) || size || 1;
          status.textContent = `Descargando: ${Math.round((Number(done) / fullSize) * 100)}%`;
        },
      });
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([buffer], { type: mime }));
    }

    video.src = url;

    let resumed = false;
    const applyResume = () => {
      if (resumed) return;
      if (resumeAt > 0 && video.duration && resumeAt < video.duration - 10) {
        video.currentTime = resumeAt;
      }
      resumed = true;
    };

    video.addEventListener('loadedmetadata', () => {
      applyResume();
      timeDur.textContent = formatTime(video.duration);
      if (video.webkitSupportsFullscreen && !document.fullscreenElement) {
        try { video.webkitEnterFullscreen(); } catch (_) {}
      }
    });

    video.addEventListener('canplay', () => {
      loading.style.display = 'none';
      video.play().catch(() => {});
    });

    let lastSaved = 0;
    let audioOnlyChecked = false;

    video.addEventListener('timeupdate', () => {
      timeCur.textContent = formatTime(video.currentTime);
      if (video.duration) {
        barFill.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
      }

      const now = Date.now();
      if (now - lastSaved > 8000 && video.duration) {
        lastSaved = now;
        saveProgress(profile.id, file.key, video.currentTime, video.duration);
        if (sync && profile?.id) {
          sync.schedulePush({ profile, progress: loadProgress(profile.id) });
        }
      }

      if (!audioOnlyChecked && video.currentTime > 2.2 && !video.paused) {
        audioOnlyChecked = true;
        if (video.videoWidth === 0 && codecNotice) {
          codecNotice.style.display = 'flex';
          showOsd();
        }
      }
    });

    video.addEventListener('ended', () => {
      if (video.duration) {
        saveProgress(profile.id, file.key, video.duration, video.duration);
        if (sync && profile?.id) {
          sync.pushProfile({ profile, progress: loadProgress(profile.id) }).catch(() => {});
        }
      }
    });

    video.addEventListener('error', () => {
      loading.style.display = 'flex';
      status.textContent = 'Error al reproducir el archivo. Prueba el otro reproductor o verifica los códecs.';
      if (codecNotice) codecNotice.style.display = 'flex';
    });

  } catch (error) {
    if (cancelled) return;
    status.textContent = error.message || 'Error al conectar con Telegram';
  }
}

// -------------------------------------------------------------
// REPRODUCTOR ARTPLAYER - Con OSD unificado y soporte TV
// -------------------------------------------------------------
async function playArtplayer({ client, peerOf, file, title, profile, resumeAt = 0, skipSeconds, onClose, mount, sync }) {
  const displayTitle = formatPlayerTitle(title, file);

  mount.innerHTML = `
    <div class="player player-art">
      <div class="player-tv-osd" id="pl-osd">
        <div class="player-osd-top">
          <button class="player-osd-btn" id="pl-btn-back" data-focusable>← Volver</button>
          <div class="player-osd-title">${escapeHtml(displayTitle)}</div>
          <button class="player-osd-btn player-osd-badge" id="pl-badge-toggle" title="Cambiar a Nativo" data-focusable>ArtPlayer ⇄</button>
        </div>
        <div class="player-osd-center">
          <button class="player-osd-btn" id="pl-btn-rw" data-focusable title="Atrasar">⏪ -${skipSeconds}s</button>
          <button class="player-osd-btn player-osd-btn-primary" id="pl-btn-playpause" data-focusable title="Reproducir/Pausar">⏯</button>
          <button class="player-osd-btn" id="pl-btn-ff" data-focusable title="Adelantar">+${skipSeconds}s ⏩</button>
          <button class="player-osd-btn" id="pl-btn-audio" data-focusable title="Cambiar audio">🔊 Audio</button>
          <button class="player-osd-btn" id="pl-btn-subs" data-focusable title="Cambiar subtítulos">💬 Subtítulos</button>
        </div>
        <div class="player-osd-bottom">
          <span class="player-osd-time" id="pl-time-cur">0:00</span>
          <div class="player-osd-bar-bg" id="pl-bar-bg">
            <div class="player-osd-bar-fill" id="pl-bar-fill"></div>
          </div>
          <span class="player-osd-time" id="pl-time-dur">0:00</span>
        </div>
      </div>
      <div class="player-osd-toast" id="pl-osd-toast"></div>
      <div class="player-codec-notice" id="pl-codec-notice" style="display:none;">
        <span>Safari no puede mostrar este formato de vídeo. Para iPhone, el archivo debe estar convertido a MP4 con vídeo H.264 y audio AAC.</span>
      </div>
      <div class="player-loading" id="pl-loading">
        <div class="loader"></div>
        <p id="pl-status">Conectando con Telegram…</p>
      </div>
      <div class="artplayer-host" id="artplayer-container"></div>
    </div>`;

  const playerEl = mount.querySelector('.player');
  const container = mount.querySelector('#artplayer-container');
  const loading = mount.querySelector('#pl-loading');
  const status = mount.querySelector('#pl-status');
  const osd = mount.querySelector('#pl-osd');
  const codecNotice = mount.querySelector('#pl-codec-notice');
  const timeCur = mount.querySelector('#pl-time-cur');
  const timeDur = mount.querySelector('#pl-time-dur');
  const barFill = mount.querySelector('#pl-bar-fill');
  const barBg = mount.querySelector('#pl-bar-bg');

  let cancelled = false;
  let stream = null;
  let url = null;
  let art = null;
  let cleanupSkip = null;
  let osdTimer = null;

  const showOsd = () => {
    osd.classList.remove('is-hidden');
    clearTimeout(osdTimer);
    if (art && !art.template.$video.paused) {
      osdTimer = setTimeout(() => {
        osd.classList.add('is-hidden');
        if (osd.contains(document.activeElement)) document.activeElement.blur();
      }, 4000);
    }
  };

  const hideOsd = () => {
    clearTimeout(osdTimer);
    osd.classList.add('is-hidden');
    if (osd.contains(document.activeElement)) document.activeElement.blur();
  };

  playerEl.addEventListener('mousemove', showOsd);
  playerEl.addEventListener('click', (e) => {
    if (!e.target.closest('.player-tv-osd, button')) {
      if (osd.classList.contains('is-hidden')) showOsd();
      else hideOsd();
    }
  });

  const goFullscreen = () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const req = playerEl.requestFullscreen || playerEl.webkitRequestFullscreen;
    if (req) {
      Promise.resolve(req.call(playerEl, { navigationUI: 'hide' }))
        .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
        .catch(() => {});
    }
  };

  const exitFullscreen = () => {
    try { screen.orientation?.unlock?.(); } catch (_) {}
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
  };

  goFullscreen();

  const close = () => {
    if (cancelled) return;
    cancelled = true;
    unregisterPlayerController();
    if (cleanupSkip) cleanupSkip();
    clearTimeout(osdTimer);
    exitFullscreen();
    if (art) {
      try {
        if (art.duration) {
          saveProgress(profile.id, file.key, art.currentTime, art.duration);
          if (sync && profile?.id) {
            sync.pushProfile({ profile, progress: loadProgress(profile.id) }).catch(() => {});
          }
        }
        art.destroy(false);
      } catch (_) {}
    }
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    onClose?.();
  };

  // Botones OSD
  mount.querySelector('#pl-btn-back').onclick = close;

  mount.querySelector('#pl-badge-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const curTime = art?.currentTime || resumeAt || 0;
    if (cancelled) return;
    cancelled = true;
    unregisterPlayerController();
    if (cleanupSkip) cleanupSkip();
    clearTimeout(osdTimer);
    exitFullscreen();
    if (art) {
      try {
        if (art.duration) {
          saveProgress(profile.id, file.key, art.currentTime, art.duration);
        }
        art.destroy(false);
      } catch (_) {}
    }
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    if (profile?.id) {
      localStorage.setItem(`tgvideo_player_${profile.id}`, 'native');
      profile.player = 'native';
    }
    playFile({ client, peerOf, file, title, profile, resumeAt: curTime, onClose, mount, sync });
  });

  mount.querySelector('#pl-btn-playpause').onclick = () => {
    if (art) {
      if (art.template.$video.paused) { art.play(); showToast(playerEl, '▶ Reproduciendo'); }
      else { art.pause(); showToast(playerEl, '⏸ Pausa'); }
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-rw').onclick = () => {
    if (art) {
      art.currentTime = Math.max(0, art.currentTime - skipSeconds);
      showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(art.currentTime)})`);
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-ff').onclick = () => {
    if (art) {
      art.currentTime = Math.min(art.duration || Infinity, art.currentTime + skipSeconds);
      showToast(playerEl, `+${skipSeconds}s ⏩ (${formatTime(art.currentTime)})`);
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-audio').onclick = () => {
    if (art?.template?.$video) {
      cycleAudio(art.template.$video, playerEl);
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-subs').onclick = () => {
    if (art?.template?.$video) {
      cycleSubtitles(art.template.$video, playerEl);
      showOsd();
    }
  };

  barBg.onclick = (e) => {
    const rect = barBg.getBoundingClientRect();
    if (rect.width && art?.duration) {
      const pos = (e.clientX - rect.left) / rect.width;
      art.currentTime = pos * art.duration;
      showOsd();
    }
  };

  // Controlador TV para D-Pad / Mando Fire TV
  const tvController = {
    close: () => close(),
    onLeft: () => {
      const isFocusedInOsd = osd.contains(document.activeElement) && !osd.classList.contains('is-hidden');
      if (isFocusedInOsd) {
        const btns = [...osd.querySelectorAll('[data-focusable]')].filter(b => b.offsetParent);
        const idx = btns.indexOf(document.activeElement);
        if (idx > 0) {
          btns[idx - 1].focus();
          showOsd();
          return;
        }
      }
      if (art) {
        art.currentTime = Math.max(0, art.currentTime - skipSeconds);
        showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(art.currentTime)} / ${formatTime(art.duration)})`);
        showOsd();
      }
    },
    onRight: () => {
      const isFocusedInOsd = osd.contains(document.activeElement) && !osd.classList.contains('is-hidden');
      if (isFocusedInOsd) {
        const btns = [...osd.querySelectorAll('[data-focusable]')].filter(b => b.offsetParent);
        const idx = btns.indexOf(document.activeElement);
        if (idx !== -1 && idx < btns.length - 1) {
          btns[idx + 1].focus();
          showOsd();
          return;
        }
      }
      if (art) {
        art.currentTime = Math.min(art.duration || Infinity, art.currentTime + skipSeconds);
        showToast(playerEl, `⏩ +${skipSeconds}s (${formatTime(art.currentTime)} / ${formatTime(art.duration)})`);
        showOsd();
      }
    },
    onUp: () => {
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
      } else {
        const cur = document.activeElement;
        if (cur?.id === 'pl-btn-playpause' || cur?.id === 'pl-btn-rw' || cur?.id === 'pl-btn-ff') {
          mount.querySelector('#pl-btn-back')?.focus();
        } else if (cur?.id === 'pl-btn-audio' || cur?.id === 'pl-btn-subs') {
          mount.querySelector('#pl-badge-toggle')?.focus();
        } else {
          mount.querySelector('#pl-btn-playpause')?.focus();
        }
        showOsd();
      }
    },
    onDown: () => {
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
      } else {
        const cur = document.activeElement;
        if (cur?.id === 'pl-btn-back' || cur?.id === 'pl-badge-toggle') {
          mount.querySelector('#pl-btn-playpause')?.focus();
          showOsd();
        } else {
          hideOsd();
        }
      }
    },
    onSelect: () => {
      if (osd.contains(document.activeElement) && !osd.classList.contains('is-hidden')) {
        document.activeElement.click();
        showOsd();
      } else {
        if (art) {
          if (art.template.$video.paused) { art.play(); showToast(playerEl, '▶ Reproduciendo'); }
          else { art.pause(); showToast(playerEl, '⏸ Pausa'); }
          showOsd();
        }
      }
    },
  };

  registerPlayerController(tvController);

  try {
    const targetChannel = file?.channel || title?.channel;
    if (!targetChannel?.id || !targetChannel?.hash) throw new Error('Canal no encontrado para este archivo.');
    const peer = await peerOf(targetChannel);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (cancelled) return;
    if (!msg?.media?.document) throw new Error('Vídeo no encontrado en el canal.');

    const doc = msg.media.document;
    const size = Number(doc?.size?.toString?.() || doc?.size || file.size || 0);
    const mime = doc?.mimeType || file.mimeType || file.mime || 'video/mp4';
    if (size > 0 && await streamingAvailable()) {
      status.textContent = 'Abriendo túnel de streaming…';
      stream = openStream({ client, media: msg.media, size, mime, name: file.label || 'video' });
      if (cancelled) { stream.close(); return; }
      url = stream.url;
    } else {
      status.textContent = 'Descargando desde Telegram…';
      const buffer = await client.downloadMedia(msg.media, {
        progressCallback: (done, total) => {
          if (cancelled) return;
          const fullSize = Number(total) || size || 1;
          status.textContent = `Descargando: ${Math.round((Number(done) / fullSize) * 100)}%`;
        },
      });
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([buffer], { type: mime }));
    }

    if (cancelled) return;

    art = new Artplayer({
      container,
      url,
      title: displayTitle,
      autoplay: true,
      playsInline: true,
      theme: '#e50914',
      lang: 'es',
      volume: 0.85,
      autoSize: false,
      autoMini: false,
      mutex: true,
      hotkey: false, // Controlado por el OSD TV nativo
      playbackRate: true,
      aspectRatio: true,
      fullscreen: false,
      fullscreenWeb: false,
      pip: true,
      setting: true,
      screenshot: false,
      lock: true,
      fastForward: true,
      autoOrientation: true,
      autoPlayback: false,
      airplay: true,
      gesture: true,
      backdrop: true,
      moreVideoAttr: {
        'playsinline': true,
        'webkit-playsinline': true,
        'x5-video-player-type': 'h5',
      },
    });

    const video = art.template.$video;
    let lastSaved = 0;
    let audioOnlyChecked = false;

    cleanupSkip = setupDoubleTapSkip({ container: art.template.$player, video, skipSeconds });

    art.on('ready', () => {
      loading.style.display = 'none';
      if (resumeAt > 0) {
        art.currentTime = resumeAt;
      }
      if (video.duration) {
        timeDur.textContent = formatTime(video.duration);
      }
    });

    art.on('video:loadedmetadata', () => {
      timeDur.textContent = formatTime(video.duration);
    });

    art.on('video:play', () => {
      clearTimeout(osdTimer);
      osdTimer = setTimeout(() => {
        osd.classList.add('is-hidden');
        if (osd.contains(document.activeElement)) document.activeElement.blur();
      }, 2800);
    });

    art.on('video:pause', () => {
      clearTimeout(osdTimer);
      osd.classList.remove('is-hidden');
      if (sync && profile?.id && art?.duration) {
        const progress = saveProgress(profile.id, file.key, art.currentTime, art.duration);
        sync.schedulePush({ profile, progress });
      }
    });

    art.on('video:timeupdate', () => {
      timeCur.textContent = formatTime(art.currentTime);
      if (art.duration) {
        barFill.style.width = `${Math.min(100, (art.currentTime / art.duration) * 100)}%`;
      }

      const now = Date.now();
      if (now - lastSaved > 8000 && art.duration) {
        lastSaved = now;
        saveProgress(profile.id, file.key, art.currentTime, art.duration);
        if (sync && profile?.id) {
          sync.schedulePush({ profile, progress: loadProgress(profile.id) });
        }
      }

      if (!audioOnlyChecked && video.currentTime > 2.2 && !video.paused) {
        audioOnlyChecked = true;
        if (video.videoWidth === 0 && codecNotice) {
          codecNotice.style.display = 'flex';
          showOsd();
        }
      }
    });

    art.on('video:ended', () => {
      if (art.duration) {
        saveProgress(profile.id, file.key, art.duration, art.duration);
        if (sync && profile?.id) {
          sync.pushProfile({ profile, progress: loadProgress(profile.id) }).catch(() => {});
        }
      }
    });

    art.on('video:error', () => {
      loading.style.display = 'flex';
      status.textContent = 'Error al reproducir el archivo. Prueba el otro reproductor o verifica los códecs.';
      if (codecNotice) codecNotice.style.display = 'flex';
    });

  } catch (error) {
    if (cancelled) return;
    status.textContent = error.message || 'Error al conectar con Telegram';
  }
}
