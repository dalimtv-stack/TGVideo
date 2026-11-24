/** src/ui/externalsView.js
 * Vista dedicada para la sección "Externo", organizada en banners por canal
 * separados por temática (Películas, Series, Deportes, Música) sin mezclar con la biblioteca principal.
 */
import { focusFirst } from './dpad.js';
import { buildTitlesForExternalChannel } from './adminChannels.js';
import { createKV } from '../core/kv.js';

const kv = createKV();
const EXT_CHANNEL_TITLES_CACHE = new Map();

/**
 * Invalida la memoria caché en caliente de títulos de canales externos.
 */
export function clearExternalChannelCache(extId) {
  if (extId) {
    EXT_CHANNEL_TITLES_CACHE.delete(String(extId));
  } else {
    EXT_CHANNEL_TITLES_CACHE.clear();
  }
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const THEME_DEFS = [
  { id: 'movies', name: 'Películas', icon: '🎬', match: c => /^pel[ií]culas?$/i.test(c || '') },
  { id: 'series', name: 'Series', icon: '📺', match: c => /^series?$/i.test(c || '') },
  { id: 'sports', name: 'Deportes', icon: '⚽', match: c => /^deportes?$/i.test(c || '') },
  { id: 'music', name: 'Música', icon: '🎵', match: c => /^m[uú]sica$/i.test(c || '') },
  { id: 'other', name: 'Otros Canales', icon: '📁', match: () => true },
];

export function renderExternalsView({ tg, sync, profile, externalTitles = [], extSources = [], libraryViews, showHome, app }) {
  if (!app) app = document.getElementById('app');
  if (!app) return;

  const validSources = Array.isArray(extSources) ? extSources : [];
  
  // Asociar a cada canal externo sus títulos calculados o su contador
  const channelDataList = validSources.map(src => {
    const srcIdStr = String(src.id);
    let relatedTitles = EXT_CHANNEL_TITLES_CACHE.get(srcIdStr);
    if (!relatedTitles || relatedTitles.length === 0) {
      relatedTitles = externalTitles.filter(t => {
        const chId = String(t.channel?.id || t.origen?.channelId || '');
        return chId === srcIdStr || String(t.id).startsWith(srcIdStr);
      });
      if (relatedTitles.length > 0) {
        EXT_CHANNEL_TITLES_CACHE.set(srcIdStr, relatedTitles);
      }
    }

    // Contar el número total de archivos detectados
    const totalFiles = relatedTitles.reduce((acc, t) => acc + (t.archivos?.length || 1), 0);

    return {
      source: src,
      titles: relatedTitles,
      totalFiles: src.filesCount || totalFiles || 0,
    };
  });

  if (channelDataList.length === 0) {
    app.innerHTML = `
      <div class="externals-view-container" style="max-width: 900px; margin: 3rem auto; padding: 2rem; text-align: center;">
        <div style="font-size: 3.5rem; margin-bottom: 1rem;">📡</div>
        <h2 style="font-size: 1.8rem; font-weight: 700; margin-bottom: 0.8rem; color: #fff;">Sin canales externos configurados</h2>
        <p style="color: var(--theme-text-muted, #aaa); font-size: 1rem; line-height: 1.6; margin-bottom: 2rem;">
          Puedes vincular canales, grupos o foros de Telegram para explorar sus vídeos organizados por temáticas sin mezclarlos con tu colección principal.
        </p>
        <button type="button" id="btn-go-admin-ext" class="btn-primary" data-focusable style="padding: 0.8rem 1.8rem; font-size: 1rem; border-radius: 9999px; cursor: pointer;">
          ⚙️ Ir al Administrador para añadir canales
        </button>
      </div>
    `;

    document.getElementById('btn-go-admin-ext')?.addEventListener('click', () => {
      window.location.hash = '#admin';
    });
    focusFirst(app);
    return;
  }

  // Agrupar canales por temática
  const sections = [];
  const handledSourceIds = new Set();

  for (const theme of THEME_DEFS) {
    const matched = channelDataList.filter(item => {
      if (handledSourceIds.has(item.source.id)) return false;
      const cat = item.source.category || 'Películas';
      return theme.match(cat);
    });

    if (matched.length > 0) {
      matched.forEach(m => handledSourceIds.add(m.source.id));
      sections.push({
        theme,
        channels: matched,
      });
    }
  }

  const sectionsHtml = sections.map(({ theme, channels }) => `
    <section class="ext-theme-section" style="margin-bottom: 2.5rem;">
      <div class="ext-theme-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid rgba(255,255,255,0.08);">
        <div style="display: flex; align-items: center; gap: 0.6rem;">
          <span style="font-size: 1.4rem;">${theme.icon}</span>
          <h2 style="font-size: 1.3rem; font-weight: 700; color: #fff; margin: 0;">${theme.name}</h2>
        </div>
        <span style="font-size: 0.85rem; color: var(--theme-text-muted, #888); font-weight: 600;">
          ${channels.length} ${channels.length === 1 ? 'canal' : 'canales'}
        </span>
      </div>

      <div class="ext-banners-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.2rem;">
        ${channels.map(({ source: ch, titles, totalFiles }) => {
          const isTopic = Boolean(ch.isTopic || ch.topicId);
          const channelName = ch.groupName || ch.title || 'Canal externo';
          const subTitle = ch.title && ch.title !== channelName ? ch.title : (isTopic ? `Tema #${ch.topicId}` : (ch.group || ''));
          const countLabel = totalFiles > 0 ? `${totalFiles} vídeos` : `${titles.length} títulos`;

          return `
            <div class="ext-channel-banner card-interactive" 
                 tabindex="0" 
                 data-focusable 
                 data-ext-id="${esc(ch.id)}"
                 style="background: linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%);
                        border: 1px solid rgba(255,255,255,0.12);
                        border-radius: 14px;
                        padding: 1.25rem 1.4rem;
                        cursor: pointer;
                        display: flex;
                        flex-direction: column;
                        justify-content: space-between;
                        min-height: 140px;
                        position: relative;
                        overflow: hidden;
                        transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;">
              
              <div style="position: absolute; top: 0; left: 0; right: 0; height: 3px; background: linear-gradient(90deg, var(--theme-accent, #e50914), transparent);"></div>
              
              <div>
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.6rem;">
                  <span style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; color: var(--theme-accent, #e50914); background: rgba(229,9,20,0.12); padding: 0.2rem 0.55rem; border-radius: 9999px;">
                    ${esc(ch.category || theme.name)}
                  </span>
                  ${isTopic ? `<span style="font-size: 0.7rem; font-weight: 600; color: #38bdf8; background: rgba(56,189,248,0.15); padding: 0.15rem 0.5rem; border-radius: 9999px;">Tema</span>` : ''}
                </div>
                <h3 style="font-size: 1.15rem; font-weight: 700; color: #fff; margin: 0 0 0.35rem 0; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">
                  ${esc(channelName)}
                </h3>
                ${subTitle ? `<div style="font-size: 0.82rem; color: var(--theme-text-muted, #aaa); margin-bottom: 0.5rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${esc(subTitle)}</div>` : ''}
              </div>

              <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.06);">
                <span style="font-size: 0.85rem; font-weight: 600; color: #e2e8f0;">
                  📼 ${countLabel}
                </span>
                <span style="font-size: 0.82rem; font-weight: 700; color: var(--theme-accent, #e50914); display: inline-flex; align-items: center; gap: 0.3rem;">
                  Explorar <span style="font-size: 1rem;">➔</span>
                </span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    </section>
  `).join('');

  app.innerHTML = `
    <div class="externals-view-container" style="max-width: 1350px; margin: 0 auto; padding: 1.5rem 1.8rem 4rem 1.8rem;">
      <div class="externals-top-bar" style="margin-bottom: 2rem;">
        <h1 style="font-size: 2rem; font-weight: 800; color: #fff; margin: 0 0 0.4rem 0; letter-spacing: -0.5px;">Canales Externos</h1>
        <p style="color: var(--theme-text-muted, #aaa); font-size: 0.95rem; margin: 0;">
          Selecciona un canal para abrir su cuadrícula completa con opción de agrupar o ver archivos individuales.
        </p>
      </div>
      ${sectionsHtml}
    </div>
  `;

  // Asignar eventos de click y teclado a los banners
  app.querySelectorAll('.ext-channel-banner').forEach(banner => {
    const extId = banner.getAttribute('data-ext-id');
    const chItem = channelDataList.find(item => String(item.source.id) === String(extId));
    if (!chItem) return;

    const openChannelGrid = async () => {
      const ch = chItem.source;
      const targetExtId = String(ch.id);
      let channelTitles = chItem.titles;

      if (!channelTitles || channelTitles.length === 0) {
        channelTitles = EXT_CHANNEL_TITLES_CACHE.get(targetExtId);
      }

      if (!channelTitles || channelTitles.length === 0) {
        banner.style.opacity = '0.6';
        banner.style.pointerEvents = 'none';
        try {
          let cachedFiles = await kv.get(`ext_files_${targetExtId}`).catch(() => null);
          if (!Array.isArray(cachedFiles) || cachedFiles.length === 0) {
            const lib = await kv.get('library_v2').catch(() => null);
            cachedFiles = lib?.cache?.[targetExtId] || [];
          }

          if (Array.isArray(cachedFiles) && cachedFiles.length > 0) {
            channelTitles = buildTitlesForExternalChannel(ch, cachedFiles);
            EXT_CHANNEL_TITLES_CACHE.set(targetExtId, channelTitles);
            chItem.titles = channelTitles;
          } else {
            channelTitles = [];
          }
        } catch (err) {
          console.warn('[externalsView] Error cargando títulos del canal externo', ch.title, err);
          channelTitles = [];
        } finally {
          banner.style.opacity = '1';
          banner.style.pointerEvents = '';
        }
      }

      if (!channelTitles || channelTitles.length === 0) {
        alert('Este canal externo aún no tiene vídeos detectados en caché local. Puedes sincronizarlo o escanearlo desde Ajustes > Administrador.');
        return;
      }

      const titleName = ch.groupName || ch.title || 'Canal externo';

      libraryViews.showGroupGrid(tg, sync, profile, {
        id: `ext-${ch.id}`,
        title: titleName,
        items: channelTitles,
        gridItems: channelTitles,
        isExternal: true,
      });
    };

    banner.addEventListener('click', openChannelGrid);
    banner.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        openChannelGrid();
      }
    });
  });

  // Habilitar navegación D-Pad para TV
  focusFirst(app);
}
