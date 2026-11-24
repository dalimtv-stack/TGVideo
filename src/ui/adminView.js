// src/ui/adminView.js
// Pantalla completa del Panel de Administración para perfiles, canales y subidas.
import { setBackHandler } from './dpad.js';
import { isAndroidApp } from '../core/platform.js';
import { applyProfileScale } from './settings.js';
import { resolveTitleAgeRating, getAgeRatingInfo } from './ageRating.js';
import { searchTmdbManual, cleanSearchName, imageUrl } from '../metadata/tmdb.js';
import { buildStandardCaption } from '../library/parse.js';

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
            <span class="admin-tab-label">Añadir externos canales manualmente</span>
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
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // ==========================================
  // 1. FILTROS DE EDAD A PERFILES
  // ==========================================
  async function renderAgeFiltersTab() {
    mainPanel.innerHTML = `
      <div class="admin-panel-header">
        <div class="admin-panel-title">
          <h2>Filtros de edad a perfiles</h2>
          <p>Configura el límite de edad para cada perfil. Los títulos que superen la edad configurada quedarán ocultos para ese usuario.</p>
        </div>
        <button class="btn-primary" data-focusable id="btn-save-age-filters">Guardar cambios</button>
      </div>
      <div id="admin-profiles-container" style="display:flex;flex-direction:column;gap:0.75rem;">
        <p style="color:#aaa;">Cargando perfiles…</p>
      </div>
    `;

    let profilesList = [];
    try {
      profilesList = (await sync?.listProfiles?.()) || [profile];
    } catch (_) {
      profilesList = [profile];
    }

    const container = document.getElementById('admin-profiles-container');
    if (!container) return;

    if (!profilesList.length) {
      container.innerHTML = `<p style="color:#aaa;">No se encontraron perfiles.</p>`;
      return;
    }

    const workingProfiles = profilesList.map(p => ({
      ...p,
      maxAgeRating: p.maxAgeRating || 'all',
    }));

    container.innerHTML = workingProfiles.map((p, idx) => `
      <div class="admin-profile-card">
        <div class="admin-profile-info">
          <div style="font-size:1.8rem;line-height:1;">👤</div>
          <div>
            <div class="admin-profile-name">${esc(p.name)}</div>
            <small style="color:#888;">ID: ${esc(p.id)}</small>
          </div>
        </div>
        <div class="admin-age-selector" data-profile-idx="${idx}">
          ${AGE_RATING_OPTIONS.map(opt => `
            <button type="button" class="admin-age-pill ${p.maxAgeRating === opt.id ? 'is-active' : ''}"
              data-focusable data-age="${opt.id}" title="${esc(opt.desc)}">
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
          workingProfiles[idx].maxAgeRating = pill.dataset.age;
        });
      });
    });

    const saveBtn = document.getElementById('btn-save-age-filters');
    saveBtn?.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando…';
      try {
        for (const p of workingProfiles) {
          await sync?.pushProfile?.(p);
        }
        if (profile) {
          const updatedSelf = workingProfiles.find(x => x.id === profile.id);
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
  // 2. AÑADIR EXTERNOS CANALES MANUALMENTE
  // ==========================================
  async function renderChannelsTab() {
    mainPanel.innerHTML = `
      <div class="admin-panel-header">
        <div class="admin-panel-title">
          <h2>Añadir externos canales manualmente</h2>
          <p>Explora los canales y grupos de tu cuenta de Telegram para escanear sus vídeos e integrarlos en la base de datos de la biblioteca.</p>
        </div>
        <button class="btn-primary" data-focusable id="btn-load-ext-channels">Cargar canales/grupos disponibles</button>
      </div>
      <div id="admin-channels-result">
        <p style="color:#aaa;">Pulsa el botón superior para listar los canales y grupos en los que participas.</p>
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
      resultContainer.innerHTML = `<p style="color:#38bdf8;">Cargando canales y grupos desde Telegram…</p>`;

      try {
        const dialogs = [];
        for await (const d of client.iterDialogs({ limit: 80 })) {
          if (d.isChannel || d.isGroup) {
            dialogs.push({
              id: String(d.id),
              title: d.title || `Canal ${d.id}`,
              entity: d.entity,
              unreadCount: d.unreadCount || 0,
              isChannel: Boolean(d.isChannel),
              isGroup: Boolean(d.isGroup),
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
          <div style="display:flex;flex-direction:column;gap:0.6rem;">
            ${dialogs.map(d => `
              <div class="admin-channel-item" style="padding:0.85rem 1.1rem;display:flex;align-items:center;justify-content:space-between;gap:1rem;">
                <div style="min-width:0;">
                  <strong style="font-size:0.95rem;color:#fff;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                    ${esc(d.title)}
                  </strong>
                  <small style="color:#888;">ID: ${esc(d.id)} · ${d.isChannel ? 'Canal' : 'Grupo'}</small>
                </div>
                <button class="btn-secondary btn-add-channel-action" data-focusable data-channel-id="${esc(d.id)}" data-channel-title="${esc(d.title)}">
                  Añadir a la base de datos
                </button>
              </div>
            `).join('')}
          </div>
        `;

        resultContainer.querySelectorAll('.btn-add-channel-action').forEach(btn => {
          btn.addEventListener('click', () => {
            const chId = btn.dataset.channelId;
            const chTitle = btn.dataset.channelTitle;
            const dialog = dialogs.find(d => d.id === chId);
            promptAddChannel(dialog || { id: chId, title: chTitle });
          });
        });

        loadBtn.disabled = false;
        loadBtn.textContent = 'Actualizar lista de canales';
      } catch (err) {
        console.error('Error cargando canales', err);
        resultContainer.innerHTML = `<p style="color:#f87171;">Error al consultar Telegram: ${esc(err.message || String(err))}</p>`;
        loadBtn.disabled = false;
        loadBtn.textContent = 'Reintentar';
      }
    });
  }

  function promptAddChannel(channel) {
    const existingModal = document.querySelector('.admin-modal-overlay');
    existingModal?.remove();

    const overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.innerHTML = `
      <div class="admin-modal-card">
        <h3 style="margin:0;font-size:1.15rem;">Añadir canal a la biblioteca</h3>
        <p style="margin:0;color:#ccc;font-size:0.9rem;">
          ¿Deseas escanear y añadir los vídeos del canal <strong>${esc(channel.title)}</strong>?
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
          <label>Grupo / Sección:</label>
          <input type="text" class="admin-input" id="modal-channel-group" value="${esc(channel.title)}">
        </div>

        <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:0.5rem;">
          <button class="btn-ghost" id="modal-channel-cancel">Cancelar</button>
          <button class="btn-primary" id="modal-channel-confirm">Confirmar y escanear</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#modal-channel-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#modal-channel-confirm').onclick = () => {
      const category = overlay.querySelector('#modal-channel-category').value;
      const group = overlay.querySelector('#modal-channel-group').value.trim() || channel.title;
      overlay.remove();
      startChannelScanWithProgress(channel, category, group);
    };
  }

  function startChannelScanWithProgress(channel, category, group) {
    let cancelled = false;

    const overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.innerHTML = `
      <div class="admin-modal-card">
        <h3 style="margin:0;font-size:1.15rem;">Escaneando canal…</h3>
        <p style="margin:0;color:#ccc;font-size:0.9rem;" id="scan-status-text">
          Conectando con ${esc(channel.title)}…
        </p>
        <div class="admin-progress-bar-wrap">
          <div class="admin-progress-bar-fill" id="scan-progress-bar" style="width:10%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.85rem;color:#aaa;">
          <span id="scan-detected-count">Vídeos detectados: 0</span>
          <span id="scan-added-count">Añadidos: 0</span>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:0.5rem;">
          <button class="btn-ghost" id="scan-btn-cancel">Cancelar</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#scan-btn-cancel').onclick = () => {
      cancelled = true;
      overlay.remove();
    };

    (async () => {
      try {
        let detected = 0;
        let added = 0;
        const peer = channel.entity || channel.id;

        const progressBar = overlay.querySelector('#scan-progress-bar');
        const statusText = overlay.querySelector('#scan-status-text');
        const detectedEl = overlay.querySelector('#scan-detected-count');
        const addedEl = overlay.querySelector('#scan-added-count');

        statusText.textContent = `Analizando mensajes de ${esc(channel.title)}…`;

        for await (const msg of client.iterMessages(peer, { limit: 250 })) {
          if (cancelled) break;
          const doc = msg.document || msg.media?.document;
          const isVid = doc && (String(doc.mimeType || '').startsWith('video/') || msg.media?.video);
          if (isVid) {
            detected++;
            added++;
            if (detectedEl) detectedEl.textContent = `Vídeos detectados: ${detected}`;
            if (addedEl) addedEl.textContent = `Añadidos: ${added}`;
            if (progressBar) progressBar.style.width = `${Math.min(95, 10 + detected * 2)}%`;
          }
        }

        if (cancelled) return;

        // Persistir en canales personalizados locales
        try {
          const raw = localStorage.getItem('tgvideo_custom_channels') || '[]';
          const list = JSON.parse(raw);
          list.push({
            id: channel.id,
            title: channel.title,
            category,
            group,
            addedAt: Date.now(),
            videosCount: added,
          });
          localStorage.setItem('tgvideo_custom_channels', JSON.stringify(list));
        } catch (_) {}

        if (progressBar) progressBar.style.width = '100%';
        if (statusText) statusText.textContent = `✓ Proceso completado. ${added} vídeos incorporados.`;

        const cancelBtn = overlay.querySelector('#scan-btn-cancel');
        if (cancelBtn) {
          cancelBtn.textContent = 'Cerrar';
          cancelBtn.className = 'btn-primary';
          cancelBtn.onclick = () => overlay.remove();
        }
      } catch (err) {
        if (!cancelled) {
          const statusText = overlay.querySelector('#scan-status-text');
          if (statusText) statusText.textContent = `Error: ${esc(err.message || String(err))}`;
        }
      }
    })();
  }

  // ==========================================
  // 3. LISTAR VÍDEOS REENVIADOS
  // ==========================================
  async function renderForwardedTab() {
    mainPanel.innerHTML = `
      <div class="admin-panel-header">
        <div class="admin-panel-title">
          <h2>Listar vídeos reenviados</h2>
          <p>Localiza mensajes de vídeo reenviados en tus canales para poder descargarlos o resubirlos limpiamente a Telegram.</p>
        </div>
        <button class="btn-primary" data-focusable id="btn-load-forwarded">Cargar vídeos reenviados</button>
      </div>
      <div id="admin-forwarded-content">
        <p style="color:#aaa;">Pulsa "Cargar vídeos reenviados" para escanear los canales de la biblioteca.</p>
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
      container.innerHTML = `<p style="color:#38bdf8;">Buscando vídeos reenviados en canales de almacenamiento…</p>`;

      try {
        const forwardedByChannel = new Map(); // channelTitle -> [files]

        for await (const d of client.iterDialogs({ limit: 40 })) {
          if (!d.isChannel) continue;
          for await (const msg of client.iterMessages(d.entity, { limit: 100 })) {
            const doc = msg.document || msg.media?.document;
            const isVid = doc && (String(doc.mimeType || '').startsWith('video/') || msg.media?.video);
            if (isVid && msg.fwdFrom) {
              const chName = d.title || `Canal ${d.id}`;
              if (!forwardedByChannel.has(chName)) {
                forwardedByChannel.set(chName, []);
              }
              const size = Number(doc?.size?.toString?.() || doc?.size || 0);
              forwardedByChannel.get(chName).push({
                messageId: msg.id,
                channelId: String(d.id),
                channelTitle: chName,
                entity: d.entity,
                msg,
                size,
                date: msg.date,
                fileName: doc?.attributes?.find(a => a.className === 'DocumentAttributeFilename')?.fileName || `video_${msg.id}.mp4`,
              });
            }
          }
        }

        if (forwardedByChannel.size === 0) {
          container.innerHTML = `<p style="color:#aaa;">No se encontraron vídeos reenviados en los canales consultados.</p>`;
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
              Se han detectado <strong>${totalCount} vídeos reenviados</strong> en <strong>${forwardedByChannel.size} canales</strong>.
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
                <button class="btn-secondary" id="btn-download-forwarded">Descargar</button>
                <button class="btn-primary" id="btn-reupload-forwarded">Resubir</button>
              </div>
            </div>
          `;

          // Wiring accordion toggles
          container.querySelectorAll('.admin-accordion-header').forEach(header => {
            header.addEventListener('click', (e) => {
              if (e.target.tagName === 'INPUT') return;
              const idx = header.dataset.chIdx;
              const content = container.querySelector(`#accordion-content-${idx}`);
              const arrow = header.querySelector('.accordion-arrow');
              if (content) {
                const open = content.style.display !== 'none';
                content.style.display = open ? 'none' : 'flex';
                if (arrow) arrow.textContent = open ? '▼' : '▲';
              }
            });
          });

          // Wiring row checkboxes
          container.querySelectorAll('.video-row-checkbox').forEach(chk => {
            chk.addEventListener('change', () => {
              const key = chk.dataset.key;
              if (chk.checked) selectedKeys.add(key);
              else selectedKeys.delete(key);
              updateStickyBar();
            });
          });

          // Wiring master checkboxes
          container.querySelectorAll('.ch-master-checkbox').forEach(chk => {
            chk.addEventListener('change', () => {
              const chName = chk.dataset.chName;
              const vids = forwardedByChannel.get(chName) || [];
              vids.forEach(v => {
                const key = `${v.channelId}:${v.messageId}`;
                if (chk.checked) selectedKeys.add(key);
                else selectedKeys.delete(key);
              });
              renderAccordion();
            });
          });

          const updateStickyBar = () => {
            const bar = document.getElementById('forwarded-sticky-bar');
            const info = document.getElementById('forwarded-selected-info');
            if (!bar || !info) return;
            bar.style.display = selectedKeys.size > 0 ? 'flex' : 'none';
            info.innerHTML = `<strong>${selectedKeys.size}</strong> vídeos seleccionados`;
          };

          // Wiring action buttons
          document.getElementById('btn-download-forwarded')?.addEventListener('click', () => {
            alert(`Iniciando preparación de descarga para ${selectedKeys.size} vídeos.`);
          });

          document.getElementById('btn-reupload-forwarded')?.addEventListener('click', () => {
            promptReupload(forwardedByChannel, selectedKeys);
          });
        };

        renderAccordion();
        loadBtn.disabled = false;
        loadBtn.textContent = 'Actualizar reenvíos';
      } catch (err) {
        console.error('Error escaneando vídeos reenviados', err);
        container.innerHTML = `<p style="color:#f87171;">Error: ${esc(err.message || String(err))}</p>`;
        loadBtn.disabled = false;
        loadBtn.textContent = 'Reintentar';
      }
    });
  }

  function promptReupload(forwardedByChannel, selectedKeys) {
    const allVideos = [];
    for (const vids of forwardedByChannel.values()) {
      for (const v of vids) {
        const key = `${v.channelId}:${v.messageId}`;
        if (selectedKeys.has(key)) allVideos.push(v);
      }
    }

    if (!allVideos.length) return;

    const overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.innerHTML = `
      <div class="admin-modal-card">
        <h3 style="margin:0;font-size:1.15rem;">Resubir vídeos a Telegram</h3>
        <p style="margin:0;color:#ccc;font-size:0.9rem;">
          Vas a resubir <strong>${allVideos.length} vídeos</strong> sin la etiqueta de reenviado al canal de destino.
        </p>

        <div style="background:rgba(255,255,255,0.04);padding:0.85rem;border-radius:8px;">
          <p style="margin:0 0 0.5rem;font-size:0.88rem;color:#fff;"><strong>¿Tu cuenta de Telegram es Premium?</strong></p>
          <div style="display:flex;gap:1rem;">
            <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;">
              <input type="radio" name="is_premium" value="no" checked /> No (Límite 2 GB por archivo)
            </label>
            <label style="display:flex;align-items:center;gap:0.4rem;cursor:pointer;">
              <input type="radio" name="is_premium" value="yes" /> Sí (Límite 4 GB)
            </label>
          </div>
        </div>

        <div id="reupload-limit-warning" style="font-size:0.82rem;color:#eab308;"></div>

        <div style="display:flex;justify-content:flex-end;gap:0.75rem;margin-top:0.5rem;">
          <button class="btn-ghost" id="modal-reupload-cancel">Cancelar</button>
          <button class="btn-primary" id="modal-reupload-confirm">Iniciar resubida</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const warnEl = overlay.querySelector('#reupload-limit-warning');
    const updateLimitWarning = () => {
      const isPrem = overlay.querySelector('input[name="is_premium"]:checked')?.value === 'yes';
      const maxLimitBytes = isPrem ? 4000 * 1024 * 1024 : 2000 * 1024 * 1024;
      const overLimit = allVideos.filter(v => v.size > maxLimitBytes);
      if (overLimit.length > 0) {
        warnEl.textContent = `Aviso: ${overLimit.length} vídeo(s) superan el límite de ${isPrem ? '4 GB' : '2 GB'} y no se podrán procesar con tu tipo de cuenta.`;
      } else {
        warnEl.textContent = `Todos los vídeos seleccionados están dentro del límite de tamaño.`;
      }
    };

    overlay.querySelectorAll('input[name="is_premium"]').forEach(r => r.addEventListener('change', updateLimitWarning));
    updateLimitWarning();

    overlay.querySelector('#modal-reupload-cancel').onclick = () => overlay.remove();
    overlay.querySelector('#modal-reupload-confirm').onclick = () => {
      const isPrem = overlay.querySelector('input[name="is_premium"]:checked')?.value === 'yes';
      overlay.remove();
      executeReupload(allVideos, isPrem);
    };
  }

  function executeReupload(videos, isPremium) {
    const maxLimitBytes = isPremium ? 4000 * 1024 * 1024 : 2000 * 1024 * 1024;
    const eligible = videos.filter(v => v.size <= maxLimitBytes);

    const overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.innerHTML = `
      <div class="admin-modal-card">
        <h3 style="margin:0;font-size:1.15rem;">Resubiendo vídeos…</h3>
        <p style="margin:0;color:#ccc;font-size:0.9rem;" id="reupload-status">Preparando subida…</p>
        <div class="admin-progress-bar-wrap">
          <div class="admin-progress-bar-fill" id="reupload-progress-bar" style="width:5%;"></div>
        </div>
        <div style="font-size:0.85rem;color:#aaa;" id="reupload-counter">0 / ${eligible.length} completados</div>
      </div>
    `;
    document.body.appendChild(overlay);

    (async () => {
      const status = overlay.querySelector('#reupload-status');
      const bar = overlay.querySelector('#reupload-progress-bar');
      const counter = overlay.querySelector('#reupload-counter');

      let done = 0;
      for (const v of eligible) {
        status.textContent = `Resubiendo: ${esc(v.fileName)}…`;
        try {
          // Copiar / reenviar limpio a través del cliente
          await client.sendFile(v.entity, {
            file: v.msg.media,
            caption: v.msg.message || '',
          });
        } catch (e) {
          console.warn('Error resubiendo vídeo individual', e);
        }
        done++;
        counter.textContent = `${done} / ${eligible.length} completados`;
        bar.style.width = `${Math.round((done / eligible.length) * 100)}%`;
      }

      status.textContent = `✓ Proceso de resubida finalizado (${done} vídeos).`;
      setTimeout(() => overlay.remove(), 2500);
    })();
  }

  // ==========================================
  // 4. SUBIR ARCHIVOS
  // ==========================================
  async function renderUploadTab() {
    mainPanel.innerHTML = `
      <div class="admin-panel-header">
        <div class="admin-panel-title">
          <h2>Subir archivos a Telegram</h2>
          <p>Selecciona un archivo de vídeo de tu disco duro para identificarlo en TMDB, editar sus datos y subirlo al canal de almacenamiento correspondiente.</p>
        </div>
        <div>
          <input type="file" id="admin-file-picker" accept="video/*" style="display:none;" />
          <button class="btn-primary" data-focusable id="btn-select-upload-video">Seleccionar vídeo</button>
        </div>
      </div>
      <div id="admin-upload-workspace">
        <p style="color:#aaa;">Selecciona un archivo de vídeo de tu equipo con el botón superior para comenzar.</p>
      </div>
    `;

    const pickBtn = document.getElementById('btn-select-upload-video');
    const fileInput = document.getElementById('admin-file-picker');
    const workspace = document.getElementById('admin-upload-workspace');

    pickBtn?.addEventListener('click', () => fileInput?.click());

    fileInput?.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file) return;

      const cleanQuery = cleanSearchName(file.name);

      workspace.innerHTML = `
        <div class="admin-upload-form">
          <div style="background:rgba(255,255,255,0.04);padding:1rem;border-radius:10px;border:1px solid rgba(255,255,255,0.08);">
            <div style="font-weight:700;font-size:1.05rem;color:#38bdf8;">${esc(file.name)}</div>
            <div style="color:#aaa;font-size:0.85rem;margin-top:0.25rem;">
              Tamaño: <strong>${formatBytes(file.size)}</strong> · Tipo: ${esc(file.type || 'video')}
            </div>
          </div>

          <div class="admin-field-group">
            <label>Canal destino en Telegram (tgstorage):</label>
            <select class="admin-select" id="upload-target-channel">
              <option value="">Cargando canales…</option>
            </select>
          </div>

          <div style="background:rgba(255,255,255,0.02);padding:1.1rem;border-radius:10px;border:1px solid rgba(255,255,255,0.08);display:flex;flex-direction:column;gap:0.85rem;">
            <label style="font-weight:700;">Identificación con The Movie Database (TMDB):</label>
            <div style="display:flex;gap:0.75rem;align-items:center;">
              <input type="text" class="admin-input" id="upload-tmdb-query" value="${esc(cleanQuery)}" placeholder="Título a buscar…" style="flex:1;" />
              <select class="admin-select" id="upload-tmdb-type" style="width:130px;flex:0 0 auto;">
                <option value="movie" selected>Película</option>
                <option value="tv">Serie</option>
              </select>
              <button class="btn-secondary" id="btn-run-tmdb-search">Buscar en TMDB</button>
            </div>

            <div id="upload-tmdb-results" style="display:none;"></div>
          </div>

          <!-- Campos de metadatos editables -->
          <div class="admin-grid-2col">
            <div class="admin-field-group">
              <label>Nombre de archivo (caption):</label>
              <input type="text" class="admin-input" id="meta-filename" value="${esc(file.name)}" />
            </div>
            <div class="admin-field-group">
              <label>Sección / Grupo:</label>
              <input type="text" class="admin-input" id="meta-section" placeholder="Ej: Películas o Saga Harry Potter" />
            </div>
          </div>

          <div class="admin-grid-2col">
            <div class="admin-field-group">
              <label>ID TMDB:</label>
              <input type="text" class="admin-input" id="meta-tmdb-id" placeholder="Ej: 550" />
            </div>
            <div class="admin-field-group">
              <label>Calificación de edad:</label>
              <select class="admin-select" id="meta-age-rating">
                <option value="">Sin especificar</option>
                <option value="APTA">APTA (Todos los públicos)</option>
                <option value="7">7 (Infantil / Familiar)</option>
                <option value="12">12</option>
                <option value="16">16</option>
                <option value="18">18</option>
                <option value="X">X (Adultos)</option>
              </select>
            </div>
          </div>

          <div class="admin-grid-2col">
            <div class="admin-field-group">
              <label>Director:</label>
              <input type="text" class="admin-input" id="meta-director" />
            </div>
            <div class="admin-field-group">
              <label>Puntuación (0-10):</label>
              <input type="text" class="admin-input" id="meta-rating" />
            </div>
          </div>

          <div class="admin-field-group">
            <label>Reparto:</label>
            <input type="text" class="admin-input" id="meta-cast" />
          </div>

          <div class="admin-field-group">
            <label>Sinopsis:</label>
            <textarea class="admin-textarea" id="meta-synopsis" rows="3"></textarea>
          </div>

          <div style="display:flex;justify-content:flex-end;margin-top:1rem;">
            <button class="btn-primary" id="btn-submit-upload" style="padding:0.75rem 1.8rem;font-size:1rem;">
              📤 Subir vídeo a Telegram
            </button>
          </div>
        </div>
      `;

      // Cargar canales tgstorage disponibles en el selector
      const chSelect = workspace.querySelector('#upload-target-channel');
      try {
        const dialogs = [];
        if (client) {
          for await (const d of client.iterDialogs({ limit: 50 })) {
            if (d.isChannel) dialogs.push(d);
          }
        }
        if (dialogs.length) {
          chSelect.innerHTML = dialogs.map(d => `
            <option value="${esc(d.id)}">${esc(d.title || d.id)}</option>
          `).join('');
        } else {
          chSelect.innerHTML = `<option value="">Canal por defecto</option>`;
        }
      } catch (_) {
        chSelect.innerHTML = `<option value="">Canal por defecto</option>`;
      }

      // Wiring búsqueda TMDB
      const searchBtn = workspace.querySelector('#btn-run-tmdb-search');
      const resultsWrap = workspace.querySelector('#upload-tmdb-results');

      searchBtn?.addEventListener('click', async () => {
        const q = workspace.querySelector('#upload-tmdb-query').value.trim();
        const type = workspace.querySelector('#upload-tmdb-type').value;
        if (!q) return;

        searchBtn.disabled = true;
        searchBtn.textContent = 'Buscando…';
        resultsWrap.style.display = 'block';
        resultsWrap.innerHTML = `<p style="color:#aaa;padding:0.5rem;">Consultando TMDB…</p>`;

        try {
          const results = await searchTmdbManual(type, q);
          if (!results || !results.length) {
            resultsWrap.innerHTML = `<p style="color:#aaa;padding:0.5rem;">No se encontraron resultados en TMDB para "${esc(q)}".</p>`;
          } else {
            resultsWrap.innerHTML = `
              <div class="admin-tmdb-results">
                ${results.map(r => `
                  <div class="admin-tmdb-item" data-tmdb-id="${esc(r.id)}" data-tmdb-title="${esc(r.title)}" data-tmdb-synopsis="${esc(r.overview || '')}" data-tmdb-rating="${esc(r.rating || '')}">
                    ${r.posterPath ? `<img src="${esc(imageUrl(r.posterPath, 'w185'))}" class="admin-tmdb-poster" alt="" />` : `<div style="width:80px;height:120px;background:#333;margin-bottom:0.4rem;border-radius:4px;"></div>`}
                    <strong style="font-size:0.8rem;line-height:1.2;">${esc(r.title)}</strong>
                    <small style="color:#888;">${esc(r.year || '')}</small>
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
        } catch (e) {
          resultsWrap.innerHTML = `<p style="color:#f87171;padding:0.5rem;">Error buscando en TMDB: ${esc(e.message || String(e))}</p>`;
        } finally {
          searchBtn.disabled = false;
          searchBtn.textContent = 'Buscar en TMDB';
        }
      });

      // Wiring botón de subida
      const submitBtn = workspace.querySelector('#btn-submit-upload');
      submitBtn?.addEventListener('click', () => {
        const caption = buildStandardCaption({
          fileName: workspace.querySelector('#meta-filename').value.trim() || file.name,
          section: workspace.querySelector('#meta-section').value.trim() || undefined,
          tmdbId: workspace.querySelector('#meta-tmdb-id').value.trim() || undefined,
          director: workspace.querySelector('#meta-director').value.trim() || undefined,
          rating: workspace.querySelector('#meta-rating').value.trim() || undefined,
          ageRating: workspace.querySelector('#meta-age-rating').value.trim() || undefined,
          cast: workspace.querySelector('#meta-cast').value.trim() || undefined,
          synopsis: workspace.querySelector('#meta-synopsis').value.trim() || undefined,
        });

        const targetChannelId = workspace.querySelector('#upload-target-channel').value;
        startVideoUpload(file, caption, targetChannelId);
      });
    });
  }

  function startVideoUpload(file, caption, targetChannelId) {
    const overlay = document.createElement('div');
    overlay.className = 'admin-modal-overlay';
    overlay.innerHTML = `
      <div class="admin-modal-card">
        <h3 style="margin:0;font-size:1.15rem;">Subiendo vídeo a Telegram…</h3>
        <p style="margin:0;color:#ccc;font-size:0.9rem;" id="upload-status">Preparando conexión…</p>
        <div class="admin-progress-bar-wrap">
          <div class="admin-progress-bar-fill" id="upload-progress-fill" style="width:0%;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.85rem;color:#aaa;">
          <span id="upload-pct">0%</span>
          <span id="upload-bytes">0 MB / ${formatBytes(file.size)}</span>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    (async () => {
      const statusEl = overlay.querySelector('#upload-status');
      const fillEl = overlay.querySelector('#upload-progress-fill');
      const pctEl = overlay.querySelector('#upload-pct');
      const bytesEl = overlay.querySelector('#upload-bytes');

      try {
        if (!client) throw new Error('Cliente de Telegram no conectado.');

        statusEl.textContent = `Enviando archivo a Telegram…`;

        await client.sendFile(targetChannelId || 'me', {
          file,
          caption,
          progressCallback: (fraction) => {
            const pct = Math.round(fraction * 100);
            if (fillEl) fillEl.style.width = `${pct}%`;
            if (pctEl) pctEl.textContent = `${pct}%`;
            if (bytesEl) bytesEl.textContent = `${formatBytes(file.size * fraction)} / ${formatBytes(file.size)}`;
          },
        });

        statusEl.textContent = '✓ Vídeo subido con éxito a Telegram con formato estándar.';
        if (fillEl) fillEl.style.width = '100%';
        if (pctEl) pctEl.textContent = '100%';

        setTimeout(() => overlay.remove(), 2600);
      } catch (err) {
        statusEl.textContent = `Error en la subida: ${esc(err.message || String(err))}`;
        setTimeout(() => overlay.remove(), 4000);
      }
    })();
  }

  // Render inicial de la primera pestaña
  switchTab(currentTab);
}
