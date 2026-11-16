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
  const modalEl = document.querySelector('.settings-overlay');
  const scope = modalEl || document;
  const items = [...scope.querySelectorAll('[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
  if (!items.length) return;

  const cur = document.activeElement && scope.contains(document.activeElement) ? document.activeElement : null;
  if (!cur) {
    items[0].focus();
    items[0].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    return;
  }

  // 1.1 Si está sobre el botón "+" de expandir fila (.row-expand-btn)
  if (cur.matches(".row-expand-btn")) {
    const curRow = cur.closest(".row");
    if (dir === "right") {
      const firstCard = curRow?.querySelector(".row-track [data-focusable]");
      if (firstCard) {
        firstCard.focus();
        firstCard.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
      }
      return;
    }
    if (dir === "down") {
      const nextRow = curRow?.nextElementSibling?.matches(".row") ? curRow.nextElementSibling : null;
      const target = nextRow?.querySelector(".row-expand-btn") || nextRow?.querySelector(".row-track [data-focusable]");
      if (target) {
        target.focus();
        nextRow.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      }
      return;
    }
    if (dir === "up") {
      const prevRow = curRow?.previousElementSibling?.matches(".row") ? curRow.previousElementSibling : null;
      if (prevRow) {
        const target = prevRow.querySelector(".row-expand-btn") || prevRow.querySelector(".row-track [data-focusable]");
        if (target) {
          target.focus();
          prevRow.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        }
      } else {
        const headerBtn = document.querySelector("#btn-reload, #btn-change-profile");
        if (headerBtn) {
          headerBtn.focus();
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
      return;
    }
    if (dir === "left") return;
  }

  // 1. Si está dentro de un carrusel horizontal (.row-track)
  const curTrack = cur.closest('.row-track');
  if (curTrack) {
    const trackItems = [...curTrack.querySelectorAll('[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
    const idx = trackItems.indexOf(cur);

    if (dir === 'left') {
      if (idx > 0) {
        const target = trackItems[idx - 1];
        target.focus();
        target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      } else {
        const curRow = cur.closest('.row');
        const expandBtn = curRow?.querySelector('.row-expand-btn');
        if (expandBtn) {
          expandBtn.focus();
          expandBtn.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
        }
      }
      return;
    }

    if (dir === 'right') {
      if (idx !== -1 && idx < trackItems.length - 1) {
        const target = trackItems[idx + 1];
        target.focus();
        target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
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
          const target = prevItems[Math.min(idx >= 0 ? idx : 0, prevItems.length - 1)];
          target.focus();
          prevRow.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
          target.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
          return;
        }
      } else {
        // Primera fila: subir al header
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
          const target = nextItems[Math.min(idx >= 0 ? idx : 0, nextItems.length - 1)];
          target.focus();
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
    if (dir === 'left') {
      const reload = curHeader.querySelector('#btn-reload');
      if (reload && cur !== reload) {
        reload.focus();
      }
      return;
    }
    if (dir === 'right') {
      const profile = curHeader.querySelector('#btn-change-profile');
      if (profile && cur !== profile) {
        profile.focus();
      }
      return;
    }
    if (dir === 'down') {
      const firstRow = document.querySelector('.row');
      const firstCard = firstRow?.querySelector('.row-track [data-focusable]') || document.querySelector('.row-track [data-focusable]');
      if (firstCard) {
        firstCard.focus();
        firstRow?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        firstCard.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
      }
      return;
    }
    if (dir === 'up') {
      return;
    }
  }

  // 3. Si está dentro de la ficha de detalle (.detail)
  const detailScreen = cur.closest('.detail');
  if (detailScreen && !modalEl) {
    const backBtn = detailScreen.querySelector('#d-back');
    const fixMetaBtn = detailScreen.querySelector('#d-fix-meta');
    const synToggle = detailScreen.querySelector('.btn-syn-toggle:not([hidden])');
    const playBtn = detailScreen.querySelector('#d-play');
    const seasonActive = detailScreen.querySelector('.seasons-track .season-btn.active') || detailScreen.querySelector('.seasons-track .season-btn');
    const curSeasonTrack = cur.closest('.seasons-track');
    const curEpList = cur.closest('#ep-list');

    // 3.1 Botón Volver (#d-back)
    if (cur === backBtn) {
      if (dir === 'right') {
        if (fixMetaBtn) {
          fixMetaBtn.focus();
          fixMetaBtn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'down') {
        const target = synToggle || playBtn || seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
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
      if (dir === 'down') {
        const target = synToggle || playBtn || seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
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
        const target = backBtn || fixMetaBtn;
        if (target) {
          target.focus();
          target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }
        return;
      }
      if (dir === 'down') {
        const target = playBtn || seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
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
        if (fixMetaBtn) {
          fixMetaBtn.focus();
          fixMetaBtn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
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
      if (dir === 'down') {
        const target = seasonActive || detailScreen.querySelector('#ep-list .ep[data-focusable]');
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
        if (fixMetaBtn) {
          fixMetaBtn.focus();
          fixMetaBtn.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
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
        const target = playBtn || synToggle || backBtn;
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
      const epItems = [...curEpList.querySelectorAll('.ep[data-focusable]')].filter(e => e.offsetParent && !e.disabled);
      const epIdx = epItems.indexOf(cur);
      if (dir === 'up') {
        if (epIdx > 0) {
          epItems[epIdx - 1].focus();
          epItems[epIdx - 1].scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        } else {
          const target = seasonActive || playBtn || synToggle || backBtn;
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
      score = Math.abs(dx) + Math.abs(dy) * 6 + rowPenalty;
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
    if (activePlayerController && !document.querySelector('.settings-overlay')) {
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
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'MediaPlayPause' || e.key === 'Play' || e.key === 'Pause') {
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
