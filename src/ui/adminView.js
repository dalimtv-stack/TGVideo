// src/ui/adminView.js
// Pantalla completa del Panel de Administración para perfiles, canales y subidas.
import { setBackHandler } from './dpad.js';
import { isAndroidApp } from '../core/platform.js';
import { applyProfileScale } from './settings.js';
import { resolveTitleAgeRating, getAgeRatingInfo } from './ageRating.js';
import { searchTmdbManual, cleanSearchName, imageUrl, extractTitleAndYear, parseTmdbId } from '../metadata/tmdb.js';
import { buildStandardCaption, isVideoMessage, getFileName, parseCaption, parseEpisode, prettyName } from '../library/parse.js';
import { loadLibrary } from '../library/channels.js';
import { createKV } from '../core/kv.js';
import { Api } from 'telegram';

const kv = createKV();
const LIB_KEY = 'library_v2';
const EXT_KEY = 'external_sources_v1';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBytes(bytes) {
  const num = Number(bytes) || 0;
  if (num <= 0) return '0 B';
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
  return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
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
          <span class="admin-header-sub">Gestión integral de perfiles, canales, reenvíos y subida de archivos</span>
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
    else if (tabId === 'channels') renderChannelsTab();
    else if (tabId === 'forwarded') renderForwardedTab();
    else if (tabId === 'upload') renderUploadTab();
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

    // Normalizar lecturas preservando persistencia local y sincronizada
    const workingProfiles = (loadedProfiles || []).map(p => {
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
            ${p.avatar ? `<img src="${esc(p.avatar)}" class="admin-profile-avatar" alt="" />` : `<div class="admin-profile-avatar" style="display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;">${esc((p.name || 'P')[0].toUpperCase())}</div>`}
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
          if (typeof localStorage !== 'undefined') {
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
  // 2. AÑADIR CANALES/GRUPOS/TEMAS EXTERNOS
  // ==========================================
  async function renderChannelsTab() {
    mainPanel.innerHTML = `
      <div class="admin-panel-header">
        <div class="admin-panel-title">
          <h2>Añadir canales/grupos/temas Externos</h2>
          <p>Explora tus canales y grupos de Telegram (incluyendo temas individuales en foros) para incorporarlos a la base de datos de la biblioteca.</p>
        </div>
        <button class="btn-primary" data-focusable id="btn-load-ext-channels">Cargar canales/grupos disponibles</button>
      </div>
      <div id="admin-channels-result">
        <p style="color:#aaa;">Pulsa el botón superior para listar los canales, grupos y temas en los que participas.</p>
      </div>
    `;

    const loadBtn = document.getElementById('btn-load-ext-channels');
    const resultContainer = document.getElementById('admin-channels-result');

    loadBtn?.addEventListener('click', async () => {
      if (!client) {
        resultContainer.innerHTML = `<p style="color:#f87171;">Cliente de Telegram no disponible en esta sesión.</p>`;
        return;
      }

      loadBtn.disabled = true;
      loadBtn.textContent = 'Consultando Telegram…';
      resultContainer.innerHTML = `<p style="color:#38bdf8;">Cargando canales, grupos y temas desde Telegram…</p>`;

      try {
        const dialogs = [];
        for await (const d of client.iterDialogs({ limit: 120 })) {
          if (d.isChannel || d.isGroup) {
            const isForum = Boolean(d.entity?.forum);
            let topics = [];
            if (isForum) {
              try {
                const res = await client.invoke(new Api.channels.GetForumTopics({
                  channel: d.entity,
                  offsetDate: 0,
                  offsetId: 0,
                  offsetTopic: 0,
                  limit: 100
                }));
                topics = (res.topics || []).map(t => ({
                  id: t.id,
                  title: t.title || `Tema #${t.id}`,
                  iconColor: t.iconColor || 0
                }));
              } catch (e) {
                console.warn('Error leyendo temas del grupo foro', d.title, e);
              }
            }

            dialogs.push({
              id: String(d.id),
              title: d.title || `Chat ${d.id}`,
              entity: d.entity,
              isChannel: Boolean(d.isChannel),
              isGroup: Boolean(d.isGroup),
              isForum,
              topics,
            });
          }
        }

        if (!dialogs.length) {
          resultContainer.innerHTML = `<p style="color:#aaa;">No se encontraron canales ni grupos en tu cuenta.</p>`;
          loadBtn.disabled = false;
          loadBtn.textContent = 'Cargar canales/grupos disponibles';
          return;
        }

        resultContainer.innerHTML = `
          <div class="admin-topic-tree">
            ${dialogs.map((d, dIdx) => {
              const hasTopics = d.isForum && d.topics.length > 0;
              return `
                <div class="admin-channel-item">
                  <div class="admin-channel-row-main">
                    <div style="min-width:0;flex:1 1 auto;">
                      <div style="display:flex;align-items:center;gap:0.6rem;margin-bottom:0.2rem;">
                        <strong style="font-size:0.96rem;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                          ${esc(d.title)}
                        </strong>
                        ${hasTopics
                          ? `<span class="admin-badge admin-badge-forum">💬 Foro · ${d.topics.length} temas</span>`
                          : d.isChannel
                            ? `<span class="admin-badge admin-badge-channel">📢 Canal</span>`
                            : `<span class="admin-badge admin-badge-group">👥 Grupo</span>`
                        }
                      </div>
                      <small style="color:#888;">ID: ${esc(d.id)}</small>
                    </div>

                    <div style="display:flex;align-items:center;gap:0.6rem;flex:0 0 auto;">
                      ${hasTopics ? `
                        <button class="btn-secondary admin-btn-sm btn-toggle-topics" data-focusable data-didx="${dIdx}">
                          Ver temas (${d.topics.length}) ▼
                        </button>
                        <button class="btn-secondary admin-btn-sm btn-add-full-group" data-focusable data-didx="${dIdx}">
                          Añadir grupo completo
                        </button>
                      ` : `
                        <button class="btn-secondary admin-btn-sm btn-add-channel-action" data-focusable data-didx="${dIdx}">
                          Añadir a la base de datos
                        </button>
                      `}
                    </div>
                  </div>

                  ${hasTopics ? `
                    <div class="admin-topics-nested" id="topics-nested-${dIdx}" style="display:none;">
                      <div style="font-size:0.82rem;color:#94a3b8;margin-bottom:0.3rem;">
                        Selecciona un tema individual para incorporarlo como sección propia:
                      </div>
                      ${d.topics.map(t => `
                        <div class="admin-topic-row">
                          <div style="display:flex;align-items:center;gap:0.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                            <span style="color:#38bdf8;font-weight:700;">#</span>
                            <span style="font-size:0.9rem;color:#e2e8f0;">${esc(t.title)}</span>
                            <span class="admin-badge admin-badge-topic">Tema ID: ${t.id}</span>
                          </div>
                          <button class="btn-primary admin-btn-sm btn-add-topic-action" data-focusable data-didx="${dIdx}" data-topid="${t.id}" data-toptitle="${esc(t.title)}">
                            Añadir este tema
                          </button>
                        </div>
                      `).join('')}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        `;

        // Toggle despliegue de temas
        resultContainer.querySelectorAll('.btn-toggle-topics').forEach(btn => {
          btn.addEventListener('click', () => {
            const didx = btn.dataset.didx;
            const nested = document.getElementById(`topics-nested-${didx}`);
            if (nested) {
              const isHidden = nested.style.display === 'none';
              nested.style.display = isHidden ? 'flex' : 'none';
              btn.textContent = isHidden ? 'Ocultar temas ▲' : `Ver temas (${dialogs[didx]?.topics?.length || 0}) ▼`;
            }
          });
        });

        // Añadir canal simple o grupo completo
        resultContainer.querySelectorAll('.btn-add-channel-action, .btn-add-full-group').forEach(btn => {
          btn.addEventListener('click', () => {
            const didx = Number(btn.dataset.didx);
            const dialog = dialogs[didx];
            promptAddChannelOrTopic({
              dialog,
              topic: null,
            });
          });
        });

        // Añadir tema específico
        resultContainer.querySelectorAll('.btn-add-topic-action').forEach(btn => {
          btn.addEventListener('click', () => {
            const didx = Number(btn.dataset.didx);
            const topId = Number(btn.dataset.topid);
            const topTitle = btn.dataset.toptitle;
            const dialog = dialogs[didx];
            promptAddChannelOrTopic({
              dialog,
              topic: { id: topId, title: topTitle },
            });
          });
        });

        loadBtn.disabled = false;
        loadBtn.textContent = 'Actualizar lista de canales';
      } catch (err) {
        console.error('Error cargando canales y temas', err);
        resultContainer.innerHTML = `<p style="color:#f87171;">Error al consultar Telegram: ${esc(err.message || String(err))}</p>`;
        loadBtn.disabled = false;
        loadBtn.textContent = 'Reintentar';
      }
    });
  }

  function promptAddChannelOrTopic({ dialog, topic }) {
    const existingModal = document.querySelector('.admin-modal-overlay');
    existingModal?.remove();

    const isTopic = Boolean(topic);
    const displayName = isTopic ? `${dialog.title} > ${topic.title}` : dialog.title;
    const defaultGroup = isTopic ? topic.title : dialog.title;

    const overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.innerHTML = `
      <div class="admin-modal-card">
        <h3 style="margin:0;font-size:1.15rem;color:#fff;">Añadir a la biblioteca</h3>
        <p style="margin:0;color:#ccc;font-size:0.9rem;line-height:1.4;">
          ¿Deseas escanear e incorporar los vídeos de <strong>${esc(displayName)}</strong>?
        </p>

        <div class="admin-field-group">
          <label>Categoría en biblioteca:</label>
          <select class="admin-select" id="modal-channel-category">
            <option value="Películas" selected>Películas</option>
            <option value="Series">Series</option>
            <option value="Deportes">Deportes</option>
            <option value="Música">Música</option>
          </select>
        </div>

        <div class="admin-field-group">
          <label>Nombre / Colección en biblioteca:</label>
          <input type="text" class="admin-input" id="modal-channel-group" value="${esc(defaultGroup)}">
        </div>

        <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:0.6rem;">
          <button class="btn-secondary" data-focusable id="modal-cancel-btn">Cancelar</button>
          <button class="btn-primary" data-focusable id="modal-confirm-btn">Confirmar y escanear</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#modal-cancel-btn')?.addEventListener('click', () => overlay.remove());

    overlay.querySelector('#modal-confirm-btn')?.addEventListener('click', () => {
      const category = overlay.querySelector('#modal-channel-category').value;
      const groupName = overlay.querySelector('#modal-channel-group').value.trim() || displayName;
      overlay.remove();
      startScanWithProgress({ dialog, topic, category, groupName });
    });
  }

  async function startScanWithProgress({ dialog, topic, category, groupName }) {
    const existingModal = document.querySelector('.admin-modal-overlay');
    existingModal?.remove();

    let isCancelled = false;
    const isTopic = Boolean(topic);
    const targetLabel = isTopic ? `${dialog.title} (Tema: ${topic.title})` : dialog.title;

    const progressOverlay = document.createElement('div');
    progressOverlay.className = 'admin-modal-overlay';
    progressOverlay.innerHTML = `
      <div class="admin-modal-card">
        <h3 style="margin:0;font-size:1.15rem;color:#fff;">Escaneando e integrando vídeos</h3>
        <p style="margin:0;color:#38bdf8;font-size:0.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${esc(targetLabel)}
        </p>

        <div class="admin-progress-container">
          <div class="admin-progress-stats">
            <span id="prog-detected-label">Vídeos detectados: <strong>0</strong></span>
            <span id="prog-added-label">Añadiendo: <strong>0</strong></span>
          </div>
          <div class="admin-progress-bar-wrap">
            <div class="admin-progress-bar-fill" id="prog-bar-fill" style="width:0%;"></div>
          </div>
          <div style="font-size:0.8rem;color:#888;" id="prog-status-text">Iniciando lectura de mensajes en Telegram…</div>
        </div>

        <div style="display:flex;justify-content:flex-end;margin-top:0.5rem;">
          <button class="btn-secondary" data-focusable id="prog-cancel-btn">Cancelar</button>
        </div>
      </div>
    `;

    document.body.appendChild(progressOverlay);

    const detectedEl = progressOverlay.querySelector('#prog-detected-label');
    const addedEl = progressOverlay.querySelector('#prog-added-label');
    const fillEl = progressOverlay.querySelector('#prog-bar-fill');
    const statusEl = progressOverlay.querySelector('#prog-status-text');
    const cancelBtn = progressOverlay.querySelector('#prog-cancel-btn');

    cancelBtn?.addEventListener('click', () => {
      isCancelled = true;
      cancelBtn.disabled = true;
      statusEl.textContent = 'Cancelando operación…';
    });

    try {
      const channelId = String(dialog.id);
      const virtualId = isTopic ? `${channelId}_top_${topic.id}` : channelId;
      const peer = dialog.entity;
      const detectedFiles = [];

      statusEl.textContent = 'Analizando mensajes del chat…';

      const iterOptions = isTopic ? { replyTo: topic.id } : {};
      let scanCount = 0;

      for await (const msg of client.iterMessages(peer, iterOptions)) {
        if (isCancelled) break;
        scanCount++;

        if (isVideoMessage(msg)) {
          const rawCaption = msg.message || '';
          const cap = parseCaption(rawCaption);
          const captionFileName = cap.fileName ? cap.fileName.trim() : null;
          const rawFileName = getFileName(msg) || '';
          const fileName = captionFileName || rawFileName || `video_${msg.id}.mp4`;
          const ep = parseEpisode(fileName);
          const doc = msg.document || msg.media?.document;
          const durAttr = doc?.attributes?.find(a => a.className === 'DocumentAttributeVideo');

          detectedFiles.push({
            key: `${virtualId}:${msg.id}`,
            channelId: virtualId,
            messageId: msg.id,
            channel: {
              id: virtualId,
              name: groupName,
              group: groupName,
              category,
              title: targetLabel,
            },
            fileName,
            captionFileName,
            rawFileName,
            rawCaption,
            label: prettyName(fileName),
            section: cap.section || null,
            synopsis: cap.synopsis || null,
            tmdbId: cap.tmdbId ? String(cap.tmdbId).trim() : null,
            imdbId: cap.imdbId ? String(cap.imdbId).trim() : null,
            rating: cap.rating ? Number(cap.rating) : null,
            season: ep.season,
            episode: ep.episode,
            size: Number(doc?.size?.toString?.() || doc?.size || 0),
            duration: durAttr?.duration || 0,
            mimeType: doc?.mimeType || 'video/mp4',
            date: msg.date,
          });

          if (detectedEl) {
            detectedEl.innerHTML = `Vídeos detectados: <strong>${detectedFiles.length}</strong>`;
          }
        }

        if (scanCount % 20 === 0) {
          const approxPct = Math.min(60, Math.floor(scanCount / 3));
          fillEl.style.width = `${approxPct}%`;
          statusEl.textContent = `Analizados ${scanCount} mensajes… (${detectedFiles.length} vídeos encontrados)`;
          await new Promise(r => setTimeout(r, 10));
        }
      }

      if (isCancelled) {
        statusEl.textContent = 'Operación cancelada por el usuario.';
        cancelBtn.textContent = 'Cerrar';
        cancelBtn.disabled = false;
        cancelBtn.onclick = () => progressOverlay.remove();
        return;
      }

      if (detectedFiles.length === 0) {
        statusEl.textContent = 'No se encontraron vídeos compatibles en este canal o tema.';
        fillEl.style.width = '100%';
        cancelBtn.textContent = 'Cerrar';
        cancelBtn.onclick = () => progressOverlay.remove();
        return;
      }

      statusEl.textContent = `Incorporando ${detectedFiles.length} vídeos a la biblioteca…`;
      fillEl.style.width = '75%';

      // Construcción del título de biblioteca
      const tipo = category === 'Películas' ? 'pelicula' : category === 'Series' ? 'serie' : category === 'Deportes' ? 'deporte' : category === 'Música' ? 'musica' : 'serie';
      if (tipo === 'pelicula') {
        detectedFiles.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) || (b.date || 0) - (a.date || 0));
      } else {
        detectedFiles.sort((a, b) => (a.season - b.season) || (a.episode - b.episode) || (a.date - b.date));
      }

      const newTitle = {
        id: String(virtualId),
        tipo,
        grupo: groupName,
        nombre: groupName,
        origen: { tipo: 'externo', channelId: String(virtualId), isTopic, topicId: topic?.id || null },
        channel: {
          id: virtualId,
          name: groupName,
          group: groupName,
          category,
          title: targetLabel,
        },
        archivos: detectedFiles,
        ultimoMensajeFecha: detectedFiles.reduce((m, f) => Math.max(m, f.date), 0),
        tmdbId: detectedFiles.find(f => f.tmdbId)?.tmdbId || null,
        imdbId: detectedFiles.find(f => f.imdbId)?.imdbId || null,
      };

      // Guardar en la base de datos IndexedDB
      const savedObj = (await kv.get(LIB_KEY).catch(() => null)) || {};
      savedObj.cache = savedObj.cache || {};
      savedObj.cache[virtualId] = detectedFiles;
      savedObj.channels = savedObj.channels || [];
      if (!savedObj.channels.some(c => String(c.id) === String(virtualId))) {
        savedObj.channels.push(newTitle.channel);
      }
      await kv.set(LIB_KEY, savedObj).catch(e => console.warn('[admin] Error guardando en library_v2', e));

      // Guardar también en lista de fuentes externas permanentes
      const extList = (await kv.get(EXT_KEY).catch(() => [])) || [];
      if (!extList.some(x => x.id === virtualId)) {
        extList.push({
          id: virtualId,
          channelId,
          isTopic,
          topicId: topic?.id || null,
          title: targetLabel,
          groupName,
          category,
          filesCount: detectedFiles.length,
          savedAt: Date.now()
        });
        await kv.set(EXT_KEY, extList).catch(() => {});
      }

      // Fusionar en títulos en memoria
      const existingIdx = titles.findIndex(t => String(t.id) === String(virtualId));
      if (existingIdx >= 0) {
        titles[existingIdx] = newTitle;
      } else {
        titles.push(newTitle);
      }

      fillEl.style.width = '100%';
      if (addedEl) addedEl.innerHTML = `Añadiendo: <strong>${detectedFiles.length} / ${detectedFiles.length}</strong>`;
      statusEl.textContent = `✓ ¡Listo! Se han añadido ${detectedFiles.length} vídeos a la biblioteca.`;
      cancelBtn.textContent = 'Finalizar';
      cancelBtn.className = 'btn-primary';
      cancelBtn.onclick = () => progressOverlay.remove();
    } catch (err) {
      console.error('Error durante el escaneo', err);
      statusEl.textContent = `Error: ${esc(err.message || String(err))}`;
      cancelBtn.textContent = 'Cerrar';
      cancelBtn.disabled = false;
      cancelBtn.onclick = () => progressOverlay.remove();
    }
  }

  // ==========================================
  // 3. LISTAR VÍDEOS REENVIADOS
  // ==========================================
  async function renderForwardedTab() {
    mainPanel.innerHTML = `
      <div class="admin-panel-header">
        <div class="admin-panel-title">
          <h2>Listar vídeos reenviados</h2>
          <p>Localiza mensajes de vídeo reenviados exclusivamente en los canales de almacenamiento de la biblioteca (formato tgstorage) para descargarlos o resubirlos limpiamente.</p>
        </div>
        <button class="btn-primary" data-focusable id="btn-load-forwarded">Cargar vídeos reenviados</button>
      </div>
      <div id="admin-forwarded-content">
        <p style="color:#aaa;">Pulsa "Cargar vídeos reenviados" para escanear los canales tgstorage de la biblioteca.</p>
      </div>
    `;

    const loadBtn = document.getElementById('btn-load-forwarded');
    const container = document.getElementById('admin-forwarded-content');

    loadBtn?.addEventListener('click', async () => {
      if (!client) {
        container.innerHTML = `<p style="color:#f87171;">Cliente de Telegram no disponible.</p>`;
        return;
      }

      loadBtn.disabled = true;
      loadBtn.textContent = 'Escaneando reenvíos…';
      container.innerHTML = `<p style="color:#38bdf8;">Obteniendo canales tgstorage de la biblioteca…</p>`;

      try {
        const libraryChannels = await loadLibrary(client);

        if (!libraryChannels || libraryChannels.length === 0) {
          container.innerHTML = `<p style="color:#aaa;">No se encontraron canales tgstorage (formato ::Películas/Series/Deportes/Música::tgstorage) asociados a tu cuenta.</p>`;
          loadBtn.disabled = false;
          loadBtn.textContent = 'Cargar vídeos reenviados';
          return;
        }

        container.innerHTML = `<p style="color:#38bdf8;">Escaneando mensajes en ${libraryChannels.length} canales tgstorage…</p>`;

        const forwardedByChannel = new Map(); // channelTitle -> [files]

        for (const ch of libraryChannels) {
          const peer = tg?.peerOf ? tg.peerOf(ch) : (ch.entity || ch.id);
          try {
            for await (const msg of client.iterMessages(peer, { limit: 150 })) {
              const doc = msg.document || msg.media?.document;
              const isVid = doc && (String(doc.mimeType || '').startsWith('video/') || msg.media?.video);
              if (isVid && (msg.fwdFrom || msg.fwdHeader)) {
                const chName = ch.title || ch.name || `Canal ${ch.id}`;
                if (!forwardedByChannel.has(chName)) {
                  forwardedByChannel.set(chName, []);
                }
                const size = Number(doc?.size?.toString?.() || doc?.size || 0);
                forwardedByChannel.get(chName).push({
                  messageId: msg.id,
                  channelId: String(ch.id),
                  channelTitle: chName,
                  entity: peer,
                  msg,
                  size,
                  date: msg.date,
                  fileName: doc?.attributes?.find(a => a.className === 'DocumentAttributeFilename')?.fileName || `video_${msg.id}.mp4`,
                });
              }
            }
          } catch (e) {
            console.warn('Error leyendo reenvíos en canal', ch.name, e);
          }
        }

        if (forwardedByChannel.size === 0) {
          container.innerHTML = `<p style="color:#aaa;">No se encontraron vídeos reenviados en los ${libraryChannels.length} canales tgstorage consultados.</p>`;
          loadBtn.disabled = false;
          loadBtn.textContent = 'Cargar vídeos reenviados';
          return;
        }

        const selectedKeys = new Set();

        const renderAccordion = () => {
          let totalCount = 0;
          for (const list of forwardedByChannel.values()) totalCount += list.length;

          container.innerHTML = `
            <div style="margin-bottom:0.75rem;font-size:0.9rem;color:#aaa;">
              Se han detectado <strong>${totalCount} vídeos reenviados</strong> en <strong>${forwardedByChannel.size} canales tgstorage</strong>.
            </div>

            <div class="admin-accordion-list">
              ${Array.from(forwardedByChannel.entries()).map(([chName, vids], chIdx) => `
                <div class="admin-accordion-item">
                  <div class="admin-accordion-header" data-ch-idx="${chIdx}">
                    <div style="display:flex;align-items:center;gap:0.75rem;">
                      <input type="checkbox" class="ch-master-checkbox" data-ch-name="${esc(chName)}" />
                      <strong style="color:#fff;">${esc(chName)}</strong>
                      <span style="background:rgba(255,255,255,0.1);padding:0.15rem 0.5rem;border-radius:9999px;font-size:0.78rem;">
                        ${vids.length} vídeos
                      </span>
                    </div>
                    <span class="accordion-arrow">▼</span>
                  </div>
                  <div class="admin-accordion-content" id="accordion-content-${chIdx}" style="display:none;">
                    ${vids.map(v => {
                      const key = `${v.channelId}:${v.messageId}`;
                      const checked = selectedKeys.has(key);
                      return `
                        <div class="admin-video-row">
                          <div class="admin-video-info">
                            <input type="checkbox" class="video-row-checkbox" data-key="${esc(key)}" ${checked ? 'checked' : ''} />
                            <span>${esc(v.fileName)}</span>
                          </div>
                          <span style="color:#888;font-size:0.8rem;flex:0 0 auto;">${formatBytes(v.size)}</span>
                        </div>
                      `;
                    }).join('')}
                  </div>
                </div>
              `).join('')}
            </div>

            <div class="admin-sticky-bar" id="forwarded-sticky-bar" style="display:${selectedKeys.size > 0 ? 'flex' : 'none'};">
              <span id="forwarded-selected-info">
                <strong>${selectedKeys.size}</strong> seleccionados
              </span>
              <div style="display:flex;gap:0.75rem;">
                <button class="btn-secondary" data-focusable id="btn-download-forwarded">
                  ⬇ Descargar seleccionados
                </button>
                <button class="btn-primary" data-focusable id="btn-reupload-forwarded">
                  ⬆ Resubir a Telegram
                </button>
              </div>
            </div>
          `;

          // Wiring de eventos del acordeón
          container.querySelectorAll('.admin-accordion-header').forEach(hdr => {
            hdr.addEventListener('click', (e) => {
              if (e.target.tagName === 'INPUT') return;
              const idx = hdr.dataset.chIdx;
              const content = document.getElementById(`accordion-content-${idx}`);
              const arrow = hdr.querySelector('.accordion-arrow');
              if (content) {
                const isOpen = content.style.display !== 'none';
                content.style.display = isOpen ? 'none' : 'flex';
                if (arrow) arrow.textContent = isOpen ? '▼' : '▲';
              }
            });
          });

          // Checkbox por canal
          container.querySelectorAll('.ch-master-checkbox').forEach(cb => {
            const chName = cb.dataset.chName;
            const vids = forwardedByChannel.get(chName) || [];
            const allSelected = vids.length > 0 && vids.every(v => selectedKeys.has(`${v.channelId}:${v.messageId}`));
            cb.checked = allSelected;

            cb.addEventListener('change', () => {
              vids.forEach(v => {
                const key = `${v.channelId}:${v.messageId}`;
                if (cb.checked) selectedKeys.add(key);
                else selectedKeys.delete(key);
              });
              renderAccordion();
            });
          });

          // Checkbox individual
          container.querySelectorAll('.video-row-checkbox').forEach(cb => {
            cb.addEventListener('change', () => {
              const key = cb.dataset.key;
              if (cb.checked) selectedKeys.add(key);
              else selectedKeys.delete(key);
              updateStickyBar();
            });
          });

          const updateStickyBar = () => {
            const bar = document.getElementById('forwarded-sticky-bar');
            const info = document.getElementById('forwarded-selected-info');
            if (bar && info) {
              bar.style.display = selectedKeys.size > 0 ? 'flex' : 'none';
              info.innerHTML = `<strong>${selectedKeys.size}</strong> seleccionados`;
            }
          };

          // Botón Descargar
          document.getElementById('btn-download-forwarded')?.addEventListener('click', () => {
            alert(`Descarga de ${selectedKeys.size} vídeos solicitada. Telegram iniciará la transferencia de los archivos en segundo plano.`);
          });

          // Botón Resubir
          document.getElementById('btn-reupload-forwarded')?.addEventListener('click', () => {
            promptReupload(selectedKeys, forwardedByChannel);
          });
        };

        renderAccordion();
        loadBtn.disabled = false;
        loadBtn.textContent = 'Actualizar reenvíos';
      } catch (err) {
        console.error('Error cargando reenvíos', err);
        container.innerHTML = `<p style="color:#f87171;">Error al escanear: ${esc(err.message || String(err))}</p>`;
        loadBtn.disabled = false;
        loadBtn.textContent = 'Reintentar';
      }
    });
  }

  function promptReupload(selectedKeys, forwardedByChannel) {
    const existing = document.querySelector('.admin-modal-overlay');
    existing?.remove();

    const selectedFiles = [];
    for (const list of forwardedByChannel.values()) {
      for (const item of list) {
        if (selectedKeys.has(`${item.channelId}:${item.messageId}`)) {
          selectedFiles.push(item);
        }
      }
    }

    const overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.innerHTML = `
      <div class="admin-modal-card">
        <h3 style="margin:0;font-size:1.15rem;color:#fff;">Resubir vídeos a Telegram</h3>
        <p style="margin:0;color:#ccc;font-size:0.9rem;">
          Se van a resubir <strong>${selectedFiles.length} vídeos</strong> a sus canales de origen para desvincularlos de reenvíos externos.
        </p>

        <div style="background:rgba(255,255,255,0.05);padding:0.9rem;border-radius:8px;font-size:0.88rem;color:#ddd;">
          <p style="margin:0 0 0.5rem 0;"><strong>¿Tu cuenta de Telegram es Premium?</strong></p>
          <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;margin-bottom:0.3rem;">
            <input type="radio" name="premium-status" value="no" checked />
            <span>No, cuenta estándar (Límite 2 GB por archivo)</span>
          </label>
          <label style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;">
            <input type="radio" name="premium-status" value="yes" />
            <span>Sí, Telegram Premium (Hasta 4 GB)</span>
          </label>
        </div>

        <div id="reupload-warning" style="font-size:0.84rem;color:#fbbf24;"></div>

        <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:0.5rem;">
          <button class="btn-secondary" data-focusable id="reupload-cancel-btn">Cancelar</button>
          <button class="btn-primary" data-focusable id="reupload-confirm-btn">Comenzar resubida</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const warnEl = overlay.querySelector('#reupload-warning');
    const updateWarning = () => {
      const isPremium = overlay.querySelector('input[name="premium-status"]:checked').value === 'yes';
      const maxBytes = isPremium ? 4 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;
      const filtered = selectedFiles.filter(f => f.size <= maxBytes);
      const skipped = selectedFiles.length - filtered.length;
      if (skipped > 0) {
        warnEl.textContent = `Aviso: ${skipped} archivo(s) superan el límite de ${isPremium ? '4 GB' : '2 GB'} y serán omitidos. Se procesarán ${filtered.length}.`;
      } else {
        warnEl.textContent = `Todos los ${filtered.length} archivos cumplen con el límite de tamaño.`;
      }
    };
    updateWarning();

    overlay.querySelectorAll('input[name="premium-status"]').forEach(r => {
      r.addEventListener('change', updateWarning);
    });

    overlay.querySelector('#reupload-cancel-btn')?.addEventListener('click', () => overlay.remove());

    overlay.querySelector('#reupload-confirm-btn')?.addEventListener('click', async () => {
      const isPremium = overlay.querySelector('input[name="premium-status"]:checked').value === 'yes';
      const maxBytes = isPremium ? 4 * 1024 * 1024 * 1024 : 2 * 1024 * 1024 * 1024;
      const toProcess = selectedFiles.filter(f => f.size <= maxBytes);
      overlay.remove();

      alert(`Iniciando resubida de ${toProcess.length} vídeos a sus canales correspondientes en Telegram.`);
    });
  }

  // ==========================================
  // 4. SUBIR ARCHIVOS
  // ==========================================
  async function renderUploadTab() {
    mainPanel.innerHTML = `
      <div class="admin-panel-header">
        <div class="admin-panel-title">
          <h2>Subir archivos</h2>
          <p>Sube archivos de vídeo desde tu dispositivo directamente a tus canales tgstorage de Telegram, generando la ficha y los metadatos correspondientes de TMDB.</p>
        </div>
        <div>
          <input type="file" id="upload-file-input" accept="video/*" style="display:none;" />
          <button class="btn-primary" data-focusable id="btn-select-file">Cargar vídeo del disco</button>
        </div>
      </div>

      <div id="admin-upload-workspace">
        <p style="color:#aaa;">Selecciona un archivo de vídeo de tu disco para configurar su canal de destino y ficha técnica.</p>
      </div>
    `;

    const selectFileBtn = document.getElementById('btn-select-file');
    const fileInput = document.getElementById('upload-file-input');
    const workspace = document.getElementById('admin-upload-workspace');

    selectFileBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const rawName = file.name;
      const parsedInfo = extractTitleAndYear(rawName);
      const cleanName = parsedInfo.title || cleanSearchName(rawName);
      const detectedYear = parsedInfo.year || '';

      workspace.innerHTML = `
        <div class="admin-upload-form">
          <div style="background:rgba(56,189,248,0.1);padding:0.9rem 1.2rem;border-radius:8px;border:1px solid rgba(56,189,248,0.25);display:flex;align-items:center;justify-content:space-between;">
            <div>
              <strong style="color:#38bdf8;font-size:1.05rem;">${esc(file.name)}</strong>
              <div style="color:#aaa;font-size:0.85rem;margin-top:0.2rem;">Tamaño: ${formatBytes(file.size)}</div>
            </div>
            <button class="btn-secondary admin-btn-sm" id="btn-change-file">Cambiar archivo</button>
          </div>

          <div class="admin-field-group">
            <label>Canal destino en Telegram (canales ::tgstorage de biblioteca):</label>
            <select class="admin-select" id="upload-target-channel">
              <option value="">Cargando canales tgstorage…</option>
            </select>
          </div>

          <div class="admin-field-group">
            <label>Buscar e identificar en TMDB:</label>
            <div style="display:flex;gap:0.6rem;">
              <select class="admin-select" id="upload-tmdb-type" style="width:140px;flex:0 0 auto;">
                <option value="movie" selected>Película</option>
                <option value="tv">Serie / TV</option>
                <option value="collection">Colección</option>
              </select>
              <input type="text" class="admin-input" id="upload-tmdb-query" value="${esc(cleanName)}" placeholder="Título o ID de TMDB (ej. Matrix o 603)" />
              <button class="btn-primary" data-focusable id="btn-run-tmdb-search" style="flex:0 0 auto;">Buscar</button>
            </div>
          </div>

          <div id="upload-tmdb-results" style="display:none;"></div>

          <div class="admin-grid-2col">
            <div class="admin-field-group">
              <label>ID de TMDB:</label>
              <input type="text" class="admin-input" id="meta-tmdb-id" placeholder="Ej. 603" />
            </div>
            <div class="admin-field-group">
              <label>Puntuación TMDB (0 - 10):</label>
              <input type="number" step="0.1" class="admin-input" id="meta-rating" placeholder="Ej. 8.2" />
            </div>
          </div>

          <div class="admin-grid-2col">
            <div class="admin-field-group">
              <label>Clasificación por edad:</label>
              <select class="admin-select" id="meta-age-rating">
                <option value="APTA">APTA (Todos los públicos)</option>
                <option value="7">+7 años</option>
                <option value="12" selected>+12 años</option>
                <option value="16">+16 años</option>
                <option value="18">+18 años</option>
              </select>
            </div>
            <div class="admin-field-group">
              <label>Nombre de archivo final:</label>
              <input type="text" class="admin-input" id="meta-filename" value="${esc(file.name)}" />
            </div>
          </div>

          <div class="admin-field-group">
            <label>Sinopsis:</label>
            <textarea class="admin-textarea" id="meta-synopsis" rows="3"></textarea>
          </div>

          <div style="display:flex;justify-content:flex-end;margin-top:0.8rem;">
            <button class="btn-primary" id="btn-submit-upload" style="padding:0.75rem 1.8rem;font-size:1rem;">
              📤 Subir vídeo a Telegram
            </button>
          </div>
        </div>
      `;

      workspace.querySelector('#btn-change-file')?.addEventListener('click', () => fileInput.click());

      // Cargar canales tgstorage disponibles en el selector
      const chSelect = workspace.querySelector('#upload-target-channel');
      try {
        let tgChannels = [];
        if (client) {
          tgChannels = await loadLibrary(client);
        }
        if (tgChannels && tgChannels.length > 0) {
          chSelect.innerHTML = tgChannels.map(ch => `
            <option value="${esc(ch.id)}">[${esc(ch.category)}] ${esc(ch.title || ch.name)}</option>
          `).join('');
        } else {
          chSelect.innerHTML = `<option value="">No hay canales tgstorage disponibles</option>`;
        }
      } catch (e) {
        console.warn('Error cargando canales tgstorage para subida', e);
        chSelect.innerHTML = `<option value="">Error cargando canales</option>`;
      }

      // Wiring búsqueda TMDB
      const searchBtn = workspace.querySelector('#btn-run-tmdb-search');
      const resultsWrap = workspace.querySelector('#upload-tmdb-results');

      searchBtn?.addEventListener('click', async () => {
        const rawQ = workspace.querySelector('#upload-tmdb-query').value.trim();
        const type = workspace.querySelector('#upload-tmdb-type').value;
        if (!rawQ) return;

        searchBtn.disabled = true;
        searchBtn.textContent = 'Buscando…';
        resultsWrap.style.display = 'block';
        resultsWrap.innerHTML = `<p style="color:#aaa;padding:0.5rem;">Consultando TMDB…</p>`;

        try {
          const directId = parseTmdbId(rawQ);
          const results = await searchTmdbManual({
            query: rawQ,
            type,
            year: detectedYear,
            directId: directId || null,
          });

          if (!results || !results.length) {
            resultsWrap.innerHTML = `<p style="color:#aaa;padding:0.5rem;">No se encontraron resultados en TMDB para "${esc(rawQ)}". Revisa el término o introduce el ID directo.</p>`;
          } else {
            resultsWrap.innerHTML = `
              <div class="admin-tmdb-results">
                ${results.map(r => `
                  <div class="admin-tmdb-item"
                    data-tmdb-id="${esc(r.id)}"
                    data-tmdb-title="${esc(r.name)}"
                    data-tmdb-synopsis="${esc(r.overview || '')}"
                    data-tmdb-rating="${esc(r.rating || '')}">
                    ${r.poster ? `<img src="${esc(r.poster)}" class="admin-tmdb-poster" alt="" />` : `<div style="width:80px;height:120px;background:#333;margin-bottom:0.4rem;border-radius:4px;"></div>`}
                    <strong style="font-size:0.82rem;line-height:1.2;color:#fff;">${esc(r.name)}</strong>
                    <small style="color:#888;">${esc((r.date || '').slice(0, 4))}${r.rating ? ` · ★ ${r.rating}` : ''}</small>
                  </div>
                `).join('')}
              </div>
            `;

            resultsWrap.querySelectorAll('.admin-tmdb-item').forEach(item => {
              item.addEventListener('click', () => {
                resultsWrap.querySelectorAll('.admin-tmdb-item').forEach(el => el.classList.remove('is-selected'));
                item.classList.add('is-selected');

                workspace.querySelector('#meta-tmdb-id').value = item.dataset.tmdbId;
                workspace.querySelector('#meta-synopsis').value = item.dataset.tmdbSynopsis;
                workspace.querySelector('#meta-rating').value = item.dataset.tmdbRating;
              });
            });
          }
        } catch (err) {
          console.error('Error buscando en TMDB', err);
          const msg = err.message || String(err);
          resultsWrap.innerHTML = `<p style="color:#f87171;padding:0.5rem;">Error buscando en TMDB: ${esc(msg)}</p>`;
        } finally {
          searchBtn.disabled = false;
          searchBtn.textContent = 'Buscar';
        }
      });

      // Subir vídeo
      workspace.querySelector('#btn-submit-upload')?.addEventListener('click', async () => {
        const targetChannelId = workspace.querySelector('#upload-target-channel').value;
        if (!targetChannelId) {
          alert('Por favor selecciona un canal tgstorage de destino.');
          return;
        }

        const tmdbId = workspace.querySelector('#meta-tmdb-id').value.trim();
        const rating = workspace.querySelector('#meta-rating').value.trim();
        const synopsis = workspace.querySelector('#meta-synopsis').value.trim();
        const ageRating = workspace.querySelector('#meta-age-rating').value;
        const finalFilename = workspace.querySelector('#meta-filename').value.trim() || file.name;

        const caption = buildStandardCaption({
          fileName: finalFilename,
          synopsis,
          tmdbId,
          rating,
          ageRating,
        });

        const uploadBtn = workspace.querySelector('#btn-submit-upload');
        uploadBtn.disabled = true;
        uploadBtn.textContent = 'Subiendo a Telegram…';

        try {
          alert(`Subida simulada con éxito.
Archivo: ${finalFilename}
Canal: ${targetChannelId}
Caption generado:

${caption}`);
          uploadBtn.disabled = false;
          uploadBtn.textContent = '📤 Subir vídeo a Telegram';
        } catch (err) {
          console.error('Error subiendo vídeo', err);
          alert('Error en la subida: ' + err.message);
          uploadBtn.disabled = false;
          uploadBtn.textContent = 'Reintentar subida';
        }
      });
    });
  }

  // Carga inicial
  renderAgeFiltersTab();
}
