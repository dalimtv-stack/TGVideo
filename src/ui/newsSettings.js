// src/ui/newsSettings.js
// "Configurar Novedades": orden de las filas "Novedades · Películas" y "Novedades · Series".
import { modal } from './settings.js';
import { NEWS_MODES, getNewsPrefs, setNewsPref } from '../library/newsPrefs.js';

const SECTIONS = [
  { kind: 'movies', title: 'Novedades · Películas', release: 'Fecha de estreno de la película' },
  { kind: 'series', title: 'Novedades · Series', release: 'Fecha de emisión del último capítulo' },
];

export function showNewsSettings(profile, sync, onChanged) {
  const prefs = getNewsPrefs(profile);
  let changed = false;
  const sectionHtml = (s) => `
    <fieldset class="news-section" data-kind="${s.kind}">
      <legend>${s.title}</legend>
      ${['upload', 'release'].map((mode) => `
        <button type="button" class="settings-radio-label news-option ${prefs[s.kind] === mode ? 'is-checked' : ''}" data-focusable data-kind="${s.kind}" data-mode="${mode}" role="radio" aria-checked="${prefs[s.kind] === mode}">
          <div class="settings-radio-info">
            <strong>${mode === 'upload' ? NEWS_MODES.upload : s.release}</strong>
            <small>${mode === 'upload' ? 'Más recientes primero' : 'Más recientes primero (estreno o emisión)'}</small>
          </div>
        </button>`).join('')}
    </fieldset>`;

  const { overlay } = modal('Configurar Novedades', `
    <div class="news-settings">
      ${SECTIONS.map(sectionHtml).join('')}
      <p class="settings-status">La fila muestra hasta 30 títulos; con "+" se ven hasta 60.</p>
    </div>`, 'Elige cómo se ordenan las novedades de la home', () => { if (changed) onChanged?.(); });

  overlay.querySelectorAll('.news-option').forEach((btn) => {
    btn.onclick = () => {
      setNewsPref(profile, btn.dataset.kind, btn.dataset.mode, sync);
      overlay.querySelectorAll(`.news-option[data-kind="${btn.dataset.kind}"]`).forEach((b) => {
        const on = b === btn;
        b.classList.toggle('is-checked', on);
        b.setAttribute('aria-checked', String(on));
      });
      changed = true;
    };
  });
}
