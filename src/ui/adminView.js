// src/ui/adminView.js
// Pantalla completa del Panel de Administración para perfiles, canales, reenvíos, subidas y listados.
import { setBackHandler } from './dpad.js';
import { applyProfileScale, profileAvatar } from './settings.js';
import { resolveTitleAgeRating } from './ageRating.js';
import { createKV } from '../core/kv.js';
import { renderChannelsTab } from './adminChannels.js';
import { renderForwardedTab } from './adminForwarded.js';
import { renderUploadTab } from './adminUpload.js';

const kv = createKV();
const LIB_KEY = 'library_v2';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const AGE_RATING_OPTIONS = [
  { id: 'all', label: 'Sin límite (Todo)', desc: 'Permite todo el contenido sin restricciones.' },
  { id: '18', label: 'Hasta 18 años', desc: 'Permite hasta +18 y bloquea contenido clasificado como Adulto/X.' },
  { id: '16', label: 'Hasta 16 años', desc: 'Bloquea contenido para mayores de 18 años y X.' },
  { id: '12', label: 'Hasta 12 años', desc: 'Bloquea contenido clasificado para mayores de 16, 18 y X.' },
  { id: '7', label: 'Hasta 7 años', desc: 'Contenido apto para público familiar e infantil (máx. 7 años).' },
  { id: 'APTA', label: 'Solo APTA', desc: 'Únicamente títulos recomendados para todos los públicos.' },
];

