export function modal(title, body, subtitle = '') {
  const previousFocus = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  const subtitleHtml = subtitle ? `<div class="modal-subtitle" style="font-size:0.85rem;color:#aaa;margin-top:0.35rem;font-weight:normal;word-break:break-word;">${subtitle}</div>` : '';
  overlay.innerHTML = `<section class="settings-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header style="align-items:flex-start;"><div><h2 style="font-size:1.15rem;word-break:break-all;line-height:1.35;">${esc(title)}</h2>${subtitleHtml}</div><button class="btn-icon" data-focusable aria-label="Cerrar">×</button></header>${body}</section>`;
  document.body.append(overlay);
  const close = () => { overlay.remove(); previousFocus?.focus({ preventScroll: true }); };
  overlay.querySelector('[aria-label="Cerrar"]').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', e => {
    if (['Escape', 'Backspace', 'GoBack'].includes(e.key) && !['INPUT', 'TEXTAREA'].includes(e.target.tagName)) { e.preventDefault(); e.stopPropagation(); close(); }
    if (e.key === 'Tab') {
      const items = [...overlay.querySelectorAll('button, input, select')].filter(el => !el.disabled);
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  });
  return { overlay, close };
}
