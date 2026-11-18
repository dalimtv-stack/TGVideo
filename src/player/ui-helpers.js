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
  const windowSec = 45;
  let shown = false;
  let done = false;
  let tickTimer = null;
  let el = null;

  const onKey = (e) => {
    if (!el) return;
    const ok = e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23;
    if (!ok) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    cancel();
  };
  const cancel = () => {
    done = true;
    remove();
    onCancel?.();
  };
  const remove = () => {
    clearInterval(tickTimer);
    document.removeEventListener('keydown', onKey, true);
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
