// Navegación espacial D-Pad (Android TV / Fire TV / teclado)
let onBack = null;
let initialized = false;
export function setBackHandler(fn) { onBack = fn; }

function center(el) { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

function move(dir) {
  const items = [...document.querySelectorAll('[data-focusable]')].filter(e => e.offsetParent);
  if (!items.length) return;
  const cur = document.activeElement?.hasAttribute?.('data-focusable') ? document.activeElement : null;
  if (!cur) { items[0].focus({ preventScroll: true }); return; }
  const c = center(cur);
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const p = center(el), dx = p.x - c.x, dy = p.y - c.y;
    const ok = (dir === 'left' && dx < -5) || (dir === 'right' && dx > 5) || (dir === 'up' && dy < -5) || (dir === 'down' && dy > 5);
    if (!ok) continue;
    const horiz = dir === 'left' || dir === 'right';
    const score = horiz ? Math.abs(dx) + Math.abs(dy) * 4 : Math.abs(dy) + Math.abs(dx) * 0.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (best) { best.focus(); best.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' }); }
}

export function initDpad() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
    if (map[e.key]) {
      if (document.activeElement?.tagName === 'VIDEO') return;
      e.preventDefault(); move(map[e.key]);
    } else if (e.key === 'Enter' && document.activeElement?.hasAttribute('data-focusable')) {
      e.preventDefault(); document.activeElement.click();
    } else if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack') {
      if (onBack) { e.preventDefault(); onBack(); }
    }
  });
}
export function focusFirst(sel = '[data-focusable]') { setTimeout(() => document.querySelector(sel)?.focus({ preventScroll: true }), 30); }
