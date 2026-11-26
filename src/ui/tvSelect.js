// src/ui/tvSelect.js
// Selector de opciones compatible con mando (Android TV / Fire TV / teclado).
// Los <select> nativos no se abren con click() ni con OK del D-Pad dentro del WebView de
// Android TV, así que mostramos una lista propia que actualiza el <select> original y
// lanza los eventos 'input' y 'change' como si el usuario lo hubiera cambiado.
// Estilos en src/styles/settings.css (clases .tv-select-*), basados en variables de skin.

let activePicker = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function isBackKey(e) {
  return ['Escape', 'GoBack', 'Back', 'Backspace'].includes(e.key) || e.keyCode === 4 || e.keyCode === 27;
}

function isOkKey(e) {
  return e.key === 'Enter' || e.key === ' ' || e.key === 'Select' || e.keyCode === 13 || e.keyCode === 23;
}

function selectLabel(select) {
  const labelEl = select.closest('label');
  const span = labelEl?.querySelector('span');
  const text = (span?.textContent || select.getAttribute('aria-label') || select.name || 'Elegir opción').trim();
  return text.replace(/:\s*$/, '');
}

export function isSelectPickerOpen() {
  return Boolean(activePicker && document.body.contains(activePicker.overlay));
}

export function closeSelectPicker({ restoreFocus = true } = {}) {
  if (!activePicker) return;
  const { overlay, select } = activePicker;
  activePicker = null;
  overlay.remove();
  if (restoreFocus && select && document.body.contains(select)) {
    try { select.focus({ preventScroll: true }); } catch (_) { select.focus(); }
  }
}

function choose(select, value) {
  if (select.value !== value) {
    select.value = value;
    select.dispatchEvent(new Event('input', { bubbles: true }));
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  closeSelectPicker();
}

/**
 * Abre la lista de opciones del <select> indicado.
 */
export function openSelectPicker(select) {
  if (!select || select.tagName !== 'SELECT' || select.disabled) return false;
  closeSelectPicker({ restoreFocus: false });

  const options = [...select.options].filter(o => !o.hidden);
  if (!options.length) return false;

  const overlay = document.createElement('div');
  overlay.className = 'tv-select-overlay';
  overlay.innerHTML = `
    <div class="tv-select-dialog" role="listbox" aria-label="${esc(selectLabel(select))}">
      <div class="tv-select-title">${esc(selectLabel(select))}</div>
      <div class="tv-select-list">
        ${options.map(o => `
          <button type="button" class="tv-select-option ${o.selected ? 'is-selected' : ''}" role="option"
            aria-selected="${o.selected}" data-focusable data-value="${esc(o.value)}" ${o.disabled ? 'disabled' : ''}>
            <span class="tv-select-check" aria-hidden="true">${o.selected ? '✓' : ''}</span>
            <span class="tv-select-text">${esc(o.textContent)}</span>
          </button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  activePicker = { overlay, select };

  const buttons = [...overlay.querySelectorAll('.tv-select-option')].filter(b => !b.disabled);
  const focusAt = (i) => {
    const b = buttons[Math.max(0, Math.min(buttons.length - 1, i))];
    if (!b) return;
    b.focus({ preventScroll: true });
    b.scrollIntoView({ block: 'nearest' });
  };

  buttons.forEach(b => b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    choose(select, b.dataset.value);
  }));

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { e.stopPropagation(); closeSelectPicker(); }
  });

  // Control de teclado propio: no dejamos que el evento llegue al modal de ajustes
  overlay.addEventListener('keydown', (e) => {
    const idx = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      const next = idx === -1 ? 0 : (idx + delta + buttons.length) % buttons.length;
      focusAt(next);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      e.stopPropagation();
    } else if (isOkKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      if (idx !== -1) choose(select, buttons[idx].dataset.value);
    } else if (isBackKey(e)) {
      e.preventDefault();
      e.stopPropagation();
      closeSelectPicker();
    }
  });

  const selectedIdx = buttons.findIndex(b => b.classList.contains('is-selected'));
  focusAt(selectedIdx === -1 ? 0 : selectedIdx);
  return true;
}
