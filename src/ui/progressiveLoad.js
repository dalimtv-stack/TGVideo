// src/ui/progressiveLoad.js
// Carga progresiva de cuadrículas largas (miles de títulos) sin bloquear la interfaz.
//
// Antes cada cuadrícula escuchaba solo `window.scroll`, pero el contenido se desplaza dentro de
// contenedores con overflow propio (.home-main, .grid-screen…): ese evento nunca llegaba y la
// cuadrícula se quedaba en los primeros 80 títulos. Aquí se escucha el scroll de cualquier
// contenedor (fase de captura), el cambio de tamaño y el foco del mando, y se mide la posición
// real del último elemento respecto a la ventana.

/**
 * @param {object} opts
 * @param {HTMLElement} opts.listEl Contenedor donde se añaden las tarjetas.
 * @param {() => boolean} opts.hasMore Indica si quedan elementos por pintar.
 * @param {() => void} opts.loadMore Añade el siguiente lote.
 * @param {number} [opts.margin] Píxeles de antelación antes de llegar al final.
 * @returns {{ check: () => void, stop: () => void }}
 */
export function watchProgressiveLoad({ listEl, hasMore, loadMore, margin = 1400 }) {
  if (!listEl) return { check: () => {}, stop: () => {} };
  let scheduled = false;
  let stopped = false;

  const nearEnd = () => {
    const last = listEl.lastElementChild;
    if (!last) return false;
    const r = last.getBoundingClientRect();
    return r.top < (window.innerHeight || document.documentElement.clientHeight) + margin;
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    document.removeEventListener('scroll', check, true);
    window.removeEventListener('resize', check);
    listEl.removeEventListener('focusin', check);
  };

  function check() {
    if (stopped) return;
    if (!listEl.isConnected) { stop(); return; }
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (stopped || !listEl.isConnected) return;
      // Hasta 4 lotes seguidos si la pantalla es muy alta o se ha bajado deprisa
      let guard = 0;
      while (hasMore() && nearEnd() && guard++ < 4) loadMore();
      if (hasMore() && nearEnd()) check();
    });
  }

  document.addEventListener('scroll', check, { capture: true, passive: true });
  window.addEventListener('resize', check, { passive: true });
  listEl.addEventListener('focusin', check);
  check();
  return { check, stop };
}
