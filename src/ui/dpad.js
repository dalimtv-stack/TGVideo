// Navegación espacial D-Pad (Android TV / Fire TV / teclado)
import { App } from '@capacitor/app';

let onBack = null;
let initialized = false;

export function setBackHandler(fn) {
  onBack = fn;
}

export function handleBack() {
  // 1. Cerrar diálogo modal si está abierto
  const overlay = document.querySelector('.settings-overlay');
  if (overlay) {
    const closeBtn = overlay.querySelector('[aria-label="Cerrar"]');
    if (closeBtn) {
      closeBtn.click();
      return true;
    }
    overlay.remove();
    return true;
  }

  // 2. Cerrar reproductor de vídeo si está abierto
  const playerBack = document.querySelector('#pl-back');
  if (playerBack) {
    playerBack.click();
    return true;
  }

  // 3. Ejecutar handler de volver registrado
  if (typeof onBack === 'function') {
    onBack();
    return true;
  }

  return false;
}

function center(el) {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function move(dir) {
  // Si hay un modal abierto, limitar la navegación a los elementos dentro del modal
  const scope = document.querySelector('.settings-overlay') || document;
  const items = [...scope.querySelectorAll('[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
  if (!items.length) return;

  const cur = document.activeElement && scope.contains(document.activeElement) ? document.activeElement : null;
  if (!cur) {
    items[0].focus({ preventScroll: true });
    return;
  }

  const c = center(cur);
  let best = null;
  let bestScore = Infinity;

  for (const el of items) {
    if (el === cur) continue;
    const p = center(el);
    const dx = p.x - c.x;
    const dy = p.y - c.y;

    const ok =
      (dir === 'left' && dx < -5) ||
      (dir === 'right' && dx > 5) ||
      (dir === 'up' && dy < -5) ||
      (dir === 'down' && dy > 5);

    if (!ok) continue;

    const horiz = dir === 'left' || dir === 'right';
    const score = horiz ? Math.abs(dx) + Math.abs(dy) * 4 : Math.abs(dy) + Math.abs(dx) * 0.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (best) {
    best.focus();
    best.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
  }
}

export function initDpad() {
  if (initialized) return;
  initialized = true;

  // Integración con botón físico Atrás de Android / Fire TV vía Capacitor
  try {
    App.addListener('backButton', () => {
      const handled = handleBack();
      if (!handled) {
        App.exitApp();
      }
    });
  } catch (_) {}

  document.addEventListener('keydown', (e) => {
    // Tecla Atrás en Fire TV / Android TV / teclados
    const isBackKey =
      e.key === 'Escape' ||
      e.key === 'GoBack' ||
      e.key === 'Back' ||
      e.keyCode === 4 ||
      (e.key === 'Backspace' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName));

    if (isBackKey) {
      const handled = handleBack();
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }

    if (e.defaultPrevented) return;

    const isInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
    const isSelect = e.target.tagName === 'SELECT';

    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

    if (map[e.key]) {
      if (document.activeElement?.tagName === 'VIDEO') return;

      // Si está en un input de texto, izquierda y derecha navegan dentro del texto
      if (isInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;

      // Si está en un select, arriba y abajo pueden cambiar opción si está abierto,
      // pero si el usuario navega verticalmente queremos permitir mover el foco
      e.preventDefault();
      move(map[e.key]);
    } else if (e.key === 'Enter') {
      if (isInput) {
        // En inputs, Enter activa el submit del formulario si existe
        const form = e.target.closest('form');
        if (form) {
          e.preventDefault();
          const submitBtn = form.querySelector('button[type="submit"]') || form.querySelector('button');
          if (submitBtn) submitBtn.click();
          else form.requestSubmit?.();
        }
      } else if (document.activeElement?.hasAttribute('data-focusable')) {
        e.preventDefault();
        document.activeElement.click();
      }
    }
  });
}

export function focusFirst(sel = '[data-focusable]') {
  setTimeout(() => {
    const el = document.querySelector(sel);
    if (el) el.focus({ preventScroll: true });
  }, 50);
}
