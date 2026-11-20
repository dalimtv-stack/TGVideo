// src/player/ui-helpers.js
// Helpers de UI del reproductor: formateo, toasts, saltos doble-tap y siguiente episodio
import { prettyEpisodeName } from '../library/parse.js';

export const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));

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
  toast.classList.add('show');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

export function setupDoubleTapSkip({ container, video, skipSeconds = 10 }) {
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

export function formatNextLabel(title, nextFile) {
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

export function bindNextUp({ getTime, getDuration, playerEl, nextFile, title, onNext, onCancel }) {
  if (!nextFile || typeof onNext !== 'function') return { check: () => {}, remove: () => {} };
  const COUNT = 10;
  const isSerie = title?.tipo === 'serie';
  // Para series: 45 segundos antes del final. Para sagas de películas: 5 minutos (300 segundos) antes.
  const windowSec = isSerie ? 45 : 300;
  let shown = false;
  let done = false;
  let tickTimer = null;
  let autoDismissTimer = null;
  let el = null;

  const triggerNext = () => {
    done = true;
    remove();
    onNext(nextFile);
  };

  const cancel = () => {
    done = true;
    remove();
    onCancel?.();
  };

  const remove = () => {
    clearInterval(tickTimer);
    clearTimeout(autoDismissTimer);
    document.removeEventListener('keydown', onKey, true);
    el?.remove();
    el = null;
    shown = false;
  };

  const onKey = (e) => {
    if (!el) return;
    const isBack = e.key === 'Escape' || e.key === 'Back' || e.key === 'GoBack' || e.keyCode === 4;
    if (isBack) {
      e.preventDefault();
      e.stopImmediatePropagation();
      cancel();
      return;
    }

    // Permitir navegación con flechas directa dentro del diálogo saga
    if (!isSerie) {
      const playBtn = el.querySelector('.player-next-up-play');
      const cancelBtn = el.querySelector('.player-next-up-cancel');
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        if (cancelBtn && document.activeElement !== cancelBtn) {
          e.preventDefault();
          e.stopPropagation();
          cancelBtn.focus();
          return;
        }
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        if (playBtn && document.activeElement !== playBtn) {
          e.preventDefault();
          e.stopPropagation();
          playBtn.focus();
          return;
        }
      }
    }

    const ok = e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;
    if (!ok) return;

    // Si el foco está sobre uno de los botones del diálogo, dejamos que el evento click del botón actúe
    const active = document.activeElement;
    if (active && el.contains(active)) {
      return;
    }

    // Fallback si ningún botón del diálogo tiene el foco directo
    e.preventDefault();
    e.stopImmediatePropagation();
    if (!isSerie) {
      triggerNext();
    } else {
      cancel();
    }
  };

  const startCountdown = () => {
    if (done || shown) return;
    shown = true;
    el = document.createElement('div');
    el.className = 'player-next-up';

    if (isSerie) {
      el.innerHTML = `
        <div class="player-next-up-inner">
          <div class="player-next-up-label">Siguiente en <span class="player-next-up-count">${COUNT}</span>s</div>
          <div class="player-next-up-title">${escapeHtml(formatNextLabel(title, nextFile))}</div>
          <button type="button" class="player-next-up-cancel" data-focusable>Cancelar</button>
        </div>
      `;
      playerEl.appendChild(el);
      let left = COUNT;
      const countEl = el.querySelector('.player-next-up-count');
      const cancelBtn = el.querySelector('.player-next-up-cancel');
      cancelBtn?.addEventListener('click', (e) => { e.stopPropagation(); cancel(); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => cancelBtn?.focus({ preventScroll: true }), 30);
      tickTimer = setInterval(() => {
        left -= 1;
        if (countEl) countEl.textContent = String(Math.max(0, left));
        if (left <= 0) {
          triggerNext();
        }
      }, 1000);
    } else {
      el.innerHTML = `
        <div class="player-next-up-inner">
          <div class="player-next-up-label">Ver siguiente película de la saga</div>
          <div class="player-next-up-title">${escapeHtml(formatNextLabel(title, nextFile))}</div>
          <div class="player-next-up-actions" style="display:flex;gap:0.5rem;margin-top:0.5rem;">
            <button type="button" class="player-next-up-play" style="background:#e50914;border:none;color:#fff;border-radius:4px;padding:0.35rem 0.8rem;font-size:0.82rem;font-weight:600;cursor:pointer;" data-focusable>Ver ahora</button>
            <button type="button" class="player-next-up-cancel" data-focusable>Cerrar</button>
          </div>
        </div>
      `;
      playerEl.appendChild(el);
      const playBtn = el.querySelector('.player-next-up-play');
      const cancelBtn = el.querySelector('.player-next-up-cancel');
      playBtn?.addEventListener('click', (e) => { e.stopPropagation(); triggerNext(); });
      cancelBtn?.addEventListener('click', (e) => { e.stopPropagation(); cancel(); });
      document.addEventListener('keydown', onKey, true);
      setTimeout(() => playBtn?.focus({ preventScroll: true }), 30);
      // Se oculta a los 25s si no se pulsa, para permitir ver el final de la película tranquilamente
      autoDismissTimer = setTimeout(() => {
        remove();
      }, 25000);
    }
  };

  const check = () => {
    if (done) return;
    const dur = Number(getDuration()) || 0;
    const cur = Number(getTime()) || 0;
    if (dur > (windowSec + 10) && cur >= dur - windowSec) startCountdown();
    else if (dur <= (windowSec + 10) && dur > 30 && cur >= dur - 30) startCountdown();
  };

  return { check, remove };
}
