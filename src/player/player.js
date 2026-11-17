// src/player/player.js
// Reproductor TGVideo: Estilo Stremio con OSD inferior, controles TV D-Pad, pistas y soporte de motor
import Artplayer from 'artplayer';
import { saveProgress, loadProgress } from './progress.js';
import { streamingAvailable, openStream } from './stream.js';
import { extractTitleAndYear } from '../metadata/tmdb.js';
import { prettyEpisodeName } from '../library/parse.js';
import { registerPlayerController, unregisterPlayerController } from '../ui/dpad.js';
import { detectTracksFromUrl, langName } from './trackParser.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}[char]));

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
  const langName_ = LANG_NAMES[langKey] || langName(langKey) || "";
  const label = track.label ? String(track.label).trim() : "";

  if (label && langName_ && !label.toLowerCase().includes(langName_.toLowerCase())) {
    return `${label} (${langName_})`;
  }
  return label || langName_ || `${fallbackPrefix} ${i + 1}`;
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
  return [];
}

function getTextTracks(video) {
  if (!video) return [];
  try {
    if (video.textTracks && video.textTracks.length > 0) {
      return Array.from(video.textTracks).filter(t => {
        const k = String(t.kind || '').toLowerCase();
        return k === 'subtitles' || k === 'captions' || k === '';
      });
    }
  } catch (_) {}
  return [];
}

/** Espera corta a las APIs nativas (Safari). Devuelve lo que haya. */
function waitForTracks(video, { timeoutMs = 800 } = {}) {
  return new Promise((resolve) => {
    if (!video) return resolve({ audio: [], text: [] });
    const done = () => resolve({ audio: getAudioTracks(video), text: getTextTracks(video) });
    const hasAny = () => getAudioTracks(video).length > 0 || getTextTracks(video).length > 0;
    if (hasAny()) return done();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { video.audioTracks?.removeEventListener?.('addtrack', onAdd); } catch (_) {}
      try { video.textTracks?.removeEventListener?.('addtrack', onAdd); } catch (_) {}
      clearTimeout(timer);
      clearInterval(poll);
      done();
    };
    const onAdd = () => { if (hasAny()) finish(); };

    try { video.audioTracks?.addEventListener?.('addtrack', onAdd); } catch (_) {}
    try { video.textTracks?.addEventListener?.('addtrack', onAdd); } catch (_) {}

    const poll = setInterval(() => { if (hasAny()) finish(); }, 200);
    const timer = setTimeout(finish, timeoutMs);
  });
}

/**
 * Detección cacheada por vídeo. Primera vez: nativo (800ms) + parser de contenedor.
 * Siguientes veces: instantáneo.
 */
const TRACKS_BY_VIDEO = new WeakMap();
function ensureTracksDetected(video) {
  if (!video) return Promise.resolve({ audio: [], text: [] });
  if (TRACKS_BY_VIDEO.has(video)) return TRACKS_BY_VIDEO.get(video);

  const promise = (async () => {
    const native = await waitForTracks(video, { timeoutMs: 800 });
    const result = { audio: native.audio.slice(), text: native.text.slice() };

    const src = video.currentSrc || video.src;
    if ((result.audio.length === 0 || result.text.length === 0) && src) {
      try {
        const parsed = await detectTracksFromUrl(src);
        if (!result.audio.length) result.audio = parsed.audio;
        if (!result.text.length) result.text = parsed.text;
      } catch (_) {}
    }
    return result;
  })();

  TRACKS_BY_VIDEO.set(video, promise);
  return promise;
}

