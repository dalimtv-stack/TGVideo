// src/ui/adminChannels.js
// Módulo para escanear, integrar y desvincular canales, grupos y temas externos en la biblioteca.
import { Api } from 'telegram';
import { clearExternalChannelCache } from './externalTitlesCache.js';
import { isVideoMessage, getFileName, parseCaption, parseEpisode, prettyName } from '../library/parse.js';
import { extractTitleAndYear, extractTitlesFromCaption, enrichTitles } from '../metadata/tmdb.js';
import { seriesNameFromFile } from '../library/titles.js';

const LIB_KEY = 'library_v2';
const EXT_KEY = 'external_sources_v1';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Función modular y reutilizable para construir los títulos de la biblioteca
 * a partir de un registro de canal externo y su lista de archivos de vídeo detectados.
 */
export function buildTitlesForExternalChannel(channelRecord, detectedFiles) {
  const generatedTitles = [];
  const virtualId = String(channelRecord.id);
  const category = channelRecord.category || 'Películas';
  const groupName = channelRecord.group || channelRecord.name || channelRecord.title || 'Externo';

  if (category === 'Películas') {
    const movieMap = new Map();
    for (const f of detectedFiles) {
      const targetFileName = f.captionFileName || f.fileName || f.label;
      const captionCandidate = extractTitlesFromCaption(f.rawCaption || f.caption || '')[0];
      const parsed = captionCandidate || extractTitleAndYear(targetFileName);
      const baseName = parsed.title || f.label;
      const key = f.tmdbId ? `tmdb_${f.tmdbId}` : `${baseName.toLowerCase().trim()}_${parsed.year || ''}`;

      if (!movieMap.has(key)) {
        movieMap.set(key, {
          id: `${virtualId}:${f.messageId}`,
          nombre: baseName,
          yearHint: parsed.year || null,
          files: [f],
          tmdbId: f.tmdbId || null,
          imdbId: f.imdbId || null,
        });
      } else {
        const grp = movieMap.get(key);
        grp.files.push(f);
        if (!grp.tmdbId && f.tmdbId) grp.tmdbId = f.tmdbId;
      }
    }

    for (const grp of movieMap.values()) {
      grp.files.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0) || (b.date || 0) - (a.date || 0));
      generatedTitles.push({
        id: String(grp.id),
        tipo: 'pelicula',
        isSaga: false,
        grupo: groupName,
        nombre: grp.nombre,
        yearHint: grp.yearHint,
        origen: { tipo: 'externo', channelId: String(virtualId), messageId: grp.files[0].messageId },
        channel: channelRecord,
        archivos: grp.files,
        ultimoMensajeFecha: grp.files.reduce((m, f) => Math.max(m, f.date || 0), 0),
        tmdbId: grp.tmdbId,
        imdbId: grp.imdbId,
      });
    }
  } else if (category === 'Documentales') {
    const docMap = new Map();
    for (const f of detectedFiles) {
      const targetFileName = f.captionFileName || f.fileName || f.label;
      const captionCandidate = extractTitlesFromCaption(f.rawCaption || f.caption || '')[0];
      const parsed = captionCandidate || extractTitleAndYear(targetFileName);
      const baseName = parsed.title || f.label;
      const key = f.tmdbId ? `tmdb_${f.tmdbId}` : `${baseName.toLowerCase().trim()}_${parsed.year || ''}`;
      if (!docMap.has(key)) {
        docMap.set(key, {
          id: `${virtualId}:${f.messageId}`,
          nombre: baseName,
          yearHint: parsed.year || null,
          files: [f],
          tmdbId: f.tmdbId || null,
          imdbId: f.imdbId || null,
        });
      } else {
        const grp = docMap.get(key);
        grp.files.push(f);
        if (!grp.tmdbId && f.tmdbId) grp.tmdbId = f.tmdbId;
      }
    }
    for (const grp of docMap.values()) {
      generatedTitles.push({
        id: String(grp.id),
        tipo: 'documental',
        isSaga: false,
        grupo: groupName,
        nombre: grp.nombre,
        yearHint: grp.yearHint,
        origen: { tipo: 'externo', channelId: String(virtualId), messageId: grp.files[0].messageId },
        channel: channelRecord,
        archivos: grp.files,
        ultimoMensajeFecha: grp.files.reduce((m, f) => Math.max(m, f.date || 0), 0),
        tmdbId: grp.tmdbId,
        imdbId: grp.imdbId,
      });
    }
  } else if (category === 'Series') {
    const seriesMap = new Map();
    for (const f of detectedFiles) {
      const sName = seriesNameFromFile(f.captionFileName || f.fileName) || groupName;
      const key = sName.toLowerCase().trim();
      if (!seriesMap.has(key)) {
        seriesMap.set(key, {
          id: `${virtualId}#${sName}`,
          nombre: sName,
          files: [f],
          tmdbId: f.tmdbId || null,
          imdbId: f.imdbId || null,
        });
      } else {
        const grp = seriesMap.get(key);
        grp.files.push(f);
        if (!grp.tmdbId && f.tmdbId) grp.tmdbId = f.tmdbId;
      }
    }

    for (const grp of seriesMap.values()) {
      grp.files.sort((a, b) => (a.season - b.season) || (a.episode - b.episode) || (a.date - b.date));
      generatedTitles.push({
        id: String(grp.id),
        tipo: 'serie',
        isSaga: false,
        grupo: groupName,
        nombre: grp.nombre,
        origen: { tipo: 'externo', channelId: String(virtualId) },
        channel: channelRecord,
        archivos: grp.files,
        ultimoMensajeFecha: grp.files.reduce((m, f) => Math.max(m, f.date || 0), 0),
        tmdbId: grp.tmdbId,
        imdbId: grp.imdbId,
      });
    }
  } else {
    const tipo = category === 'Deportes' ? 'deporte' : 'musica';
    const sortedFiles = [...detectedFiles].sort((a, b) => (b.date || 0) - (a.date || 0));
    generatedTitles.push({
      id: String(virtualId),
      tipo,
      isSaga: false,
      grupo: groupName,
      nombre: groupName,
      origen: { tipo: 'externo', channelId: String(virtualId) },
      channel: channelRecord,
      archivos: sortedFiles,
      ultimoMensajeFecha: sortedFiles.reduce((m, f) => Math.max(m, f.date || 0), 0),
      tmdbId: sortedFiles.find(f => f.tmdbId)?.tmdbId || null,
      imdbId: sortedFiles.find(f => f.imdbId)?.imdbId || null,
    });
  }

  return generatedTitles;
}

