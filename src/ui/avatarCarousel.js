// src/ui/avatarCarousel.js
// Selector de avatar en carrusel infinito: el avatar con foco queda en el centro (más grande)
// y debajo se muestra el nombre del perfil, como se verá una vez configurado.
// Se usa al crear un perfil y desde "Ajustes de perfil → Cambiar avatar".
import { AVAILABLE_AVATARS, profileAvatar } from './settings.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const VISIBLE = 3; // avatares visibles a cada lado del central

// Devuelve el id del avatar elegido, o null si se cancela.
export function pickAvatar({ name = '', current = null, title = 'Elige tu avatar', confirmLabel = 'Continuar' } = {}) {
  return new Promise((resolve) => {
    const list = AVAILABLE_AVATARS;
    const n = list.length;
    if (!n) return resolve(null);

    let cur = Math.max(0, list.findIndex((a) => a.id === current));
    const previousFocus = document.activeElement;

    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay avatar-carousel-overlay';
    overlay.innerHTML = `
      <section class="avc-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2 class="avc-title">${esc(title)}</h2>
        <div class="avc-stage" aria-live="polite">
          ${list.map((a, i) => `<div class="avc-item" data-i="${i}"><div class="avatar">${profileAvatar({ avatar: a.id, name })}</div></div>`).join('')}
        </div>
        <div class="profile-name avc-name">${esc(name)}</div>
        <div class="avc-avatar-name"></div>
        <div class="avc-actions">
          <button type="button" class="btn-ghost" data-focusable id="avc-cancel">Cancelar</button>
          <button type="button" class="btn" data-focusable id="avc-ok">${esc(confirmLabel)}</button>
        </div>
        <p class="avc-hint">◀ ▶ para cambiar · OK para elegir</p>
      </section>`;
    document.body.append(overlay);

    const items = [...overlay.querySelectorAll('.avc-item')];
    const label = overlay.querySelector('.avc-avatar-name');

    const layout = () => {
      const step = Math.min(150, window.innerWidth * 0.2);
      items.forEach((el, i) => {
        // Distancia circular más corta al elemento central → carrusel infinito
        let off = ((i - cur) % n + n) % n;
        if (off > n / 2) off -= n;
        const abs = Math.abs(off);
        const visible = abs <= VISIBLE;
        const scale = abs === 0 ? 1.45 : Math.max(0.5, 0.9 - (abs - 1) * 0.15);
        el.style.transition = visible ? '' : 'none';
        el.style.transform = `translate(-50%, -50%) translateX(${off * step + Math.sign(off) * (abs ? 40 : 0)}px) scale(${scale})`;
        el.style.opacity = visible ? (abs === 0 ? 1 : Math.max(0.25, 0.7 - (abs - 1) * 0.2)) : 0;
        el.style.zIndex = String(10 - abs);
        el.style.pointerEvents = visible ? 'auto' : 'none';
        el.classList.toggle('is-center', abs === 0);
      });
      label.textContent = list[cur].name;
    };
    const move = (d) => { cur = ((cur + d) % n + n) % n; layout(); };

    const finish = (value) => {
      overlay.remove();
      window.removeEventListener('resize', layout);
      try { previousFocus?.focus?.({ preventScroll: true }); } catch (_) {}
      resolve(value);
    };

    items.forEach((el) => {
      el.addEventListener('click', () => {
        const i = Number(el.dataset.i);
        if (i === cur) finish(list[cur].id);
        else { let d = i - cur; if (d > n / 2) d -= n; if (d < -n / 2) d += n; move(d); }
      });
    });
    overlay.querySelector('#avc-ok').onclick = () => finish(list[cur].id);
    overlay.querySelector('#avc-cancel').onclick = () => finish(null);

    overlay.addEventListener('keydown', (e) => {
      // El carrusel gestiona sus propias teclas: evitar que el D-Pad global mueva el foco
      if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); move(-1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); move(1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault(); e.stopPropagation();
        const target = document.activeElement?.id === 'avc-ok' ? '#avc-cancel' : '#avc-ok';
        overlay.querySelector(target)?.focus();
      } else if (['Escape', 'GoBack', 'Back'].includes(e.key) || e.keyCode === 4 || e.key === 'Backspace') {
        e.preventDefault(); e.stopPropagation(); finish(null);
      } else if (e.key === 'Enter') {
        e.stopPropagation();
      }
    });

    // Gestos táctiles / rueda
    let startX = null;
    overlay.addEventListener('pointerdown', (e) => { startX = e.clientX; });
    overlay.addEventListener('pointerup', (e) => {
      if (startX !== null && Math.abs(e.clientX - startX) > 40) move(e.clientX < startX ? 1 : -1);
      startX = null;
    });
    overlay.addEventListener('wheel', (e) => { e.preventDefault(); move(e.deltaY > 0 || e.deltaX > 0 ? 1 : -1); }, { passive: false });
    window.addEventListener('resize', layout);

    layout();
    overlay.querySelector('#avc-ok').focus({ preventScroll: true });
  });
}
