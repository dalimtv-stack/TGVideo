// src/player/tracks.js
// Detección y gestión de pistas de audio y subtítulos (nativas y parseadas desde cabecera)
import { detectTracksFromUrl, langName } from './trackParser.js';
import { escapeHtml, showToast } from './ui-helpers.js';

export const LANG_NAMES = {
  es: "Español", spa: "Español", "es-es": "Español (España)", "es-419": "Español (Latino)",
  lat: "Latino", en: "Inglés", eng: "Inglés", fr: "Francés", fra: "Francés", fre: "Francés",
  de: "Alemán", deu: "Alemán", ger: "Alemán", it: "Italiano", ita: "Italiano",
  pt: "Portugués", por: "Portugués", ja: "Japonés", jpn: "Japonés",
  ru: "Ruso", rus: "Ruso", zh: "Chino", zho: "Chino", chi: "Chino",
  ko: "Coreano", kor: "Coreano", ca: "Catalán", cat: "Catalán", gl: "Gallego",
  eu: "Euskera", eus: "Euskera", und: "Indeterminado"
};

export function formatTrackName(track, i, fallbackPrefix) {
  const langKey = String(track.language || "").toLowerCase().trim();
  const langName_ = LANG_NAMES[langKey] || langName(langKey) || "";
  const label = track.label ? String(track.label).trim() : "";

  if (label && langName_ && !label.toLowerCase().includes(langName_.toLowerCase())) {
    return `${label} (${langName_})`;
  }
  return label || langName_ || `${fallbackPrefix} ${i + 1}`;
}

export function getAudioTracks(video) {
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

export function getTextTracks(video) {
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

export function waitForTracks(video, { timeoutMs = 800 } = {}) {
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

const TRACKS_BY_VIDEO = new WeakMap();

export function ensureTracksDetected(video) {
  if (!video) return Promise.resolve({ audio: [], text: [] });
  if (TRACKS_BY_VIDEO.has(video)) return TRACKS_BY_VIDEO.get(video);

  const promise = (async () => {
    const native = await waitForTracks(video, { timeoutMs: 800 });
    let audio = native.audio.slice();
    let text = native.text.slice();

    const src = video.currentSrc || video.src;
    if (src) {
      try {
        const parsed = await detectTracksFromUrl(src);
        if (parsed.audio && (parsed.audio.length > audio.length || audio.length === 0)) {
          audio = parsed.audio;
        }
        if (parsed.text && (parsed.text.length > text.length || text.length === 0)) {
          text = parsed.text;
        }
      } catch (e) {
        console.warn('[player] Error al detectar pistas:', e);
      }
    }
    return { audio, text };
  })();

  TRACKS_BY_VIDEO.set(video, promise);
  return promise;
}

export async function openAudioSelector(video, playerEl, returnFocusEl) {
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
        showToast(playerEl, "Esta pista no se puede cambiar en este dispositivo.");
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

export async function openSubtitlesSelector(video, playerEl, returnFocusEl) {
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
        showToast(playerEl, "Esta pista no se puede mostrar en este dispositivo.");
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
