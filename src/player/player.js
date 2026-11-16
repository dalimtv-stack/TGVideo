// src/player/player.js
// Reproductor TGVideo: Estilo Stremio con OSD inferior, controles TV D-Pad, pistas y soporte de motor
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
 * Formatea un título limpio sin duplicaciones de nombre o año.
 */
export function formatPlayerTitle(title, file) {
  if (!title) return file?.label || 'Reproduciendo';

  const rawName = title.metadata?.name || title.metadata?.title || title.nombre || '';
  const parsed = extractTitleAndYear(rawName);
  const cleanTitle = parsed.title || rawName;
  const year = title.metadata?.date?.slice(0, 4) || parsed.year || '';
  const yearSuffix = year ? ` (${year})` : '';

  if (title.tipo === 'serie') {
    const epNum = (file?.season || file?.episode)
      ? `T${file.season || 1}·E${String(file.episode || 1).padStart(2, '0')}`
      : '';
    const epName = file?.metadata?.name || prettyEpisodeName(file?.fileName || file?.label, cleanTitle);
    return `${cleanTitle} · ${epNum ? epNum + ' - ' : ''}${epName}`;
  }

  if (title.isSaga) {
    return file?.metadata?.name || file?.sagaName || file?.label || cleanTitle;
  }

  // Película estándar: solo título normalizado de TMDB y año entre paréntesis
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
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

const LANG_NAMES = {
  es: "Español", spa: "Español", "es-es": "Español (España)", "es-419": "Español (Latino)",
  lat: "Latino", en: "Inglés", eng: "Inglés", fr: "Francés", fra: "Francés", fre: "Francés",
  de: "Alemán", deu: "Alemán", ger: "Alemán", it: "Italiano", ita: "Italiano",
  pt: "Portugués", por: "Portugués", ja: "Japonés", jpn: "Japonés",
  ru: "Ruso", rus: "Ruso", zh: "Chino", zho: "Chino", chi: "Chino",
  ko: "Coreano", kor: "Coreano", ca: "Catalán", cat: "Catalán", gl: "Gallego",
  eu: "Euskera", eus: "Euskera", und: "Indeterminado"
};

function formatTrackName(track, i, fallbackPrefix) {
  const langKey = String(track.language || "").toLowerCase().trim();
  const langName = LANG_NAMES[langKey] || "";
  const label = track.label ? String(track.label).trim() : "";

  if (label && langName && !label.toLowerCase().includes(langName.toLowerCase())) {
    return `${label} (${langName})`;
  }
  return label || langName || `${fallbackPrefix} ${i + 1}`;
}

function getAudioTracks(video) {
  if (!video) return [];
  try {
    if (video.audioTracks && video.audioTracks.length > 0) {
      return Array.from(video.audioTracks);
    }
  } catch (_) {}
  try {
    if (video.webkitAudioTracks && video.webkitAudioTracks.length > 0) {
      return Array.from(video.webkitAudioTracks);
    }
  } catch (_) {}
  // ArtPlayer / algunos motores exponen pistas en el propio player
  try {
    if (video._artplayer?.audioTracks?.length) {
      return Array.from(video._artplayer.audioTracks);
    }
  } catch (_) {}
  return [];
}

function getTextTracks(video) {
  if (!video) return [];
  try {
    if (video.textTracks && video.textTracks.length > 0) {
      return Array.from(video.textTracks).filter(t => t.kind !== "chapters" && t.kind !== "metadata");
    }
  } catch (_) {}
  return [];
}

function openAudioSelector(video, playerEl, returnFocusEl) {
  playerEl.querySelector(".player-tracks-overlay")?.remove();

  const rawTracks = getAudioTracks(video);
  const overlay = document.createElement("div");
  overlay.className = "player-tracks-overlay";
  overlay.id = "pl-tracks-modal";

  let listHtml = "";
  if (rawTracks.length === 0) {
    listHtml = `
      <div class="player-track-empty">Pista de audio estándar en reproducción</div>
      <button class="player-track-option is-selected" data-focusable data-index="0">
        <span>Audio principal (predeterminado)</span>
        <span class="player-track-check">✓</span>
      </button>
      ${video?.webkitSupportsFullscreen ? `
        <button class="player-track-option" data-focusable data-action="ios-fs" style="margin-top:0.5rem;border:1px solid rgba(229,9,20,0.6);background:rgba(229,9,20,0.15);">
          <span>📺 Abrir pantalla completa iOS (menú nativo de audios)</span>
        </button>
      ` : ""}
    `;
  } else {
    listHtml = rawTracks.map((track, i) => {
      const isSelected = !!track.enabled;
      const label = formatTrackName(track, i, "Pista de audio");
      return `
        <button class="player-track-option ${isSelected ? "is-selected" : ""}" data-focusable data-index="${i}">
          <span>${escapeHtml(label)}</span>
          ${isSelected ? '<span class="player-track-check">✓</span>' : ""}
        </button>
      `;
    }).join("");
  }

  overlay.innerHTML = `
    <div class="player-tracks-menu" role="dialog" aria-label="Seleccionar audio">
      <div class="player-tracks-title">
        <span>🔊 Pistas de Audio</span>
        <button class="player-tracks-close" data-focusable aria-label="Cerrar">✕</button>
      </div>
      <div class="player-tracks-list">
        ${listHtml}
      </div>
    </div>
  `;

  playerEl.appendChild(overlay);

  const closeMenu = () => {
    overlay.remove();
    returnFocusEl?.focus();
  };

  overlay.querySelector(".player-tracks-close")?.addEventListener("click", closeMenu);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeMenu();
  });

  const buttons = overlay.querySelectorAll(".player-track-option");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "ios-fs") {
        try { video.webkitEnterFullscreen(); } catch (err) { console.warn(err); }
        closeMenu();
        return;
      }
      const idx = Number(btn.getAttribute("data-index"));
      if (rawTracks.length > 0 && rawTracks[idx]) {
        rawTracks.forEach((t, i) => { t.enabled = (i === idx); });
        const label = formatTrackName(rawTracks[idx], idx, "Pista");
        showToast(playerEl, `✓ Audio: ${label}`);
      } else {
        showToast(playerEl, "Audio: Principal");
      }
      closeMenu();
    });
  });

  overlay.addEventListener("keydown", (e) => {
    const isBackKey = ["Escape", "GoBack", "Back"].includes(e.key) || e.keyCode === 4 ||
      (e.key === "Backspace" && !["INPUT", "TEXTAREA"].includes(e.target.tagName));
    if (isBackKey) {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (["ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const opts = [...overlay.querySelectorAll(".player-track-option, .player-tracks-close")].filter(el => el.offsetParent && !el.disabled);
      const idx = opts.indexOf(document.activeElement);
      const delta = e.key === "ArrowUp" ? -1 : 1;
      const next = opts[Math.max(0, Math.min(opts.length - 1, idx + delta))];
      next?.focus();
    }
  });

  const activeBtn = overlay.querySelector(".player-track-option.is-selected") || buttons[0] || overlay.querySelector(".player-tracks-close");
  activeBtn?.focus();
}

function openSubtitlesSelector(video, playerEl, returnFocusEl) {
  playerEl.querySelector(".player-tracks-overlay")?.remove();

  const rawTracks = getTextTracks(video);
  const isNoneSelected = rawTracks.every(t => t.mode !== "showing");

  const overlay = document.createElement("div");
  overlay.className = "player-tracks-overlay";
  overlay.id = "pl-tracks-modal";

  let listHtml = `
    <button class="player-track-option ${isNoneSelected ? "is-selected" : ""}" data-focusable data-index="-1">
      <span>Desactivados</span>
      ${isNoneSelected ? '<span class="player-track-check">✓</span>' : ""}
    </button>
  `;

  if (rawTracks.length === 0) {
    listHtml += `
      <div class="player-track-empty">No se detectaron pistas de subtítulos incrustadas</div>
      ${video?.webkitSupportsFullscreen ? `
        <button class="player-track-option" data-focusable data-action="ios-fs" style="margin-top:0.5rem;border:1px solid rgba(229,9,20,0.6);background:rgba(229,9,20,0.15);">
          <span>📺 Abrir pantalla completa iOS (menú nativo de subtítulos)</span>
        </button>
      ` : ""}
    `;
  } else {
    listHtml += rawTracks.map((track, i) => {
      const isSelected = track.mode === "showing";
      const label = formatTrackName(track, i, "Subtítulo");
      return `
        <button class="player-track-option ${isSelected ? "is-selected" : ""}" data-focusable data-index="${i}">
          <span>${escapeHtml(label)}</span>
          ${isSelected ? '<span class="player-track-check">✓</span>' : ""}
        </button>
      `;
    }).join("");
  }

  overlay.innerHTML = `
    <div class="player-tracks-menu" role="dialog" aria-label="Seleccionar subtítulos">
      <div class="player-tracks-title">
        <span>💬 Subtítulos</span>
        <button class="player-tracks-close" data-focusable aria-label="Cerrar">✕</button>
      </div>
      <div class="player-tracks-list">
        ${listHtml}
      </div>
    </div>
  `;

  playerEl.appendChild(overlay);

  const closeMenu = () => {
    overlay.remove();
    returnFocusEl?.focus();
  };

  overlay.querySelector(".player-tracks-close")?.addEventListener("click", closeMenu);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeMenu();
  });

  const buttons = overlay.querySelectorAll(".player-track-option");
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      if (btn.dataset.action === "ios-fs") {
        try { video.webkitEnterFullscreen(); } catch (err) { console.warn(err); }
        closeMenu();
        return;
      }
      const idx = Number(btn.getAttribute("data-index"));
      rawTracks.forEach((t, i) => {
        t.mode = (i === idx) ? "showing" : "disabled";
      });
      if (idx === -1) {
        showToast(playerEl, "Subtítulos desactivados");
      } else if (rawTracks[idx]) {
        const label = formatTrackName(rawTracks[idx], idx, "Subtítulo");
        showToast(playerEl, `✓ Subtítulos: ${label}`);
      }
      closeMenu();
    });
  });

  overlay.addEventListener("keydown", (e) => {
    const isBackKey = ["Escape", "GoBack", "Back"].includes(e.key) || e.keyCode === 4 ||
      (e.key === "Backspace" && !["INPUT", "TEXTAREA"].includes(e.target.tagName));
    if (isBackKey) {
      e.preventDefault();
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (["ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      const opts = [...overlay.querySelectorAll(".player-track-option, .player-tracks-close")].filter(el => el.offsetParent && !el.disabled);
      const idx = opts.indexOf(document.activeElement);
      const delta = e.key === "ArrowUp" ? -1 : 1;
      const next = opts[Math.max(0, Math.min(opts.length - 1, idx + delta))];
      next?.focus();
    }
  });

  const activeBtn = overlay.querySelector(".player-track-option.is-selected") || buttons[0] || overlay.querySelector(".player-tracks-close");
  activeBtn?.focus();
}


function setupDoubleTapSkip({ container, video, skipSeconds = 10 }) {
  if (!container || !video) return () => {};

  const onDblClick = (e) => {
    if (e.target.closest('.player-tv-osd, button, input')) return;
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
    if (e.target.closest('.player-tv-osd, button, input')) return;
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
// REPRODUCTOR NATIVO (HTML5 / WebView) - Con OSD Stremio
// -------------------------------------------------------------
async function playNative({ client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount, sync }) {
  const displayTitle = formatPlayerTitle(title, file);

  mount.innerHTML = `
    <div class="player player-native">
      <div class="player-tv-osd" id="pl-osd">
        <div class="player-osd-top">
          <button class="player-osd-back-btn" id="pl-btn-back" data-focusable title="Volver">←</button>
          <div class="player-osd-title">${escapeHtml(displayTitle)}</div>
          <button class="player-osd-badge" id="pl-badge-toggle" title="Cambiar a ArtPlayer" data-focusable>Nativo ⇄</button>
        </div>

        <div class="player-osd-bottom">
          <div class="player-timeline-row">
            <span class="player-osd-time" id="pl-time-cur">0:00</span>
            <div class="player-scrubber-track" id="pl-scrubber" tabindex="0" data-focusable role="slider" aria-label="Línea de tiempo">
              <div class="player-scrubber-fill" id="pl-scrubber-fill">
                <div class="player-scrubber-thumb"></div>
              </div>
            </div>
            <span class="player-osd-time" id="pl-time-dur">0:00</span>
          </div>

          <div class="player-controls-row">
            <button class="player-ctrl-btn" id="pl-btn-rw" data-focusable title="Atrasar 10s">
              <svg viewBox="0 0 24 24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
            </button>
            <button class="player-ctrl-btn player-ctrl-btn-primary" id="pl-btn-playpause" data-focusable title="Reproducir/Pausar">
              <svg id="pl-icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <svg id="pl-icon-pause" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-ff" data-focusable title="Adelantar 10s">
              <svg viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-audio" data-focusable title="Pistas de Audio">
              <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-subs" data-focusable title="Subtítulos">
              <svg viewBox="0 0 24 24"><path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>
            </button>
</div>
        </div>
      </div>

      <div class="player-osd-toast" id="pl-osd-toast"></div>
      <div class="player-codec-notice" id="pl-codec-notice" style="display:none;">
        <span>Safari no puede mostrar este formato. En iPhone requiere MP4 con H.264 y AAC.</span>
      </div>
      <div class="player-loading" id="pl-loading">
        <div class="loader"></div>
        <p id="pl-status">Conectando con Telegram…</p>
      </div>
      <video class="native-video" playsinline webkit-playsinline crossorigin="anonymous" autoplay preload="auto"></video>
    </div>`;

  const playerEl = mount.querySelector('.player');
  const video = mount.querySelector('video');
  const loading = mount.querySelector('#pl-loading');
  const status = mount.querySelector('#pl-status');
  const osd = mount.querySelector('#pl-osd');
  const codecNotice = mount.querySelector('#pl-codec-notice');
  const timeCur = mount.querySelector('#pl-time-cur');
  const timeDur = mount.querySelector('#pl-time-dur');
  const scrubber = mount.querySelector('#pl-scrubber');
  const scrubberFill = mount.querySelector('#pl-scrubber-fill');
  const iconPlay = mount.querySelector('#pl-icon-play');
  const iconPause = mount.querySelector('#pl-icon-pause');

  let cancelled = false;
  let stream = null;
  let url = null;
  let osdTimer = null;

  const updatePlayIcons = () => {
    if (video.paused) {
      if (iconPlay) iconPlay.style.display = 'block';
      if (iconPause) iconPause.style.display = 'none';
    } else {
      if (iconPlay) iconPlay.style.display = 'none';
      if (iconPause) iconPause.style.display = 'block';
    }
  };

  const OSD_TIMEOUT_MS = 1500;

  const showOsd = () => {
    osd.classList.remove('is-hidden');
    clearTimeout(osdTimer);
    if (!video.paused) {
      osdTimer = setTimeout(() => {
        osd.classList.add('is-hidden');
        if (osd.contains(document.activeElement)) document.activeElement.blur();
      }, OSD_TIMEOUT_MS);
    }
  };

  const hideOsd = () => {
    clearTimeout(osdTimer);
    osd.classList.add('is-hidden');
    if (osd.contains(document.activeElement)) document.activeElement.blur();
  };

  playerEl.addEventListener('mousemove', showOsd);
  playerEl.addEventListener('keydown', showOsd, true);
  playerEl.addEventListener('click', (e) => {
    if (!e.target.closest('.player-osd-bottom, .player-osd-top, button')) {
      if (osd.classList.contains('is-hidden')) showOsd();
      else hideOsd();
    }
  });

  video.addEventListener('play', () => {
    updatePlayIcons();
    showOsd();
  });

  video.addEventListener('pause', () => {
    updatePlayIcons();
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

  // Botón Volver
  mount.querySelector('#pl-btn-back').onclick = close;

  // Botón Alternar motor Nativo / ArtPlayer
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
    showToast(playerEl, `⏪ -${skipSeconds}s`);
    showOsd();
  };

  mount.querySelector('#pl-btn-ff').onclick = () => {
    video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + skipSeconds);
    showToast(playerEl, `+${skipSeconds}s ⏩`);
    showOsd();
  };

  mount.querySelector('#pl-btn-audio').onclick = () => {
    openAudioSelector(video, playerEl, mount.querySelector('#pl-btn-audio'));
    showOsd();
  };

  mount.querySelector('#pl-btn-subs').onclick = () => {
    openSubtitlesSelector(video, playerEl, mount.querySelector('#pl-btn-subs'));
    showOsd();
  };


  const updateNativeTrackLabels = () => {
    const audios = getAudioTracks(video);
    const subs = getTextTracks(video);
    const btnAudio = mount.querySelector('#pl-btn-audio');
    const btnSubs = mount.querySelector('#pl-btn-subs');
    if (btnAudio) btnAudio.title = audios.length > 1 ? `Pistas de Audio (${audios.length})` : 'Pistas de Audio';
    if (btnSubs) btnSubs.title = subs.length > 0 ? `Subtítulos (${subs.length})` : 'Subtítulos';
  };
  video.addEventListener('loadedmetadata', updateNativeTrackLabels);
  video.addEventListener('canplay', updateNativeTrackLabels);
  if (video.textTracks) {
    video.textTracks.addEventListener('addtrack', updateNativeTrackLabels);
    video.textTracks.addEventListener('removetrack', updateNativeTrackLabels);
    video.textTracks.addEventListener('change', updateNativeTrackLabels);
  }
  if (video.audioTracks) {
    video.audioTracks.addEventListener('addtrack', updateNativeTrackLabels);
    video.audioTracks.addEventListener('removetrack', updateNativeTrackLabels);
    video.audioTracks.addEventListener('change', updateNativeTrackLabels);
  }


  scrubber.onclick = (e) => {
    const rect = scrubber.getBoundingClientRect();
    if (rect.width && video.duration) {
      const pos = (e.clientX - rect.left) / rect.width;
      video.currentTime = pos * video.duration;
      showOsd();
    }
  };

  let pendingSeekTime = null;
  let seekDebounceTimer = null;

  const applyPendingSeek = () => {
    if (pendingSeekTime !== null) {
      const target = pendingSeekTime;
      pendingSeekTime = null;
      video.currentTime = target;
    }
  };

  const stepScrubber = (delta) => {
    const dur = video.duration || 0;
    if (!dur) return;
    const current = pendingSeekTime !== null ? pendingSeekTime : (video.currentTime || 0);
    const target = Math.max(0, Math.min(dur, current + delta));
    pendingSeekTime = target;

    timeCur.textContent = formatTime(target);
    scrubberFill.style.width = `${Math.min(100, (target / dur) * 100)}%`;
    showToast(playerEl, `⏱ ${formatTime(target)}`);
    showOsd();

    clearTimeout(seekDebounceTimer);
    seekDebounceTimer = setTimeout(() => {
      applyPendingSeek();
    }, 1000);
  };

  scrubber.addEventListener('focus', () => scrubber.classList.add('dpad-focused'));
  scrubber.addEventListener('blur', () => {
    scrubber.classList.remove('dpad-focused');
    if (pendingSeekTime !== null) {
      clearTimeout(seekDebounceTimer);
      applyPendingSeek();
    }
  });

  const handleTracksOverlayDpad = (action) => {
    const overlay = playerEl.querySelector('.player-tracks-overlay');
    if (!overlay) return false;

    if (action === 'close') {
      overlay.remove();
      mount.querySelector('#pl-btn-audio')?.focus();
      return true;
    }

    const focusables = [...overlay.querySelectorAll('[data-focusable]')];
    if (focusables.length === 0) return true;

    const curIdx = focusables.indexOf(document.activeElement);

    if (action === 'up') {
      const nextIdx = curIdx > 0 ? curIdx - 1 : focusables.length - 1;
      focusables[nextIdx].focus();
      return true;
    }

    if (action === 'down') {
      const nextIdx = (curIdx !== -1 && curIdx < focusables.length - 1) ? curIdx + 1 : 0;
      focusables[nextIdx].focus();
      return true;
    }

    if (action === 'select') {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        document.activeElement.click();
      }
      return true;
    }

    if (action === 'left' || action === 'right') {
      return true;
    }

    return true;
  };

  // Controlador TV para D-Pad / Mando Fire TV
  const tvController = {
    close: () => {
      if (handleTracksOverlayDpad('close')) return;
      close();
    },
    onLeft: () => {
      if (handleTracksOverlayDpad('left')) return;
      if (osd.classList.contains('is-hidden')) {
        video.currentTime = Math.max(0, (video.currentTime || 0) - skipSeconds);
        showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(video.currentTime)})`);
        return;
      }

      if (document.activeElement?.id === 'pl-badge-toggle') {
        mount.querySelector('#pl-btn-back')?.focus();
        showOsd();
        return;
      }
      if (document.activeElement?.id === 'pl-btn-back') {
        showOsd();
        return;
      }

      const isBtn = document.activeElement?.classList.contains('player-ctrl-btn');
      if (isBtn) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')];
        const idx = btns.indexOf(document.activeElement);
        if (idx > 0) {
          btns[idx - 1].focus();
        }
        showOsd();
        return;
      }

      if (document.activeElement === scrubber) {
        stepScrubber(-skipSeconds);
        return;
      }

      video.currentTime = Math.max(0, (video.currentTime || 0) - skipSeconds);
      showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(video.currentTime)})`);
      showOsd();
    },
    onRight: () => {
      if (handleTracksOverlayDpad('right')) return;
      if (osd.classList.contains('is-hidden')) {
        video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + skipSeconds);
        showToast(playerEl, `⏩ +${skipSeconds}s (${formatTime(video.currentTime)})`);
        return;
      }

      if (document.activeElement?.id === 'pl-btn-back') {
        mount.querySelector('#pl-badge-toggle')?.focus();
        showOsd();
        return;
      }
      if (document.activeElement?.id === 'pl-badge-toggle') {
        showOsd();
        return;
      }

      const isBtn = document.activeElement?.classList.contains('player-ctrl-btn');
      if (isBtn) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')];
        const idx = btns.indexOf(document.activeElement);
        if (idx !== -1 && idx < btns.length - 1) {
          btns[idx + 1].focus();
        }
        showOsd();
        return;
      }

      if (document.activeElement === scrubber) {
        stepScrubber(skipSeconds);
        return;
      }

      video.currentTime = Math.min(video.duration || Infinity, (video.currentTime || 0) + skipSeconds);
      showToast(playerEl, `⏩ +${skipSeconds}s (${formatTime(video.currentTime)})`);
      showOsd();
    },
    onUp: () => {
      if (handleTracksOverlayDpad('up')) return;
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-back')?.focus();
        return;
      }

      const cur = document.activeElement;
      if (cur?.classList.contains('player-ctrl-btn')) {
        scrubber.focus();
      } else if (cur === scrubber) {
        mount.querySelector('#pl-btn-back')?.focus();
      } else {
        mount.querySelector('#pl-btn-back')?.focus();
      }
      showOsd();
    },
    onDown: () => {
      if (handleTracksOverlayDpad('down')) return;
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        scrubber.focus();
        return;
      }

      const cur = document.activeElement;
      if (cur?.id === 'pl-btn-back' || cur?.id === 'pl-badge-toggle') {
        scrubber.focus();
      } else if (cur === scrubber) {
        mount.querySelector('#pl-btn-playpause')?.focus();
      } else if (cur?.classList.contains('player-ctrl-btn')) {
        showOsd();
      } else {
        scrubber.focus();
      }
    },
    onSelect: () => {
      if (handleTracksOverlayDpad('select')) return;
      if (osd.classList.contains('is-hidden')) {
        if (video.paused) { video.play(); showToast(playerEl, '▶ Reproduciendo'); }
        else { video.pause(); showToast(playerEl, '⏸ Pausa'); }
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
        return;
      }

      if (document.activeElement === scrubber) {
        if (pendingSeekTime !== null) {
          clearTimeout(seekDebounceTimer);
          applyPendingSeek();
        }
        if (video.paused) video.play(); else video.pause();
        showOsd();
        return;
      }

      if (osd.contains(document.activeElement)) {
        document.activeElement.click();
        showOsd();
      } else {
        if (video.paused) { video.play(); showToast(playerEl, '▶ Reproduciendo'); }
        else { video.pause(); showToast(playerEl, '⏸ Pausa'); }
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
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
      if (pendingSeekTime !== null) return;
      timeCur.textContent = formatTime(video.currentTime);
      if (video.duration) {
        scrubberFill.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
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
// REPRODUCTOR ARTPLAYER - Con OSD Stremio unificado
// -------------------------------------------------------------
async function playArtplayer({ client, peerOf, file, title, profile, resumeAt = 0, skipSeconds, onClose, mount, sync }) {
  const displayTitle = formatPlayerTitle(title, file);

  mount.innerHTML = `
    <div class="player player-art">
      <div class="player-tv-osd" id="pl-osd">
        <div class="player-osd-top">
          <button class="player-osd-back-btn" id="pl-btn-back" data-focusable title="Volver">←</button>
          <div class="player-osd-title">${escapeHtml(displayTitle)}</div>
          <button class="player-osd-badge" id="pl-badge-toggle" title="Cambiar a Nativo" data-focusable>ArtPlayer ⇄</button>
        </div>

        <div class="player-osd-bottom">
          <div class="player-timeline-row">
            <span class="player-osd-time" id="pl-time-cur">0:00</span>
            <div class="player-scrubber-track" id="pl-scrubber" tabindex="0" data-focusable role="slider" aria-label="Línea de tiempo">
              <div class="player-scrubber-fill" id="pl-scrubber-fill">
                <div class="player-scrubber-thumb"></div>
              </div>
            </div>
            <span class="player-osd-time" id="pl-time-dur">0:00</span>
          </div>

          <div class="player-controls-row">
            <button class="player-ctrl-btn" id="pl-btn-rw" data-focusable title="Atrasar 10s">
              <svg viewBox="0 0 24 24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
            </button>
            <button class="player-ctrl-btn player-ctrl-btn-primary" id="pl-btn-playpause" data-focusable title="Reproducir/Pausar">
              <svg id="pl-icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <svg id="pl-icon-pause" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-ff" data-focusable title="Adelantar 10s">
              <svg viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-audio" data-focusable title="Pistas de Audio">
              <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-subs" data-focusable title="Subtítulos">
              <svg viewBox="0 0 24 24"><path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>
            </button>
</div>
        </div>
      </div>

      <div class="player-osd-toast" id="pl-osd-toast"></div>
      <div class="player-codec-notice" id="pl-codec-notice" style="display:none;">
        <span>Safari no puede mostrar este formato. En iPhone requiere MP4 con H.264 y AAC.</span>
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
  const scrubber = mount.querySelector('#pl-scrubber');
  const scrubberFill = mount.querySelector('#pl-scrubber-fill');
  const iconPlay = mount.querySelector('#pl-icon-play');
  const iconPause = mount.querySelector('#pl-icon-pause');

  let cancelled = false;
  let stream = null;
  let url = null;
  let art = null;
  let cleanupSkip = null;
  let osdTimer = null;

  const updatePlayIcons = () => {
    if (art?.template?.$video?.paused) {
      if (iconPlay) iconPlay.style.display = 'block';
      if (iconPause) iconPause.style.display = 'none';
    } else {
      if (iconPlay) iconPlay.style.display = 'none';
      if (iconPause) iconPause.style.display = 'block';
    }
  };

  const OSD_TIMEOUT_MS = 1500;

  const showOsd = () => {
    osd.classList.remove('is-hidden');
    clearTimeout(osdTimer);
    if (art && !art.template.$video.paused) {
      osdTimer = setTimeout(() => {
        osd.classList.add('is-hidden');
        if (osd.contains(document.activeElement)) document.activeElement.blur();
      }, OSD_TIMEOUT_MS);
    }
  };

  const hideOsd = () => {
    clearTimeout(osdTimer);
    osd.classList.add('is-hidden');
    if (osd.contains(document.activeElement)) document.activeElement.blur();
  };

  playerEl.addEventListener('mousemove', showOsd);
  playerEl.addEventListener('keydown', showOsd, true);
  playerEl.addEventListener('click', (e) => {
    if (!e.target.closest('.player-osd-bottom, .player-osd-top, button')) {
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

  // Botón Volver
  mount.querySelector('#pl-btn-back').onclick = close;

  // Botón Alternar motor Nativo / ArtPlayer
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
      showToast(playerEl, `⏪ -${skipSeconds}s`);
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-ff').onclick = () => {
    if (art) {
      art.currentTime = Math.min(art.duration || Infinity, art.currentTime + skipSeconds);
      showToast(playerEl, `+${skipSeconds}s ⏩`);
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-audio').onclick = () => {
    const vid = art?.template?.$video;
    if (vid) {
      openAudioSelector(vid, playerEl, mount.querySelector('#pl-btn-audio'));
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-subs').onclick = () => {
    const vid = art?.template?.$video;
    if (vid) {
      openSubtitlesSelector(vid, playerEl, mount.querySelector('#pl-btn-subs'));
      showOsd();
    }
  };



  scrubber.onclick = (e) => {
    const rect = scrubber.getBoundingClientRect();
    if (rect.width && art?.duration) {
      const pos = (e.clientX - rect.left) / rect.width;
      art.currentTime = pos * art.duration;
      showOsd();
    }
  };

  let pendingSeekTime = null;
  let seekDebounceTimer = null;

  const applyPendingSeek = () => {
    if (pendingSeekTime !== null && art) {
      const target = pendingSeekTime;
      pendingSeekTime = null;
      art.currentTime = target;
    }
  };

  const stepScrubber = (delta) => {
    const dur = art?.duration || 0;
    if (!dur) return;
    const current = pendingSeekTime !== null ? pendingSeekTime : (art?.currentTime || 0);
    const target = Math.max(0, Math.min(dur, current + delta));
    pendingSeekTime = target;

    timeCur.textContent = formatTime(target);
    scrubberFill.style.width = `${Math.min(100, (target / dur) * 100)}%`;
    showToast(playerEl, `⏱ ${formatTime(target)}`);
    showOsd();

    clearTimeout(seekDebounceTimer);
    seekDebounceTimer = setTimeout(() => {
      applyPendingSeek();
    }, 1000);
  };

  scrubber.addEventListener('focus', () => scrubber.classList.add('dpad-focused'));
  scrubber.addEventListener('blur', () => {
    scrubber.classList.remove('dpad-focused');
    if (pendingSeekTime !== null) {
      clearTimeout(seekDebounceTimer);
      applyPendingSeek();
    }
  });

  const handleTracksOverlayDpad = (action) => {
    const overlay = playerEl.querySelector('.player-tracks-overlay');
    if (!overlay) return false;

    if (action === 'close') {
      overlay.remove();
      mount.querySelector('#pl-btn-audio')?.focus();
      return true;
    }

    const focusables = [...overlay.querySelectorAll('[data-focusable]')];
    if (focusables.length === 0) return true;

    const curIdx = focusables.indexOf(document.activeElement);

    if (action === 'up') {
      const nextIdx = curIdx > 0 ? curIdx - 1 : focusables.length - 1;
      focusables[nextIdx].focus();
      return true;
    }

    if (action === 'down') {
      const nextIdx = (curIdx !== -1 && curIdx < focusables.length - 1) ? curIdx + 1 : 0;
      focusables[nextIdx].focus();
      return true;
    }

    if (action === 'select') {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        document.activeElement.click();
      }
      return true;
    }

    if (action === 'left' || action === 'right') {
      return true;
    }

    return true;
  };

  // Controlador TV para D-Pad / Mando Fire TV
  const tvController = {
    close: () => {
      if (handleTracksOverlayDpad('close')) return;
      close();
    },
    onLeft: () => {
      if (handleTracksOverlayDpad('left')) return;
      if (osd.classList.contains('is-hidden')) {
        if (art) {
          art.currentTime = Math.max(0, art.currentTime - skipSeconds);
          showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(art.currentTime)})`);
        }
        return;
      }

      if (document.activeElement?.id === 'pl-badge-toggle') {
        mount.querySelector('#pl-btn-back')?.focus();
        showOsd();
        return;
      }
      if (document.activeElement?.id === 'pl-btn-back') {
        showOsd();
        return;
      }

      const isBtn = document.activeElement?.classList.contains('player-ctrl-btn');
      if (isBtn) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')];
        const idx = btns.indexOf(document.activeElement);
        if (idx > 0) {
          btns[idx - 1].focus();
        }
        showOsd();
        return;
      }

      if (document.activeElement === scrubber && art) {
        stepScrubber(-skipSeconds);
        return;
      }

      if (art) {
        art.currentTime = Math.max(0, art.currentTime - skipSeconds);
        showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(art.currentTime)})`);
        showOsd();
      }
    },
    onRight: () => {
      if (handleTracksOverlayDpad('right')) return;
      if (osd.classList.contains('is-hidden')) {
        if (art) {
          art.currentTime = Math.min(art.duration || Infinity, art.currentTime + skipSeconds);
          showToast(playerEl, `⏩ +${skipSeconds}s (${formatTime(art.currentTime)})`);
        }
        return;
      }

      if (document.activeElement?.id === 'pl-btn-back') {
        mount.querySelector('#pl-badge-toggle')?.focus();
        showOsd();
        return;
      }
      if (document.activeElement?.id === 'pl-badge-toggle') {
        showOsd();
        return;
      }

      const isBtn = document.activeElement?.classList.contains('player-ctrl-btn');
      if (isBtn) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')];
        const idx = btns.indexOf(document.activeElement);
        if (idx !== -1 && idx < btns.length - 1) {
          btns[idx + 1].focus();
        }
        showOsd();
        return;
      }

      if (document.activeElement === scrubber && art) {
        stepScrubber(skipSeconds);
        return;
      }

      if (art) {
        art.currentTime = Math.min(art.duration || Infinity, art.currentTime + skipSeconds);
        showToast(playerEl, `⏩ +${skipSeconds}s (${formatTime(art.currentTime)})`);
        showOsd();
      }
    },
    onUp: () => {
      if (handleTracksOverlayDpad('up')) return;
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-back')?.focus();
        return;
      }

      const cur = document.activeElement;
      if (cur?.classList.contains('player-ctrl-btn')) {
        scrubber.focus();
      } else if (cur === scrubber) {
        mount.querySelector('#pl-btn-back')?.focus();
      } else {
        mount.querySelector('#pl-btn-back')?.focus();
      }
      showOsd();
    },
    onDown: () => {
      if (handleTracksOverlayDpad('down')) return;
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        scrubber.focus();
        return;
      }

      const cur = document.activeElement;
      if (cur?.id === 'pl-btn-back' || cur?.id === 'pl-badge-toggle') {
        scrubber.focus();
      } else if (cur === scrubber) {
        mount.querySelector('#pl-btn-playpause')?.focus();
      } else if (cur?.classList.contains('player-ctrl-btn')) {
        showOsd();
      } else {
        scrubber.focus();
      }
    },
    onSelect: () => {
      if (handleTracksOverlayDpad('select')) return;
      if (osd.classList.contains('is-hidden')) {
        if (art) {
          if (art.template.$video.paused) { art.play(); showToast(playerEl, '▶ Reproduciendo'); }
          else { art.pause(); showToast(playerEl, '⏸ Pausa'); }
          showOsd();
          mount.querySelector('#pl-btn-playpause')?.focus();
        }
        return;
      }

      if (document.activeElement === scrubber) {
        if (pendingSeekTime !== null) {
          clearTimeout(seekDebounceTimer);
          applyPendingSeek();
        }
        if (art) {
          if (art.template.$video.paused) art.play(); else art.pause();
          showOsd();
        }
        return;
      }

      if (osd.contains(document.activeElement)) {
        document.activeElement.click();
        showOsd();
      } else if (art) {
        if (art.template.$video.paused) { art.play(); showToast(playerEl, '▶ Reproduciendo'); }
        else { art.pause(); showToast(playerEl, '⏸ Pausa'); }
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
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

    if (video.webkitSupportsFullscreen) {
      art.controls.add({
        name: 'iosNativeFs',
        position: 'right',
        index: 68,
        html: '<span class="art-ios-btn" title="Pantalla completa nativa de iOS (para pistas de audio y subtítulos)">iOS</span>',
        tooltip: 'Pantalla completa iOS (Audios/Subs)',
        click() {
          try { video.webkitEnterFullscreen(); } catch (err) { console.warn(err); }
        }
      });
    }

    const checkTracks = () => {
      if (video.audioTracks && video.audioTracks.length > 1) {
        try {
          if (!art.setting.find('audioTracks')) {
            art.setting.add({
              name: 'audioTracks',
              width: 220,
              html: 'Pista de audio',
              tooltip: 'Audio',
              selector: Array.from(video.audioTracks).map((track, i) => ({
                default: track.enabled,
                html: formatTrackName(track, i, "Audio"),
                value: i,
              })),
              onSelect(item) {
                const idx = Number(item.value);
                Array.from(video.audioTracks).forEach((t, i) => {
                  t.enabled = (i === idx);
                });
                return item.html;
              },
            });
          }
        } catch (_) {}
      }

      if (video.textTracks && video.textTracks.length > 0) {
        try {
          if (!art.setting.find('nativeSubtitles')) {
            const tracks = getTextTracks(video);
            if (tracks.length > 0) {
              art.setting.add({
                name: 'nativeSubtitles',
                width: 220,
                html: 'Subtítulos',
                tooltip: 'Subtítulos',
                selector: [
                  { default: tracks.every(t => t.mode !== 'showing'), html: 'Desactivados', value: -1 },
                  ...tracks.map((track, i) => ({
                    default: track.mode === 'showing',
                    html: formatTrackName(track, i, "Subtítulo"),
                    value: i,
                  }))
                ],
                onSelect(item) {
                  const idx = Number(item.value);
                  tracks.forEach((t, i) => {
                    t.mode = (i === idx) ? 'showing' : 'disabled';
                  });
                  return item.html;
                },
              });
            }
          }
        } catch (_) {}
      }
    };

    art.on('ready', () => {
      loading.style.display = 'none';
      if (resumeAt > 0) {
        art.currentTime = resumeAt;
      }
      if (video.duration) {
        timeDur.textContent = formatTime(video.duration);
      }
      checkTracks();
    });

    art.on('video:loadedmetadata', () => {
      timeDur.textContent = formatTime(video.duration);
      checkTracks();
    });

    art.on('video:canplay', checkTracks);
    if (video.textTracks) {
      video.textTracks.addEventListener('addtrack', checkTracks);
    }
    if (video.audioTracks) {
      video.audioTracks.addEventListener('addtrack', checkTracks);
    }

    art.on('video:play', () => {
      updatePlayIcons();
      showOsd();
    });

    art.on('video:pause', () => {
      updatePlayIcons();
      clearTimeout(osdTimer);
      osd.classList.remove('is-hidden');
      if (sync && profile?.id && art?.duration) {
        const progress = saveProgress(profile.id, file.key, art.currentTime, art.duration);
        sync.schedulePush({ profile, progress });
      }
    });

    art.on('video:timeupdate', () => {
      if (pendingSeekTime !== null) return;
      timeCur.textContent = formatTime(art.currentTime);
      if (art.duration) {
        scrubberFill.style.width = `${Math.min(100, (art.currentTime / art.duration) * 100)}%`;
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