export async function renderChannelsTab({ mainPanel, client, kv, titles = [], tg }) {
  mainPanel.innerHTML = `
    <div class="admin-panel-header">
      <div class="admin-panel-title">
        <h2>Añadir canales/grupos/temas Externos</h2>
        <p>Explora tus canales y grupos de Telegram (incluyendo temas individuales en foros) para incorporarlos a la base de datos de la biblioteca o desvincularlos.</p>
      </div>
      <div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
        <button class="btn-secondary" data-focusable id="btn-view-ext-videos">📁 Vista total canales externos</button>
        <button class="btn-primary" data-focusable id="btn-load-ext-channels">Cargar canales/grupos disponibles</button>
      </div>
    </div>
    <div id="admin-ext-total-view" style="display:none;margin-bottom:1.5rem;"></div>
    <div id="admin-channels-result">
      <p style="color:#aaa;">Pulsa el botón superior para listar los canales, grupos y temas en los que participas.</p>
    </div>
  `;

  const loadBtn = document.getElementById('btn-load-ext-channels');
  const viewExtBtn = document.getElementById('btn-view-ext-videos');
  const totalViewContainer = document.getElementById('admin-ext-total-view');
  const resultContainer = document.getElementById('admin-channels-result');

  let extViewVisible = false;
  viewExtBtn?.addEventListener('click', () => {
    extViewVisible = !extViewVisible;
    if (extViewVisible) {
      totalViewContainer.style.display = 'block';
      viewExtBtn.textContent = '📁 Ocultar vista total';
      renderExternalVideosTotalView(totalViewContainer, { kv, titles, tg });
    } else {
      totalViewContainer.style.display = 'none';
      viewExtBtn.textContent = '📁 Vista total canales externos';
    }
  });

  loadBtn?.addEventListener('click', async () => {
    if (!client) {
      resultContainer.innerHTML = `<p style="color:#f87171;">Cliente de Telegram no disponible en esta sesión.</p>`;
      return;
    }

    loadBtn.disabled = true;
    loadBtn.textContent = 'Consultando Telegram…';
    resultContainer.innerHTML = `<p style="color:#38bdf8;">Cargando canales, grupos y temas desde Telegram…</p>`;

    try {
      const extSaved = (await kv.get(EXT_KEY).catch(() => [])) || [];
      const addedIdsSet = new Set(extSaved.map(x => String(x.id)));

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

      const renderDialogsTree = () => {
        resultContainer.innerHTML = `
          <div class="admin-topic-tree">
            ${dialogs.map((d, dIdx) => {
              const hasTopics = d.isForum && d.topics.length > 0;
              const channelAdded = addedIdsSet.has(String(d.id));
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
                        ${channelAdded ? `<span class="admin-badge" style="background:#065f46;color:#34d399;border:1px solid #10b981;">✓ En biblioteca</span>` : ''}
                      </div>
                      <small style="color:#888;">ID: ${esc(d.id)}</small>
                    </div>

                    <div style="display:flex;align-items:center;gap:0.6rem;flex:0 0 auto;">
                      ${hasTopics ? `
                        <button class="btn-secondary admin-btn-sm btn-toggle-topics" data-focusable data-didx="${dIdx}">
                          Ver temas (${d.topics.length}) ▼
                        </button>
                        ${channelAdded ? `
                          <button class="btn-danger admin-btn-sm btn-remove-channel-action" data-focusable data-didx="${dIdx}">
                            Quitar de la base de datos
                          </button>
                        ` : `
                          <button class="btn-secondary admin-btn-sm btn-add-full-group" data-focusable data-didx="${dIdx}">
                            Añadir grupo completo
                          </button>
                        `}
                      ` : `
                        ${channelAdded ? `
                          <button class="btn-danger admin-btn-sm btn-remove-channel-action" data-focusable data-didx="${dIdx}">
                            Quitar de la base de datos
                          </button>
                        ` : `
                          <button class="btn-secondary admin-btn-sm btn-add-channel-action" data-focusable data-didx="${dIdx}">
                            Añadir a la base de datos
                          </button>
                        `}
                      `}
                    </div>
                  </div>

                  ${hasTopics ? `
                    <div class="admin-topics-nested" id="topics-nested-${dIdx}" style="display:none;">
                      <div style="font-size:0.82rem;color:#94a3b8;margin-bottom:0.3rem;">
                        Selecciona un tema individual para incorporarlo como sección propia:
                      </div>
                      ${d.topics.map(t => {
                        const topVirtualId = `${d.id}_top_${t.id}`;
                        const topicAdded = addedIdsSet.has(topVirtualId);
                        return `
                          <div class="admin-topic-row">
                            <div style="display:flex;align-items:center;gap:0.5rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
                              <span style="color:#38bdf8;font-weight:700;">#</span>
                              <span style="font-size:0.9rem;color:#e2e8f0;">${esc(t.title)}</span>
                              <span class="admin-badge admin-badge-topic">Tema ID: ${t.id}</span>
                              ${topicAdded ? `<span class="admin-badge" style="background:#065f46;color:#34d399;border:1px solid #10b981;">✓ En biblioteca</span>` : ''}
                            </div>
                            ${topicAdded ? `
                              <button class="btn-danger admin-btn-sm btn-remove-topic-action" data-focusable data-didx="${dIdx}" data-topid="${t.id}" data-toptitle="${esc(t.title)}">
                                Quitar de la base de datos
                              </button>
                            ` : `
                              <button class="btn-primary admin-btn-sm btn-add-topic-action" data-focusable data-didx="${dIdx}" data-topid="${t.id}" data-toptitle="${esc(t.title)}">
                                Añadir este tema
                              </button>
                            `}
                          </div>
                        `;
                      }).join('')}
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
          </div>
        `;

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

        resultContainer.querySelectorAll('.btn-add-channel-action, .btn-add-full-group').forEach(btn => {
          btn.addEventListener('click', () => {
            const didx = Number(btn.dataset.didx);
            const dialog = dialogs[didx];
            promptAddChannelOrTopic({
              dialog,
              topic: null,
              client,
              kv,
              titles,
              onSuccess: (vId) => {
                addedIdsSet.add(vId);
                renderDialogsTree();
              }
            });
          });
        });

        resultContainer.querySelectorAll('.btn-remove-channel-action').forEach(btn => {
          btn.addEventListener('click', async () => {
            const didx = Number(btn.dataset.didx);
            const dialog = dialogs[didx];
            const vId = String(dialog.id);
            await removeExternalSource({
              virtualId: vId,
              displayName: dialog.title,
              kv,
              titles,
              onRemoved: () => {
                addedIdsSet.delete(vId);
                renderDialogsTree();
              }
            });
          });
        });

        resultContainer.querySelectorAll('.btn-add-topic-action').forEach(btn => {
          btn.addEventListener('click', () => {
            const didx = Number(btn.dataset.didx);
            const topId = Number(btn.dataset.topid);
            const topTitle = btn.dataset.toptitle;
            const dialog = dialogs[didx];
            promptAddChannelOrTopic({
              dialog,
              topic: { id: topId, title: topTitle },
              client,
              kv,
              titles,
              onSuccess: (vId) => {
                addedIdsSet.add(vId);
                renderDialogsTree();
              }
            });
          });
        });

        resultContainer.querySelectorAll('.btn-remove-topic-action').forEach(btn => {
          btn.addEventListener('click', async () => {
            const didx = Number(btn.dataset.didx);
            const topId = Number(btn.dataset.topid);
            const topTitle = btn.dataset.toptitle;
            const dialog = dialogs[didx];
            const vId = `${dialog.id}_top_${topId}`;
            await removeExternalSource({
              virtualId: vId,
              displayName: `${dialog.title} (Tema: ${topTitle})`,
              kv,
              titles,
              onRemoved: () => {
                addedIdsSet.delete(vId);
                renderDialogsTree();
              }
            });
          });
        });
      };

      renderDialogsTree();
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

async function removeExternalSource({ virtualId, displayName, kv, titles, onRemoved }) {
  if (!confirm(`¿Deseas quitar "${displayName}" de la base de datos de la biblioteca?`)) {
    return;
  }

  try {
    const extList = (await kv.get(EXT_KEY).catch(() => [])) || [];
    const updatedExt = extList.filter(x => String(x.id) !== String(virtualId));
    await kv.set(EXT_KEY, updatedExt).catch(() => {});

    const savedObj = (await kv.get(LIB_KEY).catch(() => null)) || {};
    if (savedObj.cache) {
      delete savedObj.cache[virtualId];
    }
    if (Array.isArray(savedObj.channels)) {
      savedObj.channels = savedObj.channels.filter(c => String(c.id) !== String(virtualId));
    }
    await kv.set(LIB_KEY, savedObj).catch(() => {});
    await kv.set(`ext_files_${virtualId}`, null).catch(() => {});
    clearExternalChannelCache(virtualId);

    const kept = titles.filter(t => {
      const matchChannel = String(t.channel?.id) === String(virtualId);
      const matchOrigen = String(t.origen?.channelId) === String(virtualId);
      const matchPrefix = String(t.id).startsWith(`${virtualId}:`);
      return !matchChannel && !matchOrigen && !matchPrefix;
    });
    titles.length = 0;
    titles.push(...kept);

    alert(`"${displayName}" ha sido eliminado de la base de datos.`);
    onRemoved?.();
  } catch (err) {
    console.error('Error quitando fuente externa', err);
    alert('Error al quitar la fuente: ' + (err.message || String(err)));
  }
}

function promptAddChannelOrTopic({ dialog, topic, client, kv, titles, onSuccess }) {
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
        ¿Deseas escanear e incorporar los vídeos de <strong>${esc(displayName)}</strong> como canal de la biblioteca?
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
    startScanWithProgress({ dialog, topic, category, groupName, client, kv, titles, onSuccess });
  });
}

async function startScanWithProgress({ dialog, topic, category, groupName, client, kv, titles, onSuccess }) {
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
    const channelHash = String(dialog.entity?.accessHash || dialog.entity?.hash || '0');
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
            channelId,
            tgChannelId: channelId,
            hash: channelHash,
            accessHash: channelHash,
            name: groupName,
            group: groupName,
            category,
            title: targetLabel,
            isExternal: true,
            isTopic,
            topicId: topic?.id || null,
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
          ageRating: cap.ageRating || null,
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

    statusEl.textContent = `Estructurando ${detectedFiles.length} vídeos como títulos de ${category}…`;
    fillEl.style.width = '75%';

    const channelRecord = {
      id: virtualId,
      name: groupName,
      group: groupName,
      category,
      title: targetLabel,
      isExternal: true,
      isTopic,
      topicId: topic?.id || null,
      channelId,
      tgChannelId: channelId,
      hash: channelHash,
      accessHash: channelHash,
    };

    const savedObj = (await kv.get(LIB_KEY).catch(() => null)) || {};
    savedObj.cache = savedObj.cache || {};
    savedObj.cache[virtualId] = detectedFiles;
    savedObj.channels = savedObj.channels || [];
    savedObj.channels = savedObj.channels.filter(c => String(c.id) !== String(virtualId));
    savedObj.channels.push(channelRecord);
    await kv.set(LIB_KEY, savedObj).catch(e => console.warn('[admin] Error guardando en library_v2', e));
    await kv.set(`ext_files_${virtualId}`, detectedFiles).catch(() => {});
    clearExternalChannelCache(virtualId);

    const extList = (await kv.get(EXT_KEY).catch(() => [])) || [];
    const updatedExt = extList.filter(x => String(x.id) !== String(virtualId));
    updatedExt.push({
      id: virtualId,
      channelId,
      isTopic,
      topicId: topic?.id || null,
      title: targetLabel,
      groupName,
      category,
      hash: channelHash,
      accessHash: channelHash,
      filesCount: detectedFiles.length,
      savedAt: Date.now()
    });
    await kv.set(EXT_KEY, updatedExt).catch(() => {});

    // Construcción de títulos modular
    const generatedTitles = buildTitlesForExternalChannel(channelRecord, detectedFiles);

    const kept = titles.filter(t => String(t.channel?.id) !== String(virtualId));
    titles.length = 0;
    titles.push(...kept, ...generatedTitles);

    fillEl.style.width = '100%';
    if (addedEl) addedEl.innerHTML = `Vídeos: <strong>${detectedFiles.length} / ${detectedFiles.length}</strong>`;
    statusEl.textContent = `✓ Se han detectado ${detectedFiles.length} vídeos (${generatedTitles.length} títulos). Pulsa para buscar metadatos en TMDB y finalizar.`;

    
    // Botón de finalización rápida sin demora de TMDB
    cancelBtn.textContent = 'Guardar y Finalizar (Rápido)';
    cancelBtn.className = 'btn-primary';
    cancelBtn.disabled = false;

    // Crear botón opcional de TMDB
    let tmdbBtn = progressOverlay.querySelector('#prog-tmdb-btn');
    if (!tmdbBtn) {
      tmdbBtn = document.createElement('button');
      tmdbBtn.id = 'prog-tmdb-btn';
      tmdbBtn.className = 'btn-secondary';
      tmdbBtn.style.marginRight = '0.8rem';
      tmdbBtn.textContent = 'Identificar en TMDB (Opcional)';
      cancelBtn.parentNode.insertBefore(tmdbBtn, cancelBtn);
    }


    
    cancelBtn.onclick = () => {
      progressOverlay.remove();
      onSuccess?.();
    };

    if (tmdbBtn) {
      tmdbBtn.onclick = async () => {
        tmdbBtn.disabled = true;
        cancelBtn.disabled = true;
        tmdbBtn.textContent = 'Identificando en TMDB…';

      fillEl.style.width = '0%';
      if (addedEl) addedEl.innerHTML = `Identificados: <strong>0 / ${generatedTitles.length}</strong>`;
      statusEl.textContent = `Identificando títulos con TMDB (0/${generatedTitles.length})…`;

      const idController = new AbortController();
      let tmdbDone = 0;
      try {
        await enrichTitles(generatedTitles, {
          signal: idController.signal,
          onProgress: (d, total) => {
            tmdbDone = d;
            const pct = Math.round((d / Math.max(1, total)) * 100);
            fillEl.style.width = `${pct}%`;
            if (addedEl) addedEl.innerHTML = `Identificados: <strong>${d} / ${total}</strong>`;
            statusEl.textContent = `Identificando títulos con TMDB (${d}/${total})…`;
          },
        });

        // Persistir metadatos en LIB_KEY
        const curSaved = (await kv.get(LIB_KEY).catch(() => null)) || {};
        curSaved.metadataMap = curSaved.metadataMap || {};
        for (const t of generatedTitles) {
          if (t.metadata) {
            curSaved.metadataMap[t.id] = {
              id: t.metadata.id,
              name: t.metadata.name,
              poster: t.metadata.poster,
              background: t.metadata.background,
              logo: t.metadata.logo,
              overview: t.metadata.overview,
              tipo: t.metadata.tipo,
              year: t.metadata.year,
              ageRating: t.metadata.ageRating,
              genres: t.metadata.genres,
              voteAverage: t.metadata.voteAverage,
            };
          }
          if (Array.isArray(t.archivos)) {
            for (const f of t.archivos) {
              if (f.metadata) {
                const fKey = f.key || `${t.channel?.id || t.id}:${f.messageId}`;
                curSaved.metadataMap[fKey] = f.metadata;
              }
            }
          }
        }
        await kv.set(LIB_KEY, curSaved).catch(() => {});
        statusEl.textContent = `✓ ¡Identificación completada! Se identificaron ${tmdbDone} títulos con TMDB.`;
        fillEl.style.width = '100%';
        await new Promise(r => setTimeout(r, 600));
      } catch (tmdbErr) {
        console.warn('[admin] Error durante enriquecimiento TMDB', tmdbErr);
      } finally {
        progressOverlay.remove();
        onSuccess?.(virtualId);
        }
      };
    }
  } catch (err) {
    console.error('Error durante el escaneo', err);
    statusEl.textContent = `Error: ${esc(err.message || String(err))}`;
    cancelBtn.textContent = 'Cerrar';
    cancelBtn.disabled = false;
    cancelBtn.onclick = () => progressOverlay.remove();
  }
}


async function renderExternalVideosTotalView(container, { kv, titles, tg }) {
  container.innerHTML = `<div style="padding:1rem;color:#38bdf8;">Cargando archivos de canales externos…</div>`;
  try {
    const extSaved = (await kv.get(EXT_KEY).catch(() => [])) || [];
    if (!extSaved.length) {
      container.innerHTML = `
        <div style="background:#181c24;border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:1.2rem;text-align:center;color:#aaa;">
          No hay canales externos añadidos todavía. Usa el botón "Cargar canales/grupos disponibles" para añadir alguno.
        </div>
      `;
      return;
    }

    const savedLib = (await kv.get(LIB_KEY).catch(() => null)) || {};
    const cache = savedLib.cache || {};
    const extIds = new Set(extSaved.map(x => String(x.id)));

    // Recoger archivos de canales externos desde memoria y desde caché
    const filesMap = new Map();

    // 1. Desde titles en memoria
    for (const t of (titles || [])) {
      const chId = String(t.channel?.id || t.origen?.channelId || '');
      if (extIds.has(chId) || t.channel?.isExternal) {
        const extMatch = extSaved.find(x => String(x.id) === chId);
        const chName = extMatch?.name || t.channel?.title || t.channel?.name || chId;
        for (const f of (t.archivos || [])) {
          const key = f.key || `${chId}:${f.messageId}`;
          if (!filesMap.has(key)) {
            const hasTmdb = Boolean(f.tmdbId || t.tmdbId || t.metadata?.id || f.metadata?.id);
            filesMap.set(key, {
              key,
              chId,
              chName,
              messageId: f.messageId,
              fileName: f.captionFileName || f.fileName || f.label || `video_${f.messageId}`,
              shownName: f.label || t.nombre || f.fileName,
              date: f.date || 0,
              size: f.size || 0,
              tmdbId: f.tmdbId || t.tmdbId || t.metadata?.id || null,
              tmdbTitle: t.metadata?.name || f.metadata?.name || null,
              hasTmdb,
              fileRef: f,
              titleRef: t,
            });
          }
        }
      }
    }

    // 2. Desde caché guardada
    for (const ext of extSaved) {
      const chId = String(ext.id);
      let chFiles = cache[chId] || [];
      if (!Array.isArray(chFiles) || chFiles.length === 0) {
        chFiles = (await kv.get(`ext_files_${chId}`).catch(() => [])) || [];
      }
      const chName = ext.name || ext.title || ext.group || chId;
      for (const f of chFiles) {
        const key = f.key || `${chId}:${f.messageId}`;
        if (!filesMap.has(key)) {
          const hasTmdb = Boolean(f.tmdbId || f.metadata?.id);
          filesMap.set(key, {
            key,
            chId,
            chName,
            messageId: f.messageId,
            fileName: f.captionFileName || f.fileName || f.label || `video_${f.messageId}`,
            shownName: f.label || f.fileName,
            date: f.date || 0,
            size: f.size || 0,
            tmdbId: f.tmdbId || null,
            tmdbTitle: f.metadata?.name || null,
            hasTmdb,
            fileRef: f,
            titleRef: null,
          });
        }
      }
    }

    const allFiles = [...filesMap.values()];

    let currentSort = 'date_desc';
    let onlyUnidentified = false;

    function renderList() {
      let filtered = [...allFiles];
      if (onlyUnidentified) {
        filtered = filtered.filter(f => !f.hasTmdb);
      }

      if (currentSort === 'date_desc') {
        filtered.sort((a, b) => (b.date || 0) - (a.date || 0));
      } else if (currentSort === 'date_asc') {
        filtered.sort((a, b) => (a.date || 0) - (b.date || 0));
      } else if (currentSort === 'name_asc') {
        filtered.sort((a, b) => a.shownName.localeCompare(b.shownName, 'es'));
      }

      const listEl = container.querySelector('#admin-ext-list-items');
      const countEl = container.querySelector('#admin-ext-count-text');
      if (countEl) {
        countEl.textContent = `Mostrando ${filtered.length} de ${allFiles.length} vídeos (${extSaved.length} canales externos)`;
      }

      if (!listEl) return;

      if (!filtered.length) {
        listEl.innerHTML = `<div style="padding:1.5rem;text-align:center;color:#aaa;">No hay vídeos que coincidan con el filtro actual.</div>`;
        return;
      }

      listEl.innerHTML = filtered.map(item => {
        const dateStr = item.date ? new Date(item.date * 1000).toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Sin fecha';
        const sizeStr = formatBytes(item.size);
        return `
          <div class="admin-video-row" style="display:flex;align-items:center;justify-content:space-between;padding:0.7rem 0.9rem;border-bottom:1px solid rgba(255,255,255,0.06);background:rgba(255,255,255,0.015);gap:1rem;">
            <div style="display:flex;flex-direction:column;gap:0.25rem;overflow:hidden;flex:1;">
              <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
                <strong style="color:#fff;font-size:0.92rem;">${esc(item.shownName)}</strong>
                <span class="admin-badge admin-badge-channel" style="background:#0284c7;color:#fff;border-color:#38bdf8;font-size:0.75rem;">${esc(item.chName)}</span>
              </div>
              <div style="font-size:0.8rem;color:#888;display:flex;gap:0.8rem;flex-wrap:wrap;">
                <span>📄 Archivo: ${esc(item.fileName)}</span>
                <span>📅 Subida: ${esc(dateStr)}</span>
                <span>💾 ${esc(sizeStr)}</span>
              </div>
            </div>
            <div style="flex:0 0 auto;text-align:right;">
              ${item.hasTmdb ? `
                <span style="display:inline-flex;align-items:center;gap:0.3rem;background:rgba(52,211,153,0.15);color:#34d399;border:1px solid rgba(52,211,153,0.3);padding:0.25rem 0.6rem;border-radius:6px;font-size:0.8rem;">
                  ✓ TMDB: ${esc(item.tmdbTitle || item.tmdbId)}
                </span>
              ` : `
                <span style="display:inline-flex;align-items:center;gap:0.3rem;background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.3);padding:0.25rem 0.6rem;border-radius:6px;font-size:0.8rem;">
                  ⚠️ No identificada
                </span>
              `}
            </div>
          </div>
        `;
      }).join('');
    }

    container.innerHTML = `
      <div style="background:#181c24;border:1px solid rgba(255,255,255,0.14);border-radius:8px;padding:1rem;margin-bottom:1.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.8rem;">
          <div>
            <h3 style="margin:0 0 0.3rem;color:#fff;font-size:1.05rem;">📁 Vista total de canales externos añadidos</h3>
            <span id="admin-ext-count-text" style="color:#94a3b8;font-size:0.85rem;"></span>
          </div>
          <div style="display:flex;align-items:center;gap:0.8rem;flex-wrap:wrap;">
            <div style="display:flex;align-items:center;gap:0.4rem;">
              <label style="color:#aaa;font-size:0.85rem;">Ordenar por:</label>
              <select class="admin-select" id="admin-ext-sort-select" style="width:auto;padding:0.4rem 2rem 0.4rem 0.8rem;font-size:0.85rem;">
                <option value="date_desc">📅 Fecha de subida (más recientes)</option>
                <option value="date_asc">📅 Fecha de subida (más antiguos)</option>
                <option value="name_asc">🔤 Nombre (A - Z)</option>
              </select>
            </div>
            <label style="display:inline-flex;align-items:center;gap:0.4rem;color:#e2e8f0;font-size:0.85rem;cursor:pointer;">
              <input type="checkbox" id="admin-ext-filter-unidentified" style="cursor:pointer;" />
              Solo no identificadas
            </label>
          </div>
        </div>
        <div id="admin-ext-list-items" style="max-height:480px;overflow-y:auto;border-top:1px solid rgba(255,255,255,0.1);"></div>
      </div>
    `;

    container.querySelector('#admin-ext-sort-select')?.addEventListener('change', (e) => {
      currentSort = e.target.value;
      renderList();
    });

    container.querySelector('#admin-ext-filter-unidentified')?.addEventListener('change', (e) => {
      onlyUnidentified = Boolean(e.target.checked);
      renderList();
    });

    renderList();
  } catch (err) {
    console.error('Error en vista total de canales externos', err);
    container.innerHTML = `<div style="color:#f87171;padding:1rem;">Error cargando vista externa: ${esc(err.message || String(err))}</div>`;
  }
}
/**
 * Escanea o actualiza un único canal externo (rápido o completo) y refresca su almacenamiento.
 */
export async function scanSingleExternalChannel({ tg, sync, channelRecord, isFull = false }) {
  if (!tg || !channelRecord) return;
  const client = tg.getClient?.() || tg.client;
  if (!client) throw new Error('Cliente de Telegram no disponible');

  const channelId = String(channelRecord.channelId || channelRecord.tgChannelId || channelRecord.id).split('_top_')[0];
  const isTopic = Boolean(channelRecord.isTopic && channelRecord.topicId);
  const virtualId = isTopic ? `${channelId}_top_${channelRecord.topicId}` : String(channelRecord.id || channelId);

  let peer = channelRecord.entity;
  if (!peer) {
    try {
      peer = await client.getInputEntity(channelId);
    } catch (_) {
      try {
        const cleanId = channelId.replace(/^-100/, '').replace(/^-/, '');
        peer = await client.getInputEntity(`-100${cleanId}`);
      } catch (err) {
        throw new Error('No se pudo resolver el canal en Telegram: ' + (err.message || String(err)));
      }
    }
  }

  let existingFiles = [];
  let minId = 0;
  if (!isFull) {
    existingFiles = (await kv.get(`ext_files_${virtualId}`).catch(() => [])) || [];
    minId = existingFiles.reduce((m, f) => Math.max(m, Number(f.messageId || 0)), 0);
  }

  const iterOptions = {};
  if (isTopic) iterOptions.replyTo = channelRecord.topicId;
  if (minId > 0) iterOptions.minId = minId;

  const newDetected = [];
  for await (const msg of client.iterMessages(peer, iterOptions)) {
    if (isVideoMessage(msg)) {
      const rawCaption = msg.message || '';
      const cap = parseCaption(rawCaption);
      const captionFileName = cap.fileName ? cap.fileName.trim() : null;
      const rawFileName = getFileName(msg) || '';
      const fileName = captionFileName || rawFileName || `video_${msg.id}.mp4`;
      const ep = parseEpisode(fileName);
      const doc = msg.document || msg.media?.document;
      const durAttr = doc?.attributes?.find(a => a.className === 'DocumentAttributeVideo');

      newDetected.push({
        key: `${virtualId}:${msg.id}`,
        channelId: virtualId,
        messageId: msg.id,
        channel: channelRecord,
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
        ageRating: cap.ageRating || null,
        season: ep.season,
        episode: ep.episode,
        size: Number(doc?.size?.toString?.() || doc?.size || 0),
        duration: durAttr?.duration || 0,
        mimeType: doc?.mimeType || 'video/mp4',
        date: msg.date,
      });
    }
  }

  const finalFiles = isFull ? newDetected : [...newDetected, ...existingFiles];
  // Deduplicar por messageId
  const uniqueMap = new Map();
  finalFiles.forEach(f => {
    if (!uniqueMap.has(f.messageId)) uniqueMap.set(f.messageId, f);
  });
  const mergedFiles = Array.from(uniqueMap.values());

  // Guardar en kv
  await kv.set(`ext_files_${virtualId}`, mergedFiles).catch(() => {});
  const savedObj = (await kv.get(LIB_KEY).catch(() => null)) || {};
  savedObj.cache = savedObj.cache || {};
  savedObj.cache[virtualId] = mergedFiles;
  await kv.set(LIB_KEY, savedObj).catch(() => {});

  if (sync?.saveProfile) {
    await sync.saveProfile().catch(() => {});
  }
  return mergedFiles;
}