export async function showAdminView({ tg, sync, profile, titles = [], onBack }) {
  applyProfileScale(profile);

  let currentTab = 'age';
  let client = null;
  try {
    client = tg?.getClient?.() || (typeof window !== 'undefined' && window.tg?.getClient?.());
  } catch (_) {}

  const handleBack = () => {
    onBack?.();
  };
  setBackHandler(handleBack);

  const initialHtml = `
    <div class="screen admin-screen">
      <header class="admin-header">
        <button class="btn-icon" data-focusable id="admin-btn-back" title="Volver al inicio" aria-label="Volver">←</button>
        <div class="admin-header-title">
          <h1>Panel de Administración</h1>
          <span class="admin-header-sub">Gestión integral de perfiles, canales, reenvíos, subida de archivos y listados</span>
        </div>
        <div class="admin-header-profile">
          <span>${esc(profile?.name || 'Administrador')}</span>
        </div>
      </header>

      <div class="admin-layout">
        <aside class="admin-sidebar" role="tablist" aria-label="Secciones de administración">
          <button class="admin-tab-btn is-active" data-focusable data-tab="age" role="tab" aria-selected="true">
            <span class="admin-tab-icon">🔞</span>
            <span class="admin-tab-label">Filtros de edad a perfiles</span>
          </button>
          <button class="admin-tab-btn" data-focusable data-tab="channels" role="tab" aria-selected="false">
            <span class="admin-tab-icon">📡</span>
            <span class="admin-tab-label">Añadir canales/grupos/temas Externos</span>
          </button>
          <button class="admin-tab-btn" data-focusable data-tab="forwarded" role="tab" aria-selected="false">
            <span class="admin-tab-icon">🔄</span>
            <span class="admin-tab-label">Listar vídeos reenviados</span>
          </button>
          <button class="admin-tab-btn" data-focusable data-tab="upload" role="tab" aria-selected="false">
            <span class="admin-tab-icon">📤</span>
            <span class="admin-tab-label">Subir archivos</span>
          </button>
          <button class="admin-tab-btn" data-focusable data-tab="listings" role="tab" aria-selected="false">
            <span class="admin-tab-icon">📊</span>
            <span class="admin-tab-label">Listados</span>
          </button>
        </aside>

        <main class="admin-main" id="admin-main-panel" role="tabpanel">
          <!-- Contenido dinámico -->
        </main>
      </div>
    </div>
  `;

  const appEl = document.getElementById('app');
  if (appEl) appEl.innerHTML = initialHtml;
  window.scrollTo(0, 0);

  const backBtn = document.getElementById('admin-btn-back');
  backBtn?.addEventListener('click', handleBack);

  const tabButtons = document.querySelectorAll('.admin-tab-btn');
  const mainPanel = document.getElementById('admin-main-panel');

  const switchTab = (tabId) => {
    currentTab = tabId;
    tabButtons.forEach(btn => {
      const active = btn.dataset.tab === tabId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });

    if (tabId === 'age') renderAgeFiltersTab();
    else if (tabId === 'channels') renderChannelsTab({ mainPanel, client, kv, titles, tg });
    else if (tabId === 'forwarded') renderForwardedTab({ mainPanel, client, tg });
    else if (tabId === 'upload') renderUploadTab({ mainPanel, client, tg });
    else if (tabId === 'listings') renderListingsTab();
  };

  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });

  // ==========================================
  // 1. FILTROS DE EDAD A PERFILES
  // ==========================================
  async function renderAgeFiltersTab() {
    mainPanel.innerHTML = `
      <div class="admin-panel-header">
        <div class="admin-panel-title">
          <h2>Filtros de edad a perfiles</h2>
          <p>Configura la clasificación máxima permitida para cada perfil de esta cuenta.</p>
        </div>
        <button class="btn-primary" data-focusable id="btn-save-age-filters">Guardar cambios</button>
      </div>
      <div id="admin-profiles-list">
        <p style="color:#aaa;">Cargando perfiles...</p>
      </div>
    `;

    const container = document.getElementById('admin-profiles-list');
    let loadedProfiles = [];

    try {
      if (sync?.listProfiles) {
        loadedProfiles = await sync.listProfiles();
      }
    } catch (e) {
      console.warn('Error listando perfiles para filtros de edad', e);
    }

    if (!loadedProfiles || loadedProfiles.length === 0) {
      if (profile) loadedProfiles = [profile];
    }

    // Filtrar perfiles fantasma 'perfil' y asegurar que el perfil actual esté incluido
    const validProfiles = (loadedProfiles || []).filter(p => {
      const pId = p.id || p.name;
      return pId && pId !== 'perfil';
    });

    if (profile && profile.id && profile.id !== 'perfil') {
      if (!validProfiles.some(p => (p.id || p.name) === (profile.id || profile.name))) {
        validProfiles.unshift(profile);
      }
    }

    const workingProfiles = validProfiles.map(p => {
      const pId = p.id || p.name;
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(`tgvideo_max_age_${pId}`) : null;
      let effectiveAge = p.maxAgeRating || stored;
      if (!effectiveAge) {
        if (p.age_limit === 'TP') effectiveAge = 'APTA';
        else if (p.age_limit) effectiveAge = p.age_limit.replace('+', '');
        else effectiveAge = 'all';
      }
      return {
        ...p,
        maxAgeRating: effectiveAge,
      };
    });

    if (workingProfiles.length === 0) {
      container.innerHTML = `<p style="color:#aaa;">No se encontraron perfiles registrados en esta cuenta.</p>`;
      return;
    }

    container.innerHTML = workingProfiles.map((p, idx) => `
      <div class="admin-profile-card">
        <div class="admin-profile-header">
          <div class="admin-profile-info">
            <div class="avatar admin-profile-avatar-wrap">
              ${profileAvatar(p)}
            </div>
            <div>
              <div class="admin-profile-name">${esc(p.name || p.id)}</div>
              <small style="color:#888;">ID: ${esc(p.id)}</small>
            </div>
          </div>
          <span class="admin-profile-badge">
            ${p.is_kids ? 'Perfil Infantil' : 'Perfil General'}
          </span>
        </div>

        <div style="font-size:0.85rem;color:#bbb;margin-top:0.2rem;">
          Clasificación máxima permitida:
        </div>

        <div class="admin-age-selector" data-profile-idx="${idx}">
          ${AGE_RATING_OPTIONS.map(opt => `
            <button type="button" class="admin-age-pill ${p.maxAgeRating === opt.id ? 'is-active' : ''}"
              data-focusable
              data-age="${esc(opt.id)}"
              title="${esc(opt.desc)}">
              ${esc(opt.label)}
            </button>
          `).join('')}
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.admin-age-selector').forEach(sel => {
      const idx = Number(sel.dataset.profileIdx);
      sel.querySelectorAll('.admin-age-pill').forEach(pill => {
        pill.addEventListener('click', () => {
          sel.querySelectorAll('.admin-age-pill').forEach(el => el.classList.remove('is-active'));
          pill.classList.add('is-active');
          const chosenAge = pill.dataset.age;
          workingProfiles[idx].maxAgeRating = chosenAge;
          const pId = workingProfiles[idx].id || workingProfiles[idx].name;
          if (pId && pId !== 'perfil' && typeof localStorage !== 'undefined') {
            localStorage.setItem(`tgvideo_max_age_${pId}`, chosenAge);
          }
        });
      });
    });

    const saveBtn = document.getElementById('btn-save-age-filters');
    saveBtn?.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando…';
      try {
        for (const p of workingProfiles) {
          const pId = p.id || p.name;
          if (!pId || pId === 'perfil') continue;
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(`tgvideo_max_age_${pId}`, p.maxAgeRating);
          }
          if (sync?.pushProfile) {
            await sync.pushProfile({
              profile: {
                ...p,
                maxAgeRating: p.maxAgeRating,
              }
            });
          }
        }
        if (profile) {
          const updatedSelf = workingProfiles.find(x => (x.id || x.name) === (profile.id || profile.name));
          if (updatedSelf) profile.maxAgeRating = updatedSelf.maxAgeRating;
        }
        saveBtn.textContent = '✓ Guardado correctamente';
        setTimeout(() => {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Guardar cambios';
          }
        }, 2200);
      } catch (err) {
        console.error('Error guardando filtros de edad', err);
        saveBtn.disabled = false;
        saveBtn.textContent = 'Error al guardar';
      }
    });
  }

  // ==========================================
  // 5. LISTADOS
  // ==========================================
  async function renderListingsTab() {
    mainPanel.innerHTML = `
      <div class="admin-panel-header"><div class="admin-panel-title"><h2>Listados</h2><p>Consulta las calificaciones detectadas y revisa los canales y vídeos activos en la biblioteca.</p></div></div>
      <div class="admin-listings-layout">
        <div class="admin-listings-actions">
          <button class="btn-primary" data-focusable id="btn-list-age-ratings" style="width:100%;text-align:left;padding:.85rem 1rem;">Listar calificaciones de edades</button>
          <button class="btn-primary" data-focusable id="btn-list-library-channels" style="width:100%;text-align:left;padding:.85rem 1rem;margin-top:.65rem;">Listar canales y videos</button>
        </div>
        <div class="admin-listings-results" id="admin-listings-results"><p style="color:#aaa;">Selecciona una opción para generar su informe.</p></div>
      </div>`;
    const resultsArea = document.getElementById('admin-listings-results');
    const ageBtn = document.getElementById('btn-list-age-ratings');
    const channelsBtn = document.getElementById('btn-list-library-channels');

    ageBtn?.addEventListener('click', async () => {
      ageBtn.disabled = true; ageBtn.textContent = 'Calculando…';
      resultsArea.innerHTML = '<p style="color:#38bdf8;">Analizando clasificaciones por edad de cada archivo…</p>';
      try {
        let allTitles = Array.isArray(titles) ? titles : [];
        if (!allTitles.length) {
          const saved = await kv.get(LIB_KEY).catch(() => null);
          allTitles = Object.values(saved?.cache || {}).flatMap(files => Array.isArray(files) ? files.map(f => ({ nombre: f.label || f.fileName, archivos: [f], ageRating: f.ageRating, metadata: { ageRating: f.ageRating } })) : []);
        }
        const filesByKey = new Map();
        for (const title of allTitles) {
          for (const file of title.archivos || []) {
            const key = `${title.origen?.channelId || title.channel?.id || ''}:${file.messageId || file.id || file.fileName || ''}`;
            if (!filesByKey.has(key)) filesByKey.set(key, { title, file });
          }
        }
        const known = [
          { raw: 'APTA', label: 'APTA (Todos los públicos)', color: '#0284c7' },
          { raw: '7', label: 'Hasta 7 años (+7)', color: '#22c55e' },
          { raw: '12', label: 'Hasta 12 años (+12)', color: '#eab308' },
          { raw: '16', label: 'Hasta 16 años (+16)', color: '#f97316' },
          { raw: '18', label: 'Hasta 18 años (+18)', color: '#ef4444' },
          { raw: 'X', label: 'Adultos / Contenido X', color: '#dc2626' },
          { raw: 'NR', label: 'Sin clasificar / No especificada', color: '#94a3b8' },
        ];
        const buckets = new Map(known.map(x => [x.raw.toUpperCase(), { ...x, count: 0, files: [] }]));
        for (const { title, file } of filesByKey.values()) {
          const info = resolveTitleAgeRating({ nombre: file.label || file.fileName || title.nombre, archivos: [file], ageRating: file.ageRating, metadata: { ageRating: file.ageRating } });
          const raw = String(file.ageRating || file.metadata?.ageRating || info?.raw || info?.label || 'NR').trim();
          const key = raw.toUpperCase();
          if (!buckets.has(key)) buckets.set(key, { raw, label: `Calificación detectada: ${raw}`, color: '#a78bfa', count: 0, files: [] });
          const bucket = buckets.get(key); bucket.count += 1;
          if (bucket.files.length < 30) bucket.files.push(file.label || file.fileName || title.nombre || 'Archivo sin nombre');
        }
        const totalFiles = [...buckets.values()].reduce((n, b) => n + b.count, 0);
        const dynamic = [...buckets.values()].filter(b => !known.some(k => k.raw.toUpperCase() === b.raw.toUpperCase()));
        const ordered = [...known.map(k => buckets.get(k.raw)).filter(Boolean), ...dynamic.sort((a,b) => a.raw.localeCompare(b.raw, 'es', { numeric: true }))];
        resultsArea.innerHTML = `
          <div class="admin-stat-summary-bar"><div class="admin-stat-summary-box"><span class="admin-stat-summary-num">${totalFiles}</span><span class="admin-stat-summary-label">Archivos analizados</span></div><div class="admin-stat-summary-box"><span class="admin-stat-summary-num">${dynamic.length}</span><span class="admin-stat-summary-label">Calificaciones adicionales detectadas</span></div></div>
          <div style="display:flex;flex-direction:column;gap:.85rem;margin-top:.5rem;">
          ${ordered.map((b,i) => { const pct = totalFiles ? (b.count / totalFiles * 100).toFixed(1) : '0.0'; return `<div class="admin-age-stat-card"><div class="admin-age-stat-header"><div class="admin-age-stat-main"><span class="admin-age-stat-pill" style="color:${b.color};border-color:${b.color};background:${b.color}15;">${esc(b.raw)}</span><div><strong style="color:#fff;font-size:.95rem">${esc(b.label)}</strong><div style="font-size:.8rem;color:#888">${pct}% de los archivos</div></div></div><div style="display:flex;align-items:center;gap:1rem"><span class="admin-age-stat-count">${b.count} archivos</span>${b.count ? `<button class="btn-secondary admin-btn-sm btn-toggle-age-files" data-index="${i}">Ver archivos ▼</button>` : ''}</div></div><div class="admin-stat-progress-bar"><div class="admin-stat-progress-fill" style="width:${pct}%;background:${b.color}"></div></div>${b.count ? `<div class="admin-titles-dropdown" id="age-files-${i}" style="display:none">${b.files.map(n => `<div>• ${esc(n)}</div>`).join('')}${b.count > b.files.length ? `<div style="color:#888;font-style:italic">… y ${b.count - b.files.length} más</div>` : ''}</div>` : ''}</div>`; }).join('')}
          </div>`;
        resultsArea.querySelectorAll('.btn-toggle-age-files').forEach(btn => btn.addEventListener('click', () => { const list = document.getElementById(`age-files-${btn.dataset.index}`); const open = list.style.display === 'none'; list.style.display = open ? 'flex' : 'none'; btn.textContent = open ? 'Ocultar ▲' : 'Ver archivos ▼'; }));
      } catch (err) { console.error(err); resultsArea.innerHTML = `<p style="color:#f87171">Error al calcular el listado: ${esc(err.message || err)}</p>`; }
      finally { ageBtn.disabled = false; ageBtn.textContent = 'Listar calificaciones de edades'; }
    });

    channelsBtn?.addEventListener('click', async () => {
      channelsBtn.disabled = true; channelsBtn.textContent = 'Cargando…';
      resultsArea.innerHTML = '<p style="color:#38bdf8;">Organizando canales y vídeos identificados…</p>';
      try {
        let allTitles = Array.isArray(titles) ? [...titles] : [];
        const saved = await kv.get(LIB_KEY).catch(() => null);
        const extSaved = (await kv.get('external_sources_v1').catch(() => [])) || [];
        const extIds = new Set(extSaved.map(x => String(x.id)));

        if (!allTitles.length) {
          allTitles = Object.entries(saved?.cache || {}).flatMap(([cId, files]) =>
            Array.isArray(files) ? files.map(f => ({
              nombre: f.label || f.fileName,
              origen: { channelId: f.channelId || cId },
              channel: f.channel || { id: cId, title: f.title || cId },
              archivos: [f]
            })) : []
          );
        }

        const channels = new Map();
        for (const title of allTitles) {
          const channel = title.channel || {};
          const channelId = String(title.origen?.channelId || channel.id || '');
          if (!channelId) continue;
          const isExt = extIds.has(channelId) || Boolean(channel.isExternal);
          if (!channels.has(channelId)) {
            channels.set(channelId, {
              id: channelId,
              name: channel.title || channel.name || channel.group || `Canal ${channelId}`,
              isExternal: isExt,
              files: new Map(),
            });
          }
          const entry = channels.get(channelId);
          if (isExt) entry.isExternal = true;
          for (const file of title.archivos || []) {
            const messageId = String(file.messageId || file.id || file.fileName || '');
            if (!entry.files.has(messageId)) {
              entry.files.set(messageId, {
                shownName: file.label || file.displayName || title.nombre || file.fileName || 'Sin nombre',
                filename: file.fileName || '',
                title: title.nombre || '',
                category: channel.category || ''
              });
            }
          }
        }

        // Ordenar: canales externos añadidos VAN DE PRIMEROS, y dentro de cada grupo alfabético
        const sorted = [...channels.values()]
          .filter(c => c.files.size)
          .sort((a, b) => {
            if (a.isExternal && !b.isExternal) return -1;
            if (!a.isExternal && b.isExternal) return 1;
            return a.name.localeCompare(b.name, 'es');
          });

        if (!sorted.length) {
          resultsArea.innerHTML = '<p style="color:#aaa;">No hay canales con vídeos identificados en la biblioteca actual.</p>';
          return;
        }

        resultsArea.innerHTML = `<p style="color:#aaa;margin-bottom:1rem">${sorted.length} canales activos con vídeos detectados (canales externos al principio).</p><div class="admin-accordion-list">${sorted.map((channel,i) => `<div class="admin-accordion-item"><div class="admin-accordion-header library-channel-header" data-index="${i}"><div style="display:flex;align-items:center;gap:.75rem"><strong>${esc(channel.name)}</strong>${channel.isExternal ? '<span class="admin-badge admin-badge-channel" style="background:#0284c7;color:#fff;border-color:#38bdf8;">Externo</span>' : ''}<span>${channel.files.size} vídeos</span>${channel.files.values().next().value?.category ? `<small>${esc(channel.files.values().next().value.category)}</small>` : ''}</div><span>▼</span></div><div class="admin-accordion-content" id="library-channel-${i}" style="display:none;flex-direction:column">${[...channel.files.values()].sort((a,b) => a.shownName.localeCompare(b.shownName, 'es')).map(file => `<div class="admin-video-row" style="align-items:flex-start"><div style="display:flex;flex-direction:column;gap:.2rem"><strong>${esc(file.shownName)}</strong>${file.filename && file.filename !== file.shownName ? `<small style="color:#888">Archivo: ${esc(file.filename)}</small>` : ''}</div>${file.title ? `<span style="color:#aaa">${esc(file.title)}</span>` : ''}</div>`).join('')}</div></div>`).join('')}</div>`;
        resultsArea.querySelectorAll('.library-channel-header').forEach(header => header.addEventListener('click', () => { const list = document.getElementById(`library-channel-${header.dataset.index}`); list.style.display = list.style.display === 'none' ? 'flex' : 'none'; }));
      } catch (err) { console.error(err); resultsArea.innerHTML = `<p style="color:#f87171">Error al generar el listado: ${esc(err.message || err)}</p>`; }
      finally { channelsBtn.disabled = false; channelsBtn.textContent = 'Listar canales y videos'; }
    });
  }

  // Carga inicial
  renderAgeFiltersTab();
}
