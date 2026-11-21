// src/ui/spatialNav.js
// Navegación espacial con mando (D-pad) dentro de un contenedor: las flechas mueven el foco al elemento
// [data-focusable] más cercano en esa dirección (rejillas de imágenes, barras de botones, listas…).
// Se engancha al contenedor y detiene la propagación, de modo que el manejador genérico del diálogo
// (que solo avanza/retrocede de uno en uno) no interfiera.

const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

function visibleItems(root, selector) {
  return [...root.querySelectorAll(selector)].filter((el) => !el.disabled && el.offsetParent !== null);
}

export function findNeighbor(root, current, dir, selector = '[data-focusable]') {
  const items = visibleItems(root, selector);
  const curRect = current.getBoundingClientRect();
  const c = { x: curRect.left + curRect.width / 2, y: curRect.top + curRect.height / 2 };
  const horiz = dir === 'left' || dir === 'right';
  let best = null;
  let bestScore = Infinity;

  for (const el of items) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const dx = r.left + r.width / 2 - c.x;
    const dy = r.top + r.height / 2 - c.y;
    if (dir === 'left' && dx >= -4) continue;
    if (dir === 'right' && dx <= 4) continue;
    if (dir === 'up' && dy >= -4) continue;
    if (dir === 'down' && dy <= 4) continue;

    const yOverlap = Math.max(0, Math.min(curRect.bottom, r.bottom) - Math.max(curRect.top, r.top));
    const xOverlap = Math.max(0, Math.min(curRect.right, r.right) - Math.max(curRect.left, r.left));
    let score;
    if (horiz) {
      const sameRow = yOverlap > Math.min(curRect.height, r.height) * 0.25;
      score = Math.abs(dx) + Math.abs(dy) * 2 + (sameRow ? 0 : 5000);
    } else {
      const sameCol = xOverlap > Math.min(curRect.width, r.width) * 0.25;
      score = Math.abs(dy) + Math.abs(dx) * 4 + (sameCol ? 0 : 5000);
    }
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

/**
 * @param {HTMLElement} root  contenedor (p. ej. el cuerpo del selector de imágenes)
 * @param {object} [opts]
 * @param {string} [opts.selector]  elementos enfocables (por defecto [data-focusable])
 * @param {string} [opts.scroller]  selector del contenedor con scroll (por defecto el propio root)
 * @returns {() => void} función para desenganchar
 */
export function attachSpatialNav(root, { selector = '[data-focusable]' } = {}) {
  const onKey = (e) => {
    const dir = DIRS[e.key];
    if (!dir) return;
    const cur = document.activeElement;
    if (!cur || !root.contains(cur) || !cur.matches(selector)) return;

    // En campos de texto, izquierda/derecha mueven el cursor
    if ((cur.tagName === 'INPUT' || cur.tagName === 'TEXTAREA') && (dir === 'left' || dir === 'right')) return;

    const next = findNeighbor(root, cur, dir, selector);
    if (next) {
      e.preventDefault();
      e.stopPropagation();
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else if (dir === 'up' || dir === 'down') {
      // Sin vecino en esa dirección: dejar que el diálogo gestione la salida (cabecera / cierre)
      return;
    } else {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  root.addEventListener('keydown', onKey);
  return () => root.removeEventListener('keydown', onKey);
}
