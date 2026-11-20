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
  // 1. Cerrar diálogo modal si está abierto
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

function move(dir) {
  // Si hay un modal abierto, limitar la navegación a los elementos dentro del modal
  const modalEl = document.querySelector('.settings-overlay, .player-tracks-overlay, .player-next-up');
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
        target.focus({ preventScroll: true });
        curTrack.scrollTo({
          left: target.offsetLeft - curTrack.offsetWidth / 2 + target.offsetWidth / 2,
          behavior: 'smooth'
        });
        const curRow = cur.closest('.row');
        if (!curRow?.previousElementSibling?.matches('.row')) {
          const scroller = document.querySelector('.home-main') || window;
          if (scroller.scrollTop > 0) scroller.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
      return;
    }

    if (dir === 'right') {
      if (idx !== -1 && idx < trackItems.length - 1) {
        const target = trackItems[idx + 1];
        target.focus({ preventScroll: true });
        curTrack.scrollTo({
          left: target.offsetLeft - curTrack.offsetWidth / 2 + target.offsetWidth / 2,
          behavior: 'smooth'
        });
        const curRow = cur.closest('.row');
        if (!curRow?.previousElementSibling?.matches('.row')) {
          const scroller = document.querySelector('.home-main') || window;
          if (scroller.scrollTop > 0) scroller.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
      return;
    }

    if (dir === 'up') {
      const curRow = cur.closest('.row');
      const prevRow = curRow?.previousElementSibling?.matches('.row') ? curRow.previousElementSibling : null;
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
          target.focus({ preventScroll: true });
          const isFirstRow = !prevRow.previousElementSibling?.matches('.row');
          if (isFirstRow) {
            const scroller = document.querySelector('.home-main') || window;
            scroller.scrollTo({ top: 0, behavior: 'smooth' });
          } else {
            prevRow.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          }
          target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
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
      const nextRow = curRow?.nextElementSibling?.matches('.row') ? curRow.nextElementSibling : null;
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
          target.focus({ preventScroll: true });
          nextRow.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          return;
        }
      }
      return;
    }
  }

  // 2. Si está en el header de la Home (.home-header)
  const curHeader = cur.closest('.home-header');
  if (curHeader) {
    const nav = curHeader.querySelector('.home-nav');
    const reloadBtn = curHeader.querySelector('#btn-reload');
    const profileBtn = curHeader.querySelector('#btn-change-profile');

    // 2.1 En las pestañas de navegación (.home-nav)
    if (nav && nav.contains(cur)) {
      const tabs = [...nav.querySelectorAll('.home-nav-item[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
      const idx = tabs.indexOf(cur);
      if (dir === 'left') {
        if (idx > 0) {
          tabs[idx - 1].focus();
          tabs[idx - 1].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'right') {
        if (idx >= 0 && idx < tabs.length - 1) {
          tabs[idx + 1].focus();
          tabs[idx + 1].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        } else if (reloadBtn) {
          reloadBtn.focus();
        } else if (profileBtn) {
          profileBtn.focus();
        }
        return;
      }
      if (dir === 'down') {
        const target = document.querySelector('.category-sort-bar [data-focusable].active')
          || document.querySelector('.category-sort-bar [data-focusable]')
          || document.querySelector('.home-main .category-grid .lib-card[data-focusable], .home-main .row-track .lib-card[data-title]');
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        return;
      }
      if (dir === 'up') {
        return;
      }
    }

    // 2.2 En el botón Actualizar (#btn-reload)
    if (cur === reloadBtn) {
      if (dir === 'left') {
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
        const target = document.querySelector('.category-sort-bar [data-focusable].active')
          || document.querySelector('.category-sort-bar [data-focusable]')
          || document.querySelector('.home-main .category-grid .lib-card[data-focusable], .home-main .row-track .lib-card[data-title]');
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
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
        const target = document.querySelector('.category-sort-bar [data-focusable].active')
          || document.querySelector('.category-sort-bar [data-focusable]')
          || document.querySelector('.home-main .category-grid .lib-card[data-focusable], .home-main .row-track .lib-card[data-title]');
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
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
    if (dir === 'left' && idx > 0) {
      sortBtns[idx - 1].focus();
      sortBtns[idx - 1].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      return;
    }
    if (dir === 'right' && idx >= 0 && idx < sortBtns.length - 1) {
      sortBtns[idx + 1].focus();
      sortBtns[idx + 1].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      return;
    }
    if (dir === 'up') {
      const activeNav = document.querySelector('.home-nav-item.active') || document.querySelector('.home-nav-item');
      if (activeNav) {
        activeNav.focus();
        activeNav.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        return;
      }
    }
    if (dir === 'down') {
      const gridCards = [...document.querySelectorAll('.home-main .category-grid .lib-card[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
      if (gridCards.length) {
        const curRect = cur.getBoundingClientRect();
        const curCenter = curRect.left + curRect.width / 2;
        const target = gridCards.slice(0, 8).reduce((best, item) => {
          const r = item.getBoundingClientRect();
          const dist = Math.abs((r.left + r.width / 2) - curCenter);
          return (!best || dist < best.dist) ? { item, dist } : best;
        }, null)?.item || gridCards[0];
        target?.focus({ preventScroll: true });
        target?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        return;
      }
    }
    return;
  }

  // 2.5 Si está dentro de la cuadrícula de categoría (.category-grid)
  const curCatGrid = cur.closest('.category-grid');
  if (curCatGrid) {
    const cards = [...curCatGrid.querySelectorAll('.lib-card[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
    const idx = cards.indexOf(cur);
    if (idx !== -1 && dir === 'up') {
      const curRect = cur.getBoundingClientRect();
      const isTopRow = !cards.some(other => {
        if (other === cur) return false;
        const oRect = other.getBoundingClientRect();
        return oRect.bottom <= curRect.top + 10;
      });
      if (isTopRow) {
        const sortActive = document.querySelector('.category-sort-bar [data-focusable].active')
          || document.querySelector('.category-sort-bar [data-focusable]');
        if (sortActive) {
          sortActive.focus();
          sortActive.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          return;
        }
        const activeNav = document.querySelector('.home-nav-item.active') || document.querySelector('.home-nav-item');
        if (activeNav) {
          activeNav.focus();
          activeNav.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          return;
        }
      }
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
        const target = watchedBtn || favBtn || playBtn || synToggle || seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
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
        const target = watchedBtn || favBtn || playBtn || synToggle || seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
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
        const target = favBtn || watchedBtn || playBtn || synToggle || backBtn;
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

    // 3.6 Lista de episodios / archivos (#ep-list)
    if (curEpList) {
      const isSagaMeta = cur.classList.contains('saga-film-btn-meta');
      const curEp = isSagaMeta ? cur.closest('.ep') : cur;
      const epItems = [...curEpList.querySelectorAll('.ep[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
      const epIdx = epItems.indexOf(curEp);

      if (isSagaMeta) {
        if (dir === 'left') {
          if (curEp) {
            curEp.focus();
            curEp.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          }
          return;
        }
        if (dir === 'up') {
          if (epIdx > 0) {
            const prevMeta = epItems[epIdx - 1].querySelector('.saga-film-btn-meta');
            const target = prevMeta || epItems[epIdx - 1];
            target.focus();
            target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          } else {
            const target = watchedBtn || favBtn || playBtn || seasonActive || synToggle || backBtn;
            if (target) {
              target.focus();
              target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
            }
          }
          return;
        }
        if (dir === 'down') {
          if (epIdx !== -1 && epIdx < epItems.length - 1) {
            const nextMeta = epItems[epIdx + 1].querySelector('.saga-film-btn-meta');
            const target = nextMeta || epItems[epIdx + 1];
            target.focus();
            target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          }
          return;
        }
        return;
      }

      if (dir === 'right') {
        const sagaMetaBtn = cur.querySelector?.('.saga-film-btn-meta');
        if (sagaMetaBtn) {
          sagaMetaBtn.focus();
          sagaMetaBtn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          return;
        }
      }

      if (dir === 'up') {
        if (epIdx > 0) {
          epItems[epIdx - 1].focus();
          epItems[epIdx - 1].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        } else {
          const target = seasonActive || favBtn || watchedBtn || playBtn || synToggle || backBtn;
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
      if (dir === 'left' || dir === 'right') {
        if (seasonActive) {
          const sItems = [...detailScreen.querySelectorAll('.seasons-track [data-focusable]')].filter(e => e.offsetParent && !e.disabled);
          const actIdx = sItems.indexOf(seasonActive);
          const targetSeason = dir === 'left' ? sItems[Math.max(0, actIdx - 1)] : sItems[Math.min(sItems.length - 1, actIdx + 1)];
          if (targetSeason && targetSeason !== seasonActive) {
            targetSeason.click();
            targetSeason.focus();
            targetSeason.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          }
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
    if (activePlayerController && !document.querySelector('.settings-overlay, .player-tracks-overlay, .player-next-up')) {
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

    const isInput = ['INPUT', 'TEXTAREA'].includes(e.target.tagName);
    const isRange = e.target.tagName === 'INPUT' && e.target.type === 'range';
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

    if (map[e.key]) {
      if (document.activeElement?.tagName === 'VIDEO') return;

      // Si está en un input de texto o en un slider de tamaño, izquierda y derecha controlan el input
      if ((isInput && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) || (isRange && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) return;

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
    if (el) {
      el.focus();
      el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    }
  }, 50);
}