async function openAudioSelector(video, playerEl, returnFocusEl) {
  playerEl.querySelector(".player-tracks-overlay")?.remove();

  const tracksData = await ensureTracksDetected(video);
  const rawTracks = tracksData.audio;

  const overlay = document.createElement("div");
  overlay.className = "player-tracks-overlay";
  overlay.id = "pl-tracks-modal";

  let listHtml = "";
  if (rawTracks.length === 0) {
    listHtml = `
      <div class="player-track-empty">Pista de audio estándar en reproducción</div>
      <button class="player-track-option is-selected" data-focusable data-index="0" data-native="false">
        <span>Audio principal (predeterminado)</span>
        <span class="player-track-check">✓</span>
      </button>
    `;
  } else {
    listHtml = rawTracks.map((track, i) => {
      const isNative = track.native !== false && typeof track.enabled === 'boolean';
      const isSelected = isNative ? !!track.enabled : i === 0;
      const label = isNative
        ? formatTrackName(track, i, "Pista de audio")
        : (track.label || langName(track.language) || `Pista de audio ${i + 1}`);
      return `
        <button class="player-track-option ${isSelected ? "is-selected" : ""}" data-focusable data-index="${i}" data-native="${isNative}">
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
      const idx = Number(btn.getAttribute("data-index"));
      const track = rawTracks[idx];

      if (track && track.native === false) {
        showToast(playerEl, "Esta pista no se puede cambiar en este dispositivo. Prueba en Safari/iOS.");
        closeMenu();
        return;
      }

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

async function openSubtitlesSelector(video, playerEl, returnFocusEl) {
  playerEl.querySelector(".player-tracks-overlay")?.remove();

  const tracksData = await ensureTracksDetected(video);
  let rawTracks = tracksData.text;

  try {
    for (const t of Array.from(video.textTracks || [])) {
      if (t.mode === 'disabled') t.mode = 'hidden';
    }
  } catch (_) {}

  const isNoneSelected = rawTracks.every(t => t.mode !== "showing");

  const overlay = document.createElement("div");
  overlay.className = "player-tracks-overlay";
  overlay.id = "pl-tracks-modal";

  let listHtml = `
    <button class="player-track-option ${isNoneSelected ? "is-selected" : ""}" data-focusable data-index="-1" data-native="true">
      <span>Desactivados</span>
      ${isNoneSelected ? '<span class="player-track-check">✓</span>' : ""}
    </button>
  `;

  if (rawTracks.length === 0) {
    listHtml += `<div class="player-track-empty">No se detectaron pistas de subtítulos incrustadas</div>`;
  } else {
    listHtml += rawTracks.map((track, i) => {
      const isNative = track.native !== false && typeof track.mode === 'string';
      const isSelected = isNative && track.mode === "showing";
      const label = isNative
        ? formatTrackName(track, i, "Subtítulo")
        : (track.label || langName(track.language) || `Subtítulo ${i + 1}`);
      return `
        <button class="player-track-option ${isSelected ? "is-selected" : ""}" data-focusable data-index="${i}" data-native="${isNative}">
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
      const idx = Number(btn.getAttribute("data-index"));
      if (btn.dataset.native === "false" && idx >= 0) {
        showToast(playerEl, "Esta pista no se puede mostrar en este dispositivo. Prueba en Safari/iOS.");
        closeMenu();
        return;
      }
      rawTracks.forEach((t, i) => {
        if (typeof t.mode === 'string') t.mode = (i === idx) ? "showing" : "disabled";
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

export async function playFile({ client, peerOf, file, title, profile, resumeAt = 0, onClose, mount, sync, nextFile = null, onNext = null }) {
  const localPref = typeof localStorage !== 'undefined' && profile?.id
    ? localStorage.getItem(`tgvideo_player_${profile.id}`)
    : null;
  const playerType = profile?.player || localPref || 'artplayer';

  const localSkip = typeof localStorage !== 'undefined' && profile?.id
    ? localStorage.getItem(`tgvideo_skip_${profile.id}`)
    : null;
  const skipSeconds = Number(profile?.skip_seconds || localSkip || 10);

  const opts = { client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount, sync, nextFile, onNext };
  if (playerType === 'native') {
    return playNative(opts);
  }
  return playArtplayer(opts);
}

function formatNextLabel(title, nextFile) {
  if (!nextFile) return '';
  if (title?.tipo === 'serie') {
    const epNum = (nextFile.season || nextFile.episode)
      ? `T${nextFile.season || 1}·E${String(nextFile.episode || 1).padStart(2, '0')}`
      : '';
    const epName = nextFile.metadata?.name || prettyEpisodeName(nextFile.fileName || nextFile.label, title.metadata?.name || title.nombre);
    return `${epNum ? epNum + ' · ' : ''}${epName}`;
  }
  return nextFile.metadata?.name || nextFile.sagaName || nextFile.label || 'Siguiente';
}

/** Cuenta atrás del siguiente episodio. Posicionado abajo-derecha vía CSS (.player-next-up). */
function bindNextUp({ getTime, getDuration, playerEl, nextFile, title, onNext, onCancel }) {
  if (!nextFile || typeof onNext !== 'function') return () => {};
  const COUNT = 12;
  const windowSec = 25;
  let shown = false;
  let done = false;
  let tickTimer = null;
  let el = null;

  const remove = () => {
    clearInterval(tickTimer);
    el?.remove();
    el = null;
    shown = false;
  };

  const startCountdown = () => {
    if (done || shown) return;
    shown = true;
    el = document.createElement('div');
    el.className = 'player-next-up';
    el.innerHTML = `
      <div class="player-next-up-inner">
        <div class="player-next-up-label">Siguiente en <span class="player-next-up-count">${COUNT}</span>s</div>
        <div class="player-next-up-title">${formatNextLabel(title, nextFile).replace(/</g,'&lt;')}</div>
        <button type="button" class="player-next-up-cancel" data-focusable>Cancelar</button>
      </div>
    `;
    playerEl.appendChild(el);
    let left = COUNT;
    const countEl = el.querySelector('.player-next-up-count');
    el.querySelector('.player-next-up-cancel')?.addEventListener('click', (e) => {
      e.stopPropagation();
      done = true;
      remove();
      onCancel?.();
    });
    tickTimer = setInterval(() => {
      left -= 1;
      if (countEl) countEl.textContent = String(Math.max(0, left));
      if (left <= 0) {
        clearInterval(tickTimer);
        done = true;
        remove();
        onNext(nextFile);
      }
    }, 1000);
  };

  const check = () => {
    if (done) return;
    const dur = Number(getDuration()) || 0;
    const cur = Number(getTime()) || 0;
    if (dur > 30 && cur >= dur - windowSec) startCountdown();
  };

  return { check, remove };
}

// -------------------------------------------------------------
// REPRODUCTOR NATIVO (HTML5 / WebView) - Con OSD Stremio
// -------------------------------------------------------------
async function playNative({ client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount, sync, nextFile = null, onNext = null }) {
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

  const nextUp = bindNextUp({
    getTime: () => video?.currentTime || 0,
    getDuration: () => video?.duration || 0,
    playerEl,
    nextFile,
    title,
    onNext: (nf) => {
      cancelled = true;
      try { video.pause(); } catch (_) {}
      try { nextUp.remove(); } catch (_) {}
      onNext?.(nf);
    },
  });

  const updatePlayIcons = () => {
    if (video.paused) {
      if (iconPlay) iconPlay.style.display = 'block';
      if (iconPause) iconPause.style.display = 'none';
    } else {
      if (iconPlay) iconPlay.style.display = 'none';
      if (iconPause) iconPause.style.display = 'block';
    }
  };

  const OSD_TIMEOUT_MS = 3500;

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
  playerEl.addEventListener('touchend', (e) => {
    if (e.target.closest('.player-osd-bottom, .player-osd-top, .player-tracks-overlay, .player-next-up, button')) return;
    e.preventDefault();
    showOsd();
  }, { passive: false });
  playerEl.addEventListener('click', (e) => {
    if (e.target.closest('.player-osd-bottom, .player-osd-top, .player-tracks-overlay, .player-next-up, button')) return;
    if (osd.classList.contains('is-hidden')) showOsd();
    else hideOsd();
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
    playFile({ client, peerOf, file, title, profile, resumeAt: curTime, onClose, mount, sync, nextFile, onNext });
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
    const audios = getAudio