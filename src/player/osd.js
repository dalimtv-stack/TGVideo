// src/player/osd.js
// Interfaz de Usuario OSD (Estilo Stremio) unificada y modular
// Gestiona controles, D-Pad, teclado, temporizador 1.5s, pistas y diálogo de siguiente episodio.
import { registerPlayerController, unregisterPlayerController } from '../ui/dpad.js';
import { formatTrackName } from './engine.js';

export function formatTime(secs) {
  if (!secs || isNaN(secs) || secs < 0) return '0:00';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function showToast(container, text) {
  let toast = container.querySelector('#pl-osd-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pl-osd-toast';
    toast.className = 'player-osd-toast';
    container.appendChild(toast);
  }
  toast.textContent = text;
  toast.classList.add('is-visible');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('is-visible'), 1600);
}

export function createPlayerOSD({
  mount,
  titleText,
  engine,
  onClose,
  onSwitchPlayer,
  playerModeLabel = 'ArtPlayer',
  nextFile = null,
  onNext = null,
}) {
  const skipSeconds = 10;
  let osdTimer = null;
  let pendingSeekTime = null;
  let seekCommitTimer = null;

  mount.innerHTML = `
    <div class="player player-stremio-unified">
      <div class="player-video-mount" id="player-video-mount"></div>
      <div class="player-osd" id="player-osd">
        <div class="player-osd-top">
          <button class="player-osd-btn player-osd-btn-back" id="pl-btn-back" title="Volver (Atrás / Esc)" data-focusable>
            <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg>
          </button>
          <div class="player-osd-title" id="pl-title">${titleText}</div>
          <div class="player-osd-top-actions">
            <button class="player-osd-btn" id="pl-btn-audio" title="Pistas de Audio" data-focusable>
              <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
            </button>
            <button class="player-osd-btn" id="pl-btn-subs" title="Subtítulos" data-focusable>
              <svg viewBox="0 0 24 24" width="22" height="22"><path fill="currentColor" d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-9 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>
            </button>
            <button class="player-osd-badge" id="pl-badge-toggle" title="Cambiar motor">${playerModeLabel}</button>
          </div>
        </div>

        <div class="player-osd-center">
          <button class="player-osd-play-badge" id="pl-center-play" title="Reproducir / Pausa">
            <svg id="pl-center-icon-play" viewBox="0 0 24 24" width="44" height="44"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
            <svg id="pl-center-icon-pause" viewBox="0 0 24 24" width="44" height="44" style="display:none"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          </button>
        </div>

        <div class="player-osd-bottom">
          <div class="player-scrubber-container" id="pl-scrubber-box">
            <div class="player-scrubber-track">
              <div class="player-scrubber-fill" id="pl-scrubber-fill"></div>
              <div class="player-scrubber-thumb" id="pl-scrubber-thumb"></div>
            </div>
          </div>
          <div class="player-osd-row">
            <div class="player-osd-controls-left">
              <button class="player-osd-btn" id="pl-btn-playpause" title="Pausa (Espacio)" data-focusable>
                <svg id="pl-icon-play" viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="M8 5v14l11-7z"/></svg>
                <svg id="pl-icon-pause" viewBox="0 0 24 24" width="26" height="26" style="display:none"><path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              </button>
              <button class="player-osd-btn" id="pl-btn-rw" title="Retroceder 10s (Izquierda)" data-focusable>
                <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/><text x="12" y="15" font-size="8" fill="currentColor" text-anchor="middle" font-weight="bold">10</text></svg>
              </button>
              <button class="player-osd-btn" id="pl-btn-ff" title="Avanzar 10s (Derecha)" data-focusable>
                <svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z"/><text x="12" y="15" font-size="8" fill="currentColor" text-anchor="middle" font-weight="bold">10</text></svg>
              </button>
              <div class="player-time-display">
                <span id="pl-time-cur">0:00</span> / <span id="pl-time-dur">0:00</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="player-loading" id="pl-loading">
        <div class="spinner"></div>
        <p id="pl-status">Conectando...</p>
      </div>

      <div class="player-osd-toast" id="pl-osd-toast"></div>
    </div>`;

  const playerEl = mount.querySelector('.player');
  const osd = mount.querySelector('#player-osd');
  const timeCur = mount.querySelector('#pl-time-cur');
  const timeDur = mount.querySelector('#pl-time-dur');
  const scrubberFill = mount.querySelector('#pl-scrubber-fill');
  const scrubberThumb = mount.querySelector('#pl-scrubber-thumb');
  const iconPlay = mount.querySelector('#pl-icon-play');
  const iconPause = mount.querySelector('#pl-icon-pause');
  const centerPlay = mount.querySelector('#pl-center-play');
  const centerIconPlay = mount.querySelector('#pl-center-icon-play');
  const centerIconPause = mount.querySelector('#pl-center-icon-pause');
  const loading = mount.querySelector('#pl-loading');
  const status = mount.querySelector('#pl-status');

  function showOsd() {
    osd.classList.remove('is-hidden');
    clearTimeout(osdTimer);
    osdTimer = setTimeout(() => {
      if (!engine.paused) osd.classList.add('is-hidden');
    }, 1500); // 1.5s exactamente según especificación del usuario
  }

  function updatePlayIcons() {
    const isPaused = engine.paused;
    iconPlay.style.display = isPaused ? 'block' : 'none';
    iconPause.style.display = isPaused ? 'none' : 'block';
    centerIconPlay.style.display = isPaused ? 'block' : 'none';
    centerIconPause.style.display = isPaused ? 'none' : 'block';
  }

  function updateProgressUI(currentTime, duration) {
    if (pendingSeekTime !== null) return;
    timeCur.textContent = formatTime(currentTime);
    if (duration > 0) {
      timeDur.textContent = formatTime(duration);
      const pct = Math.min(100, Math.max(0, (currentTime / duration) * 100));
      scrubberFill.style.width = `${pct}%`;
      if (scrubberThumb) scrubberThumb.style.left = `${pct}%`;
    }
  }

  // Click & Touch listeners
  mount.querySelector('#pl-btn-back').onclick = onClose;
  mount.querySelector('#pl-badge-toggle').onclick = onSwitchPlayer;

  const togglePlay = () => {
    if (engine.paused) {
      engine.play();
      showToast(playerEl, '▶ Reproduciendo');
    } else {
      engine.pause();
      showToast(playerEl, '⏸ Pausa');
    }
    updatePlayIcons();
    showOsd();
  };

  mount.querySelector('#pl-btn-playpause').onclick = togglePlay;
  centerPlay.onclick = togglePlay;

  mount.querySelector('#pl-btn-rw').onclick = () => {
    engine.currentTime = Math.max(0, engine.currentTime - skipSeconds);
    showToast(playerEl, `⏪ -${skipSeconds}s`);
    showOsd();
  };

  mount.querySelector('#pl-btn-ff').onclick = () => {
    engine.currentTime = Math.min(engine.duration || 999999, engine.currentTime + skipSeconds);
    showToast(playerEl, `⏩ +${skipSeconds}s`);
    showOsd();
  };

  // Selector de Pistas de Audio
  mount.querySelector('#pl-btn-audio').onclick = () => {
    const tracks = engine.tracks?.audio || [];
    if (!tracks.length) {
      showToast(playerEl, 'No hay pistas de audio disponibles');
      return;
    }
    showTrackModal('Pistas de Audio', tracks, (idx) => {
      const res = engine.setAudioTrack(idx);
      if (res.success) {
        showToast(playerEl, `✓ Audio: ${res.label || `Pista ${idx + 1}`}`);
      } else {
        showToast(playerEl, res.message || 'No se pudo cambiar el audio en este dispositivo');
      }
    });
  };

  // Selector de Subtítulos
  mount.querySelector('#pl-btn-subs').onclick = () => {
    const tracks = engine.tracks?.text || [];
    const options = [{ label: 'Desactivados', mode: 'disabled' }, ...tracks];
    showTrackModal('Subtítulos', options, (idx) => {
      const targetIdx = idx - 1; // 0 es desactivados -> -1
      const res = engine.setSubtitleTrack(targetIdx);
      if (res.success) {
        showToast(playerEl, targetIdx === -1 ? 'Subtítulos desactivados' : `✓ Subtítulos: ${res.label || `Pista ${idx}`}`);
      } else {
        showToast(playerEl, res.message || 'No se pueden mostrar subtítulos en este dispositivo');
      }
    });
  };

  function showTrackModal(title, items, onSelect) {
    const existing = mount.querySelector('.player-tracks-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'player-tracks-modal';
    modal.innerHTML = `
      <div class="player-tracks-dialog">
        <div class="player-tracks-header">
          <h3>${title}</h3>
          <button class="player-tracks-close" data-focusable>&times;</button>
        </div>
        <div class="player-tracks-list">
          ${items.map((item, idx) => `
            <button class="player-track-option" data-focusable data-index="${idx}">
              ${item.label || item.language || formatTrackName(item, idx, 'Pista')}
            </button>`).join('')}
        </div>
      </div>`;

    mount.appendChild(modal);
    const closeBtn = modal.querySelector('.player-tracks-close');
    closeBtn.onclick = () => modal.remove();

    modal.querySelectorAll('.player-track-option').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.dataset.index);
        onSelect(idx);
        modal.remove();
        showOsd();
      };
    });

    const firstOpt = modal.querySelector('.player-track-option');
    firstOpt?.focus();
  }

  // D-Pad y TV Controller
  const tvController = {
    handleKey(e) {
      showOsd();
      if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.keyCode === 27 || e.keyCode === 8 || e.keyCode === 10009 || e.keyCode === 461) {
        const modal = mount.querySelector('.player-tracks-modal');
        if (modal) { modal.remove(); return true; }
        onClose();
        return true;
      }
      if (e.key === ' ' || e.key === 'Enter' || e.keyCode === 13 || e.keyCode === 32) {
        if (!document.activeElement || document.activeElement === document.body || document.activeElement === playerEl) {
          togglePlay();
          return true;
        }
      }
      if (e.key === 'ArrowLeft' || e.keyCode === 37) {
        engine.currentTime = Math.max(0, engine.currentTime - skipSeconds);
        showToast(playerEl, `⏪ -${skipSeconds}s`);
        return true;
      }
      if (e.key === 'ArrowRight' || e.keyCode === 39) {
        engine.currentTime = Math.min(engine.duration || 999999, engine.currentTime + skipSeconds);
        showToast(playerEl, `⏩ +${skipSeconds}s`);
        return true;
      }
      return false;
    }
  };

  registerPlayerController(tvController);

  // Movimiento del ratón o toque activa OSD
  playerEl.addEventListener('mousemove', showOsd);
  playerEl.addEventListener('touchstart', showOsd, { passive: true });

  return {
    getVideoMount() { return mount.querySelector('#player-video-mount'); },
    showOsd,
    setLoading(visible, text = '') {
      loading.style.display = visible ? 'flex' : 'none';
      if (text) status.textContent = text;
    },
    updatePlayIcons,
    updateProgressUI,
    destroy() {
      unregisterPlayerController();
      clearTimeout(osdTimer);
      clearTimeout(seekCommitTimer);
    }
  };
}
