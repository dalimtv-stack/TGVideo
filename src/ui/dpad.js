// src/ui/dpad.js
// Navegación espacial D-Pad (Android TV / Fire TV / teclado)
import { App } from '@capacitor/app';

let onBack = null;
let initialized = false;
let activePlayerController = null;

export function setBackHandler(fn) {
  onBack = fn;
}

export function registerPlayerController(controller) {
  activePlayerController = controller;
}

export function unregisterPlayerController() {
  activePlayerController = null;
}

export function handleBack() {
  // 0. Menús contextuales de PC
  const contextMenu = document.querySelector('.pc-context-menu');
  if (contextMenu) {
    contextMenu.remove();
    return true;
  }

  // 0.1 Modales de administración o diálogos
  const adminModal = document.querySelector('.admin-modal-overlay');
  if (adminModal) {
    const cancelBtn = adminModal.querySelector('#modal-cancel-btn, #reupload-cancel, .btn-secondary');
    if (cancelBtn) cancelBtn.click();
    else adminModal.remove();
    return true;
  }

  // 1. Cerrar diálogo modal si está abierto
  const trailerModal = document.querySelector('.carousel-trailer-modal');
  if (trailerModal) {
    const closeBtn = trailerModal.querySelector('.carousel-trailer-close');
    if (closeBtn) closeBtn.click();
    else trailerModal.remove();
    return true;
  }
  const tracksOverlay = document.querySelector('.player-tracks-overlay');
  if (tracksOverlay) {
    const closeBtn = tracksOverlay.querySelector('.player-tracks-close');
    if (closeBtn) closeBtn.click();
    else tracksOverlay.remove();
    return true;
  }
  const nextUp = document.querySelector('.player-next-up');
  if (nextUp) {
    const cancelBtn = nextUp.querySelector('.player-next-up-cancel');
    if (cancelBtn) cancelBtn.click();
    else nextUp.remove();
    return true;
  }
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

  // 2. Si el reproductor de vídeo está abierto, cerrarlo prioritariamente
  if (activePlayerController && typeof activePlayerController.close === 'function') {
    activePlayerController.close();
    return true;
  }
  const playerBack = document.querySelector('#pl-back, #pl-btn-back');
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

// ---------------------------------------------------------------------------------------------
// Desplazamiento de las filas de la home (carruseles)
// Un único scroll por eje y por contenedor: antes se encadenaban varios scrollIntoView/scrollTo
// "smooth" sobre el mismo contenedor y el último cancelaba al anterior (la fila quedaba sin centrar
// y, al volver a la primera, con el título cortado). Además scrollIntoView arrastraba a los
// contenedores ancestros (.home-screen), desplazando también la cabecera.
// ---------------------------------------------------------------------------------------------

/** Centra verticalmente una fila en el área desplazable de la home (la primera fila va al tope). */
export function centerRowInView(row, behavior = 'smooth') {
  if (!row) return;
  try {
    row.scrollIntoView({ block: 'center', inline: 'nearest', behavior });
  } catch (_) {
    const scroller = document.querySelector('.home-main');
    if (scroller) {
      const s = scroller.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const delta = (r.top + r.height / 2) - (s.top + s.height / 2);
      scroller.scrollTo({ top: scroller.scrollTop + delta, behavior });
    }
  }
}

/** Centra horizontalmente un elemento dentro de su carrusel. */
function centerInTrack(track, el, behavior = 'smooth') {
  if (!track || !el) return;
  try {
    el.scrollIntoView({ block: 'nearest', inline: 'center', behavior });
  } catch (_) {
    const t = track.getBoundingClientRect();
    const e = el.getBoundingClientRect();
    const left = Math.max(0, track.scrollLeft + (e.left + e.width / 2) - (t.left + t.width / 2));
    if (Math.abs(left - track.scrollLeft) > 1) track.scrollTo({ left, behavior });
  }
}

/** Da el foco a un elemento de una fila y lo deja centrado (horizontal en su carrusel, vertical en pantalla). */
export function focusInRow(target, { behavior = 'smooth' } = {}) {
  if (!target) return;
  target.focus({ preventScroll: true });
  const track = target.closest('.row-track');
  const row = target.closest('.row');
  centerInTrack(track, target, behavior);
  centerRowInView(row, behavior);
}

/** Foco + revelado: en filas centra; fuera de ellas usa el desplazamiento mínimo. */
function focusAndReveal(el) {
  if (!el) return;
  if (el.closest?.('.row-track')) { focusInRow(el); return; }
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}

function move(dir) {
  // Si hay un modal abierto, limitar la navegación a los elementos dentro del modal
  const modalEl = document.querySelector('.settings-overlay, .player-tracks-overlay, .player-next-up, .carousel-trailer-modal');
  const scope = modalEl || document;
  const items = [...scope.querySelectorAll('[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
  if (!items.length) return;

  const cur = document.activeElement && scope.contains(document.activeElement) ? document.activeElement : null;
  if (!cur) {
    const detail = document.querySelector('.detail');
    const first = detail
      ? (detail.querySelector('#d-play') || detail.querySelector('.season-btn.active') || detail.querySelector('#ep-list .ep[data-focusable]'))
      : items[0];
    first?.focus({ preventScroll: true });
    first?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
    return;
  }



  // 1. Si está dentro de un carrusel horizontal (.row-track)
  const curTrack = cur.closest('.row-track');
  if (curTrack) {
    const trackItems = [...curTrack.querySelectorAll('[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
    const idx = trackItems.indexOf(cur);

    if (dir === 'left') {
      if (idx > 0) {
        const target = trackItems[idx - 1];
        focusInRow(target);
      }
      return;
    }

    if (dir === 'right') {
      if (idx !== -1 && idx < trackItems.length - 1) {
        const target = trackItems[idx + 1];
        focusInRow(target);
      }
      return;
    }

    if (dir === 'up') {
      const curRow = cur.closest('.row');
      let prevRow = curRow?.previousElementSibling;
      while (prevRow && !prevRow.matches('.row')) {
        prevRow = prevRow.previousElementSibling;
      }
      if (prevRow) {
        const prevTrack = prevRow.querySelector('.row-track');
        const prevItems = [...(prevTrack?.querySelectorAll('[data-focusable]') || [])].filter(e => e.offsetParent && !e.disabled);
        if (prevItems.length) {
          const currentRect = cur.getBoundingClientRect();
          const currentCenter = currentRect.left + currentRect.width / 2;
          const target = prevItems.reduce((best, item) => {
            const r = item.getBoundingClientRect();
            const distance = Math.abs((r.left + r.width / 2) - currentCenter);
            return !best || distance < best.distance ? { item, distance } : best;
          }, null)?.item || prevItems[0];
          focusInRow(target);
          return;
        }
      } else {
        // Primera fila: subir a la sección activa; fallback a controles de cabecera.
        const activeTab = document.querySelector('.home-nav-item.active');
        if (activeTab) {
          activeTab.focus();
          activeTab.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          return;
        }
        const headerBtn = document.querySelector('#btn-reload, #btn-change-profile');
        if (headerBtn) {
          headerBtn.focus();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          return;
        }
      }
    }

    if (dir === 'down') {
      const curRow = cur.closest('.row');
      let nextRow = curRow?.nextElementSibling;
      while (nextRow && !nextRow.matches('.row')) {
        nextRow = nextRow.nextElementSibling;
      }
      if (nextRow) {
        const nextTrack = nextRow.querySelector('.row-track');
        const nextItems = [...(nextTrack?.querySelectorAll('[data-focusable]') || [])].filter(e => e.offsetParent && !e.disabled);
        if (nextItems.length) {
          const currentRect = cur.getBoundingClientRect();
          const currentCenter = currentRect.left + currentRect.width / 2;
          const target = nextItems.reduce((best, item) => {
            const r = item.getBoundingClientRect();
            const distance = Math.abs((r.left + r.width / 2) - currentCenter);
            return !best || distance < best.distance ? { item, distance } : best;
          }, null)?.item || nextItems[0];
          focusInRow(target);
          return;
        }
      }
      return;
    }
  }

  function getSubheaderOrContent() {
    const stage = document.querySelector('.home-main .carousel-stage');
    if (stage && stage.offsetParent) return stage;

    const firstGridCard = [...document.querySelectorAll('.home-main .category-grid .lib-card[data-focusable]')].find(e => e.offsetParent && !e.disabled);
    if (firstGridCard) return firstGridCard;

    const firstRowCard = document.querySelector('.home-main .row-track .lib-card[data-title]');
    if (firstRowCard) return firstRowCard;

    const sortToggle = document.querySelector('.category-sort-bar .category-sort-btn.active') || document.querySelector('.category-sort-bar [data-focusable], .category-sort-toggle');
    if (sortToggle && sortToggle.offsetParent && !sortToggle.disabled) return sortToggle;

    const viewBtn = document.querySelector('.category-views-bar [data-focusable], .category-view-btn');
    if (viewBtn && viewBtn.offsetParent && !viewBtn.disabled) return viewBtn;

    return null;
  }

  // 2. Si está en el header de la Home (.home-header)
  const curHeader = cur.closest('.home-header');
  if (curHeader) {
    const homeLogo = curHeader.querySelector('#home-logo');
    const nav = curHeader.querySelector('.home-nav');
    const reloadBtn = curHeader.querySelector('#btn-reload');
    const profileBtn = curHeader.querySelector('#btn-change-profile');

    // 2.0 En el logo TGVideo (especialmente en modo carrusel cuando la cabecera está colapsada)
    if (cur === homeLogo) {
      if (dir === 'right') {
        curHeader.classList.add('is-expanded');
        const firstTab = nav?.querySelector('.home-nav-item[data-focusable].active') || nav?.querySelector('.home-nav-item[data-focusable]');
        if (firstTab) {
          firstTab.focus();
          firstTab.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'down') {
        curHeader.classList.remove('is-expanded');
        const target = getSubheaderOrContent();
        focusAndReveal(target);
        return;
      }
      if (dir === 'left' || dir === 'up') return;
    }

    // 2.1 En las pestañas de navegación (.home-nav)
    if (nav && nav.contains(cur)) {
      const tabs = [...nav.querySelectorAll('.home-nav-item[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
      const idx = tabs.indexOf(cur);
      if (dir === 'left') {
        if (idx > 0) {
          tabs[idx - 1].focus();
          tabs[idx - 1].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        } else if (curHeader.querySelector('#home-logo[data-focusable]')) {
          curHeader.querySelector('#home-logo').focus();
        }
        return;
      }
      if (dir === 'right') {
        if (idx >= 0 && idx < tabs.length - 1) {
          tabs[idx + 1].focus();
          tabs[idx + 1].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        } else {
          const headerTools = curHeader.querySelector('.category-header--in-header [data-focusable]');
          if (headerTools) {
            headerTools.focus();
            headerTools.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          } else if (reloadBtn) {
            reloadBtn.focus();
          } else if (profileBtn) {
            profileBtn.focus();
          }
        }
        return;
      }
      if (dir === 'down') {
        if (curHeader.classList.contains('home-header--carousel')) {
          curHeader.classList.remove('is-expanded');
        }
        const target = getSubheaderOrContent();
        focusAndReveal(target);
        return;
      }
      if (dir === 'up') {
        return;
      }
    }

    // 2.2 En el botón Actualizar (#btn-reload)
    if (cur === reloadBtn) {
      if (dir === 'left') {
        const headerTool = curHeader.querySelector('.category-header--in-header .category-view-btn') || curHeader.querySelector('.category-header--in-header [data-focusable]');
        if (headerTool) {
          headerTool.focus();
          headerTool.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          return;
        }
        const tabs = nav ? [...nav.querySelectorAll('.home-nav-item[data-focusable]')].filter(e => e.offsetParent && !e.disabled) : [];
        if (tabs.length) {
          const lastTab = tabs[tabs.length - 1];
          lastTab.focus();
          lastTab.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'right') {
        if (profileBtn) profileBtn.focus();
        return;
      }
      if (dir === 'down') {
        if (curHeader.classList.contains('home-header--carousel')) {
          curHeader.classList.remove('is-expanded');
        }
        const target = getSubheaderOrContent();
        focusAndReveal(target);
        return;
      }
      if (dir === 'up') return;
    }

    // 2.3 En el botón Perfil (#btn-change-profile)
    if (cur === profileBtn) {
      if (dir === 'left') {
        if (reloadBtn) reloadBtn.focus();
        else {
          const tabs = nav ? [...nav.querySelectorAll('.home-nav-item[data-focusable]')].filter(e => e.offsetParent && !e.disabled) : [];
          tabs[tabs.length - 1]?.focus();
        }
        return;
      }
      if (dir === 'right') return;
      if (dir === 'down') {
        if (curHeader.classList.contains('home-header--carousel')) {
          curHeader.classList.remove('is-expanded');
        }
        const target = getSubheaderOrContent();
        focusAndReveal(target);
        return;
      }
      if (dir === 'up') return;
    }
  }

  // 2.4 Si está en la barra de ordenación de categorías (.category-sort-bar)
  const curSortBar = cur.closest('.category-sort-bar');
  if (curSortBar) {
    const sortBtns = [...curSortBar.querySelectorAll('[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
    const idx = sortBtns.indexOf(cur);
    if (dir === 'left') {
      if (idx > 0) {
        sortBtns[idx - 1].focus();
        sortBtns[idx - 1].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        return;
      }
      if (curSortBar.closest('.category-header--in-header')) {
        const activeNav = document.querySelector('.home-nav-item.active') || [...document.querySelectorAll('.home-nav-item[data-focusable]')].pop();
        if (activeNav) {
          activeNav.focus();
          activeNav.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          return;
        }
      }
    }
    if (dir === 'right') {
      if (idx >= 0 && idx < sortBtns.length - 1) {
        sortBtns[idx + 1].focus();
        sortBtns[idx + 1].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        return;
      }
      const viewBtn = document.querySelector('.category-views-bar [data-focusable]');
      if (viewBtn) {
        viewBtn.focus();
        viewBtn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        return;
      }
      return;
    }
    if (dir === 'up') {
      const carouselLogo = document.querySelector('.home-screen--carousel #home-logo[data-focusable]');
      if (carouselLogo) {
        carouselLogo.focus();
        return;
      }
      const activeNav = document.querySelector('.home-nav-item.active') || document.querySelector('.home-nav-item');
      if (activeNav) {
        activeNav.focus();
        activeNav.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        return;
      }
    }
    if (dir === 'down') {
      // Vista carrusel: el foco pasa al carrusel
      const stage = document.querySelector('.home-main .carousel-stage');
      if (stage) {
        stage.focus({ preventScroll: true });
        return;
      }
      // Cuadrícula: SIEMPRE la primera tarjeta (antes se elegía la más cercana en horizontal, es decir, una del medio)
      const gridCards = [...document.querySelectorAll('.home-main .category-grid .lib-card[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
      if (gridCards.length) {
        const first = gridCards[0];
        first.focus({ preventScroll: true });
        first.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        return;
      }
    }
    if (dir === 'right' && curSortBar.closest('.category-header--in-header')) {
      const reloadBtn = document.querySelector('#btn-reload');
      const profileBtn = document.querySelector('#btn-change-profile');
      if (reloadBtn) { reloadBtn.focus(); return; }
      if (profileBtn) { profileBtn.focus(); return; }
    }
    return;
  }

  // 2.4b Si está en la barra de modos de vista (.category-views-bar)
  const curViewsBar = cur.closest('.category-views-bar');
  if (curViewsBar) {
    if (dir === 'left') {
      const sortBtns = [...document.querySelectorAll('.category-sort-bar [data-focusable]')].filter(e => e.offsetParent && !e.disabled);
      const last = sortBtns[sortBtns.length - 1];
      if (last) {
        last.focus();
        last.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        return;
      }
    }
    if (dir === 'up') {
      const carouselLogo = document.querySelector('.home-screen--carousel #home-logo[data-focusable]');
      if (carouselLogo) {
        carouselLogo.focus();
        return;
      }
      const activeNav = document.querySelector('.home-nav-item.active') || document.querySelector('.home-nav-item');
      if (activeNav) {
        activeNav.focus();
        activeNav.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        return;
      }
    }
    if (dir === 'down') {
      const stage = document.querySelector('.home-main .carousel-stage');
      if (stage) {
        stage.focus({ preventScroll: true });
        return;
      }
      const gridCards = [...document.querySelectorAll('.home-main .category-grid .lib-card[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
      if (gridCards.length) {
        const first = gridCards[0];
        first.focus({ preventScroll: true });
        first.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        return;
      }
    }
    if (dir === 'right' && curViewsBar.closest('.category-header--in-header')) {
      const reloadBtn = document.querySelector('#btn-reload');
      const profileBtn = document.querySelector('#btn-change-profile');
      if (reloadBtn) { reloadBtn.focus(); return; }
      if (profileBtn) { profileBtn.focus(); return; }
    }
    return;
  }

  // 2.4c Si está en el botón de tráiler del carrusel (.carousel-trailer-btn)
  const curTrailerBtn = cur.closest('.carousel-trailer-btn');
  if (curTrailerBtn) {
    if (dir === 'up') {
      const stage = document.querySelector('.carousel-stage');
      if (stage) {
        stage.focus({ preventScroll: true });
        return;
      }
    }
    if (dir === 'left' || dir === 'right') {
      const navBtn = document.querySelector(`.carousel-stage .carousel-nav.${dir === 'left' ? 'prev' : 'next'}`);
      if (navBtn) navBtn.click();
      return;
    }
    return;
  }

  // 2.5 Navegación dedicada para cuadrículas (.category-grid y .grid-cards de los "+")
  const curGrid = cur.closest('.category-grid, .grid-cards');
  if (curGrid) {
    const cards = [...curGrid.querySelectorAll('.lib-card[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
    const idx = cards.indexOf(cur);
    if (idx !== -1) {
      const curRect = cur.getBoundingClientRect();

      // Mapear elementos de la misma fila visual (mismo centro vertical)
      const sameRowCards = cards.filter(c => {
        const r = c.getBoundingClientRect();
        return Math.abs((r.top + r.height / 2) - (curRect.top + curRect.height / 2)) < curRect.height * 0.45;
      }).sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

      const colIdx = sameRowCards.indexOf(cur);

      if (dir === 'left') {
        if (colIdx > 0) {
          const target = sameRowCards[colIdx - 1];
          target.focus({ preventScroll: true });
          target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          return;
        }
      } else if (dir === 'right') {
        if (colIdx !== -1 && colIdx < sameRowCards.length - 1) {
          const target = sameRowCards[colIdx + 1];
          target.focus({ preventScroll: true });
          target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          return;
        }
      } else if (dir === 'up') {
        const aboveCards = cards.filter(c => c.getBoundingClientRect().bottom <= curRect.top + 15);
        if (aboveCards.length === 0) {
          // Primera fila: subir a las herramientas o cabecera
          const screen = cur.closest('.grid-screen, .home-screen') || document;
          const target = screen.querySelector('.grid-sort-bar [data-focusable].active, .category-sort-bar [data-focusable].active')
            || screen.querySelector('.grid-sort-bar [data-focusable], .category-sort-bar [data-focusable]')
            || screen.querySelector('#grid-btn-back, .home-nav-item.active, .home-nav-item');
          if (target && target.offsetParent && !target.disabled) {
            target.focus();
            target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
            return;
          }
        } else {
          const curMidX = (curRect.left + curRect.right) / 2;
          const maxBottomAbove = Math.max(...aboveCards.map(c => c.getBoundingClientRect().bottom));
          const immediateRowAbove = aboveCards.filter(c => Math.abs(c.getBoundingClientRect().bottom - maxBottomAbove) < curRect.height * 0.45);
          let bestCard = immediateRowAbove[0];
          let bestDist = Infinity;
          for (const c of immediateRowAbove) {
            const r = c.getBoundingClientRect();
            const dist = Math.abs((r.left + r.right) / 2 - curMidX);
            if (dist < bestDist) {
              bestDist = dist;
              bestCard = c;
            }
          }
          if (bestCard) {
            bestCard.focus({ preventScroll: true });
            bestCard.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            return;
          }
        }
      } else if (dir === 'down') {
        const belowCards = cards.filter(c => c.getBoundingClientRect().top >= curRect.bottom - 15);
        if (belowCards.length > 0) {
          const curMidX = (curRect.left + curRect.right) / 2;
          const minTopBelow = Math.min(...belowCards.map(c => c.getBoundingClientRect().top));
          const immediateRowBelow = belowCards.filter(c => Math.abs(c.getBoundingClientRect().top - minTopBelow) < curRect.height * 0.45);
          let bestCard = immediateRowBelow[0];
          let bestDist = Infinity;
          for (const c of immediateRowBelow) {
            const r = c.getBoundingClientRect();
            const dist = Math.abs((r.left + r.right) / 2 - curMidX);
            if (dist < bestDist) {
              bestDist = dist;
              bestCard = c;
            }
          }
          if (bestCard) {
            bestCard.focus({ preventScroll: true });
            bestCard.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
            return;
          }
        }
      }
      return;
    }
  }

  // 3. Si está dentro de la ficha de detalle (.detail)
  const detailScreen = cur.closest('.detail');
  if (detailScreen && !modalEl) {
    const backBtn = detailScreen.querySelector('#d-back');
    const fixMetaBtn = detailScreen.querySelector('#d-fix-meta');
    const imagesBtn = detailScreen.querySelector('#d-images');
    const synToggle = detailScreen.querySelector('.btn-syn-toggle:not([hidden])');
    const playBtn = detailScreen.querySelector('#d-play');
    const favBtn = detailScreen.querySelector('#d-fav');
    const watchedBtn = detailScreen.querySelector('#d-watched');
    const trailerBtn = detailScreen.querySelector('#d-trailer');
    const seasonActive = detailScreen.querySelector('.seasons-track .season-btn.active') || detailScreen.querySelector('.seasons-track .season-btn');
    const curSeasonTrack = cur.closest('.seasons-track');
    const curEpList = cur.closest('#ep-list');

    // 3.1 Botón Volver (#d-back)
    if (cur === backBtn) {
      if (dir === 'right') {
        const target = fixMetaBtn || imagesBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'down') {
        const target = synToggle || playBtn || favBtn || watchedBtn || seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      return;
    }

    // 3.2 Botón Identificación TMDB (#d-fix-meta)
    if (cur === fixMetaBtn) {
      if (dir === 'left') {
        if (backBtn) {
          backBtn.focus();
          backBtn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'right') {
        if (imagesBtn) {
          imagesBtn.focus();
          imagesBtn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'down') {
        const target = playBtn || favBtn || watchedBtn || synToggle || seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      return;
    }

    // 3.25 Botón Imágenes (#d-images)
    if (cur === imagesBtn) {
      if (dir === 'left') {
        const target = fixMetaBtn || backBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'down') {
        const target = playBtn || favBtn || watchedBtn || synToggle || seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      return;
    }

    // 3.3 Botón sinopsis "más" / "menos" (.btn-syn-toggle)
    if (cur === synToggle) {
      if (dir === 'up') {
        const target = backBtn || fixMetaBtn || imagesBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'down') {
        const target = playBtn || favBtn || watchedBtn || seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'left') {
        if (backBtn) {
          backBtn.focus();
          backBtn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'right') {
        const target = fixMetaBtn || imagesBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      return;
    }

    // 3.4 Botón Reproducir / Continuar (#d-play)
    if (cur === playBtn) {
      if (dir === 'up') {
        const target = synToggle || backBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'right') {
        const target = favBtn || watchedBtn || fixMetaBtn || imagesBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'left') {
        if (backBtn) {
          backBtn.focus();
          backBtn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'down') {
        const target = seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      return;
    }

    // 3.42 Botón Favoritos (#d-fav)
    if (cur === favBtn) {
      if (dir === 'left') {
        const target = playBtn || backBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'right') {
        const target = watchedBtn || fixMetaBtn || imagesBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'up') {
        const target = synToggle || backBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'down') {
        const target = seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      return;
    }

    // 3.44 Botón Marcar como visto (#d-watched)
    if (cur === watchedBtn) {
      if (dir === 'left') {
        const target = favBtn || playBtn || backBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'right') {
        const target = trailerBtn || imagesBtn || fixMetaBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'up') {
        const target = imagesBtn || fixMetaBtn || synToggle || backBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'down') {
        const target = seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      return;
    }

    // 3.45 Botón Tráiler (#d-trailer)
    if (cur === trailerBtn) {
      if (dir === 'left') {
        const target = watchedBtn || favBtn || playBtn || backBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'right') {
        const target = imagesBtn || fixMetaBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'up') {
        const target = imagesBtn || fixMetaBtn || synToggle || backBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'down') {
        const target = seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      return;
    }

    // 3.5 Selector de temporadas (.seasons-track)
    if (curSeasonTrack) {
      const sItems = [...curSeasonTrack.querySelectorAll('[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
      const sIdx = sItems.indexOf(cur);
      if (dir === 'left' && sIdx > 0) {
        sItems[sIdx - 1].focus();
        sItems[sIdx - 1].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        return;
      }
      if (dir === 'right' && sIdx !== -1 && sIdx < sItems.length - 1) {
        sItems[sIdx + 1].focus();
        sItems[sIdx + 1].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        return;
      }
      if (dir === 'up') {
        const target = playBtn || favBtn || watchedBtn || trailerBtn || synToggle || backBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'down') {
        const firstEp = detailScreen.querySelector('#ep-list .ep[data-focusable]');
        if (firstEp) {
          firstEp.focus();
          firstEp.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      return;
    }

    // 3.6 Lista de episodios / archivos (#ep-list) y botones de acción (mover, identificar, TMDB)
    if (curEpList) {
      const isEpAction = cur.classList.contains('episode-move-btn') ||
                         cur.classList.contains('episode-identification-btn') ||
                         cur.classList.contains('saga-film-btn-meta');
      const curEp = isEpAction ? cur.closest('.ep') : cur;
      const epItems = [...curEpList.querySelectorAll('.ep[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
      const epIdx = epItems.indexOf(curEp);

      if (isEpAction) {
        const curActions = curEp ? [...curEp.querySelectorAll('.episode-move-btn, .episode-identification-btn, .saga-film-btn-meta')].filter(e => e.offsetParent && !e.disabled) : [];
        const actionIdx = curActions.indexOf(cur);

        if (dir === 'left') {
          if (actionIdx > 0) {
            const prevAction = curActions[actionIdx - 1];
            prevAction.focus();
            prevAction.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          } else if (curEp) {
            curEp.focus();
            curEp.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          }
          return;
        }

        if (dir === 'right') {
          if (actionIdx !== -1 && actionIdx < curActions.length - 1) {
            const nextAction = curActions[actionIdx + 1];
            nextAction.focus();
            nextAction.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          }
          return;
        }

        if (dir === 'up') {
          if (epIdx > 0) {
            const prevEp = epItems[epIdx - 1];
            const prevActions = [...prevEp.querySelectorAll('.episode-move-btn, .episode-identification-btn, .saga-film-btn-meta')].filter(e => e.offsetParent && !e.disabled);
            const target = prevActions[Math.min(actionIdx >= 0 ? actionIdx : 0, prevActions.length - 1)] || prevEp;
            target.focus();
            target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          } else {
            const target = seasonActive || playBtn || favBtn || watchedBtn || trailerBtn || synToggle || backBtn;
            if (target) {
              target.focus();
              target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
            }
          }
          return;
        }

        if (dir === 'down') {
          if (epIdx !== -1 && epIdx < epItems.length - 1) {
            const nextEp = epItems[epIdx + 1];
            const nextActions = [...nextEp.querySelectorAll('.episode-move-btn, .episode-identification-btn, .saga-film-btn-meta')].filter(e => e.offsetParent && !e.disabled);
            const target = nextActions[Math.min(actionIdx >= 0 ? actionIdx : 0, nextActions.length - 1)] || nextEp;
            target.focus();
            target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          }
          return;
        }
        return;
      }

      // Foco en el cuerpo del elemento de episodio (.ep)
      if (dir === 'right') {
        const firstAction = cur.querySelector?.('.episode-move-btn, .episode-identification-btn, .saga-film-btn-meta');
        if (firstAction) {
          firstAction.focus();
          firstAction.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          return;
        }
        if (seasonActive) {
          const sItems = [...detailScreen.querySelectorAll('.seasons-track [data-focusable]')].filter(e => e.offsetParent && !e.disabled);
          const actIdx = sItems.indexOf(seasonActive);
          const targetSeason = sItems[Math.min(sItems.length - 1, actIdx + 1)];
          if (targetSeason && targetSeason !== seasonActive) {
            targetSeason.click();
            targetSeason.focus();
            targetSeason.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          }
        }
        return;
      }

      if (dir === 'left') {
        if (seasonActive) {
          const sItems = [...detailScreen.querySelectorAll('.seasons-track [data-focusable]')].filter(e => e.offsetParent && !e.disabled);
          const actIdx = sItems.indexOf(seasonActive);
          const targetSeason = sItems[Math.max(0, actIdx - 1)];
          if (targetSeason && targetSeason !== seasonActive) {
            targetSeason.click();
            targetSeason.focus();
            targetSeason.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          }
        }
        return;
      }

      if (dir === 'up') {
        if (epIdx > 0) {
          epItems[epIdx - 1].focus();
          epItems[epIdx - 1].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        } else {
          const target = seasonActive || playBtn || favBtn || watchedBtn || trailerBtn || synToggle || backBtn;
          if (target) {
            target.focus();
            target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          }
        }
        return;
      }

      if (dir === 'down') {
        if (epIdx !== -1 && epIdx < epItems.length - 1) {
          epItems[epIdx + 1].focus();
          epItems[epIdx + 1].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      return;
    }
  }

  // 4. Navegación espacial general para modales y formularios
  const curRect = cur.getBoundingClientRect();
  const c = { x: curRect.left + curRect.width / 2, y: curRect.top + curRect.height / 2 };

  let best = null;
  let bestScore = Infinity;
  const isHoriz = dir === 'left' || dir === 'right';

  for (const el of items) {
    if (el === cur) continue;
    const r = el.getBoundingClientRect();
    const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const dx = p.x - c.x;
    const dy = p.y - c.y;

    if (dir === 'left' && dx >= -5) continue;
    if (dir === 'right' && dx <= 5) continue;
    if (dir === 'up' && dy >= -5) continue;
    if (dir === 'down' && dy <= 5) continue;

    const yOverlap = Math.max(0, Math.min(curRect.bottom, r.bottom) - Math.max(curRect.top, r.top));
    const xOverlap = Math.max(0, Math.min(curRect.right, r.right) - Math.max(curRect.left, r.left));

    let score;
    if (isHoriz) {
      const sameRow = yOverlap > Math.min(curRect.height, r.height) * 0.25;
      const rowPenalty = sameRow ? 0 : 50000;
      score = Math.abs(dx) + Math.abs(dy) * 2 + (sameRow ? 0 : 2000);
    } else {
      const sameCol = xOverlap > Math.min(curRect.width, r.width) * 0.25;
      const colPenalty = sameCol ? 0 : 50000;
      score = Math.abs(dy) + Math.abs(dx) * 4 + colPenalty;
    }

    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  if (best) {
    best.focus();
    best.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
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

  // Integración con botón "Atrás" del ratón en PC (e.button === 3 / Navegador Atrás)
  // Se aplica un antirrebote de 350 ms para evitar que los eventos consecutivos
  // pointerup, mouseup y auxclick del navegador disparen dos o tres veces el retroceso.
  let lastMouseBackAt = 0;
  const onMouseBack = (e) => {
    if (e.button === 3) {
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      if (now - lastMouseBackAt > 350) {
        lastMouseBackAt = now;
        handleBack();
      }
    }
  };
  window.addEventListener('mouseup', onMouseBack, true);
  window.addEventListener('auxclick', onMouseBack, true);
  window.addEventListener('pointerup', onMouseBack, true);

  // Soporte para botón "Atrás" de navegación en navegador de escritorio (popstate)
  window.addEventListener('popstate', (e) => {
    if (handleBack()) {
      e.preventDefault();
      try {
        window.history.pushState(null, '', window.location.href);
      } catch (_) {}
    }
  });
  try {
    if (window.history && window.history.pushState) {
      window.history.pushState(null, '', window.location.href);
    }
  } catch (_) {}

  document.addEventListener('keydown', (e) => {
    // Tecla Atrás en Fire TV / Android TV / mandos / teclados
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

    // Si el reproductor de vídeo está abierto y no hay un modal encima, delegar control al reproductor
    if (activePlayerController && document.querySelector('.player') && !document.querySelector('.settings-overlay, .player-tracks-overlay, .player-next-up')) {
      // 1. Tecla PLAY / PAUSE física del mando a distancia
      const isPlayPauseKey = e.key === 'MediaPlayPause' || e.key === 'MediaPlay' || e.key === 'MediaPause' ||
        e.key === 'Play' || e.key === 'Pause' || e.key === 'ToggleMediaPlayPause' ||
        e.keyCode === 179 || e.keyCode === 85 || e.keyCode === 126 || e.keyCode === 127 || e.keyCode === 250 || e.keyCode === 19;

      if (isPlayPauseKey) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof activePlayerController.onPlayPause === 'function') {
          activePlayerController.onPlayPause();
        } else {
          activePlayerController.onSelect?.();
        }
        return;
      }

      // 2. Tecla FORWARD física del mando (adelantar segundos configurados)
      const isForwardKey = e.key === 'MediaFastForward' || e.key === 'FastForward' ||
        e.key === 'MediaTrackNext' || e.key === 'MediaSkipForward' || e.key === 'MediaStepForward' ||
        e.keyCode === 228 || e.keyCode === 90 || e.keyCode === 178 || e.keyCode === 87 || e.keyCode === 176 || e.keyCode === 272 || e.keyCode === 274;

      if (isForwardKey) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof activePlayerController.onForward === 'function') {
          activePlayerController.onForward();
        } else {
          activePlayerController.onRight?.();
        }
        return;
      }

      // 3. Tecla REWIND física del mando (retroceder segundos configurados)
      const isRewindKey = e.key === 'MediaRewind' || e.key === 'Rewind' ||
        e.key === 'MediaTrackPrevious' || e.key === 'MediaSkipBackward' || e.key === 'MediaStepBackward' ||
        e.keyCode === 227 || e.keyCode === 89 || e.keyCode === 177 || e.keyCode === 88 || e.keyCode === 273 || e.keyCode === 275;

      if (isRewindKey) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof activePlayerController.onRewind === 'function') {
          activePlayerController.onRewind();
        } else {
          activePlayerController.onLeft?.();
        }
        return;
      }

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        activePlayerController.onLeft?.();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        activePlayerController.onRight?.();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        activePlayerController.onUp?.();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activePlayerController.onDown?.();
        return;
      }
      if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 13 || e.keyCode === 23) {
        e.preventDefault();
        activePlayerController.onSelect?.();
        return;
      }
    }

    // Fuera del reproductor, PLAY/PAUSE del mando actúa como OK
    const isPlayPauseOutside = e.key === 'MediaPlayPause' || e.key === 'MediaPlay' || e.key === 'MediaPause' ||
      e.key === 'Play' || e.key === 'Pause' || e.key === 'ToggleMediaPlayPause' ||
      e.keyCode === 179 || e.keyCode === 85 || e.keyCode === 126 || e.keyCode === 127 || e.keyCode === 250;
    if (isPlayPauseOutside && !activePlayerController) {
      const el = document.activeElement;
      if (el && el !== document.body && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
        e.preventDefault();
        e.stopPropagation();
        el.click();
      }
      return;
    }

    const isInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
    const isRange = e.target.tagName === 'INPUT' && e.target.type === 'range';
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

    if (map[e.key]) {
      if (document.activeElement?.tagName === 'VIDEO') return;

      // Si está en un input de texto o en un slider de tamaño, izquierda y derecha controlan el input
      if ((isInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) || (isRange && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) return;

      e.preventDefault();
      move(map[e.key]);
    } else if (e.key === 'Enter' || e.key === 'Select' || e.keyCode === 13 || e.keyCode === 23) {
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
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, 50);
}