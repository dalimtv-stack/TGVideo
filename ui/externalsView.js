// src/ui/externalsView.js
// Pestaña de Canales Externos: navegación por banners categorizados (Películas, Series, Deportes, Documentales, Música, Otros).
import { createKV } from '../core/kv.js';
import { focusFirst } from './dpad.js';
import { buildTitlesForExternalChannel, scanSingleExternalChannel, identifyTitlesInBulk } from './adminChannels.js';
import { EXT_CHANNEL_TITLES_CACHE, clearExternalChannelCache } from './externalTitlesCache.js';
export { EXT_CHANNEL_TITLES_CACHE, clearExternalChannelCache } from './externalTitlesCache.js';

const kv = createKV();
const EXT_KEY = 'external_sources_v1';
const LIB_KEY = 'library_v2';

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const THEME_DEFS = [
  { id: 'movies', name: 'Películas', icon: '🎬', match: c => /^pel[ií]culas?$/i.test(c || '') },
  { id: 'series', name: 'Series', icon: '📺', match: c => /^series?$/i.test(c || '') },
  { id: 'sports', name: 'Deportes', icon: '⚽', match: c => /^deportes?$/i.test(c || '') },
  { id: 'docs', name: 'Documentales', icon: '📜', match: c => /^documental(es)?$/i.test(c || '') },
  { id: 'music', name: 'Música', icon: '🎵', match: c => /^m[uú]sica$/i.test(c || '') },
  { id: 'other', name: 'Otros Canales', icon: '📁', match: () => true },
];

export async function changeExternalChannelCategory(channelId, newCategory, { sync, onUpdated } = {}) {
  if (!channelId || !newCategory) return;
  const targetId = String(channelId);

  // 1. Actualizar en external_sources_v1
  const sources = (await kv.get(EXT_KEY).catch(() => [])) || [];
  const src = sources.find(s => String(s.id) === targetId || String(s.channelId) === targetId);
  if (src) {
    src.category = newCategory;
    await kv.set(EXT_KEY, sources).catch(console.warn);
  }

  // 2. Actualizar en library_v2 (canales guardados)
  const libObj = (await kv.get(LIB_KEY).catch(() => null)) || {};
  if (libObj && Array.isArray(libObj.channels)) {
    const ch = libObj.channels.find(c => String(c.id) === targetId);
    if (ch) {
      ch.category = newCategory;
      await kv.set(LIB_KEY, libObj).catch(console.warn);
    }
  }

  // 3. Limpiar caché del canal para forzar reconstrucción de títulos con la nueva categoría
  clearExternalChannelCache(targetId);

  // 4. Sincronizar y callback
  if (sync?.saveProfile) {
    await sync.saveProfile().catch(() => {});
  }
  if (typeof onUpdated === 'function') {
    onUpdated(newCategory);
  }
}

export function renderExternalsView({
  tg,
  sync,
  profile,
  externalTitles = [],
  extSources = [],
  libraryViews,
  showHome,
  app,
}) {
  if (!app) app = document.getElementById('app');
  if (!app) return;

  const validSources = Array.isArray(extSources)
    ? extSources.filter(s => s && (s.id || s.channelId))
    : [];

  if (validSources.length === 0) {
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

  // Asociar a cada canal externo sus títulos calculados o su contador
  const channelDataList = validSources.map(src => {
    const srcIdStr = String(src.id ?? src.channelId);
    let relatedTitles = EXT_CHANNEL_TITLES_CACHE.get(srcIdStr);
    if (!relatedTitles || relatedTitles.length === 0) {
      relatedTitles = (externalTitles || []).filter(t => {
        const chId = String(t.channel?.id || t.origen?.channelId || '');
        return chId === srcIdStr || String(t.id).startsWith(srcIdStr);
      });
      if (relatedTitles.length > 0) {
        EXT_CHANNEL_TITLES_CACHE.set(srcIdStr, relatedTitles);
      }
    }

    const totalFiles = Number(src.filesCount) || relatedTitles.reduce((acc, t) => acc + (t.archivos?.length || 1), 0);

    return {
      source: src,
      titles: relatedTitles || [],
      totalFiles: totalFiles || 0,
    };
  });

  // Agrupar canales por temática respetando THEME_DEFS
  const sections = [];
  const handledSourceIds = new Set();

  for (const theme of THEME_DEFS) {
    const matched = channelDataList.filter(item => {
      const sId = item.source.id ?? item.source.channelId;
      if (handledSourceIds.has(sId)) return false;
      const cat = item.source.category || 'Películas';
      return theme.match(cat);
    });

    if (matched.length > 0) {
      matched.forEach(m => handledSourceIds.add(m.source.id ?? m.source.channelId));
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
          const channelName = ch.groupName || ch.title || ch.name || 'Canal externo';
          const subTitle = ch.title && ch.title !== channelName ? ch.title : (isTopic ? `Tema #${ch.topicId}` : (ch.group || ''));
          const countLabel = totalFiles > 0 ? `${totalFiles} vídeos` : `${titles.length} títulos`;
          const targetId = String(ch.id ?? ch.channelId);

          return `
            <div class="ext-channel-banner card-interactive"
                 tabindex="0"
                 data-focusable
                 data-ext-id="${esc(targetId)}"
                 role="button"
                 title="Click para explorar · Click derecho para opciones"
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
    <div class="externals-view-container" style="max-width: 1350px; margin: 0 auto; padding: 1.5rem 1.8rem 4rem 1.8rem; width: 100%; box-sizing: border-box;">
      <div class="externals-top-bar" style="margin-bottom: 2rem;">
        <h1 style="font-size: 2rem; font-weight: 800; color: #fff; margin: 0 0 0.4rem 0; letter-spacing: -0.5px;">Canales Externos</h1>
        <p style="color: var(--theme-text-muted, #aaa); font-size: 0.95rem; margin: 0;">
          Selecciona un canal para abrir su cuadrícula completa con opción de agrupar o ver archivos individuales.
        </p>
      </div>
      ${sectionsHtml}
    </div>
  `;

  // Cerrar menú contextual si se hace click fuera
  const removeBannerMenu = () => {
    document.getElementById('banner-context-menu')?.remove();
  };
  document.addEventListener('click', removeBannerMenu);

  // Asignar eventos de click y menú contextual a cada banner
  app.querySelectorAll('.ext-channel-banner').forEach(banner => {
    const extId = banner.getAttribute('data-ext-id');
    const chItem = channelDataList.find(item => String(item.source.id ?? item.source.channelId) === String(extId));
    if (!chItem) return;

    const ch = chItem.source;
    const channelName = ch.groupName || ch.title || ch.name || 'Canal externo';

    const loadChannelTitles = async () => {
      let titles = chItem.titles;
      if (!titles || titles.length === 0) {
        titles = EXT_CHANNEL_TITLES_CACHE.get(extId);
      }
      if (!titles || titles.length === 0) {
        let cachedFiles = await kv.get(`ext_files_${extId}`).catch(() => null);
        if (!Array.isArray(cachedFiles) || cachedFiles.length === 0) {
          const lib = await kv.get(LIB_KEY).catch(() => null);
          cachedFiles = lib?.cache?.[extId] || [];
        }
        if (Array.isArray(cachedFiles) && cachedFiles.length > 0) {
          titles = buildTitlesForExternalChannel(ch, cachedFiles);
          EXT_CHANNEL_TITLES_CACHE.set(extId, titles);
          chItem.titles = titles;
        } else {
          titles = [];
        }
      }
      return titles;
    };

    const openChannelGrid = async () => {
      removeBannerMenu();
      banner.style.opacity = '0.6';
      banner.style.pointerEvents = 'none';

      let channelTitles = [];
      try {
        channelTitles = await loadChannelTitles();
      } catch (err) {
        console.warn('[externalsView] Error cargando títulos del canal externo', ch.title, err);
      } finally {
        banner.style.opacity = '1';
        banner.style.pointerEvents = '';
      }

      if (libraryViews?.showGroupGrid) {
        libraryViews.showGroupGrid(tg, sync, profile, {
          id: `ext-${ch.id ?? ch.channelId}`,
          title: channelName,
          items: channelTitles || [],
          gridItems: channelTitles || [],
          isExternal: true,
          channel: ch,
          onRefreshRequested: async (isFull) => {
            await scanSingleExternalChannel({ tg, sync, channelRecord: ch, isFull });
            clearExternalChannelCache(extId);
            const updatedFiles = (await kv.get(`ext_files_${extId}`).catch(() => [])) || [];
            const newTitles = buildTitlesForExternalChannel(ch, updatedFiles);
            EXT_CHANNEL_TITLES_CACHE.set(extId, newTitles);
            return newTitles;
          },
        });
      }
    };

    banner.addEventListener('click', openChannelGrid);
    banner.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        openChannelGrid();
      }
    });

    // Menú contextual con clic derecho
    banner.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeBannerMenu();

      const menu = document.createElement('div');
      menu.id = 'banner-context-menu';
      menu.style.cssText = `
        position: fixed; z-index: 100050;
        background: #181c24; border: 1px solid rgba(255,255,255,0.18);
        border-radius: 10px; box-shadow: 0 12px 36px rgba(0,0,0,0.88);
        min-width: 250px; padding: 0.4rem 0; font-family: inherit; color: #fff; font-size: 0.88rem;
      `;

      const currentCat = ch.category || 'Películas';
      const catOptions = ['Películas', 'Series', 'Deportes', 'Documentales', 'Música'];

      menu.innerHTML = `
        <div style="padding: 0.5rem 0.95rem; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.82rem; color: #94a3b8;">
          <strong style="color: #fff; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 0.2rem;">${esc(channelName)}</strong>
          <span>Categoría actual: <b style="color: #38bdf8;">${esc(currentCat)}</b></span>
        </div>
        <div style="padding: 0.4rem 0.95rem 0.2rem; font-size: 0.75rem; text-transform: uppercase; color: #64748b; font-weight: 700;">
          Cambiar categoría a:
        </div>
        ${catOptions.map(cat => `
          <div class="banner-menu-item change-cat-btn ${cat === currentCat ? 'is-active' : ''}" data-cat="${esc(cat)}" style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.95rem; cursor: pointer; transition: background 0.15s;">
            <span>${cat === 'Películas' ? '🎬 Películas' : cat === 'Series' ? '📺 Series' : cat === 'Deportes' ? '⚽ Deportes' : cat === 'Documentales' ? '📜 Documentales' : '🎵 Música'}</span>
            ${cat === currentCat ? '<span style="color: #38bdf8; font-weight: 700;">✓</span>' : ''}
          </div>
        `).join('')}
        <div style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 0.35rem; padding-top: 0.35rem;">
          <div class="banner-menu-item" id="banner-action-bulk-id" style="display: flex; align-items: center; gap: 0.55rem; padding: 0.5rem 0.95rem; cursor: pointer; color: #c084fc;">
            <span>✨</span><span>Identificar en bloque con TMDB</span>
          </div>
          <div class="banner-menu-item" id="banner-action-quick-update" style="display: flex; align-items: center; gap: 0.55rem; padding: 0.5rem 0.95rem; cursor: pointer; color: #38bdf8;">
            <span>⚡</span><span>Actualización rápida</span>
          </div>
          <div class="banner-menu-item" id="banner-action-full-update" style="display: flex; align-items: center; gap: 0.55rem; padding: 0.5rem 0.95rem; cursor: pointer; color: #cbd5e1;">
            <span>🔄</span><span>Actualización completa</span>
          </div>
        </div>
      `;

      document.body.appendChild(menu);

      // Posicionar menú dentro del viewport
      const rect = menu.getBoundingClientRect();
      let left = e.clientX;
      let top = e.clientY;
      if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 10;
      if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 10;
      menu.style.left = `${Math.max(10, left)}px`;
      menu.style.top = `${Math.max(10, top)}px`;

      menu.querySelectorAll('.banner-menu-item').forEach(it => {
        it.addEventListener('mouseenter', () => { it.style.backgroundColor = '#252d3d'; });
        it.addEventListener('mouseleave', () => { it.style.backgroundColor = 'transparent'; });
      });

      menu.querySelectorAll('.change-cat-btn').forEach(btn => {
        btn.onclick = async (ev) => {
          ev.stopPropagation();
          removeBannerMenu();
          const newCat = btn.dataset.cat;
          if (newCat && newCat !== currentCat) {
            await changeExternalChannelCategory(extId, newCat, {
              sync,
              onUpdated: () => {
                ch.category = newCat;
                showHome?.(tg, sync, profile, { fast: true, selectedSection: 'externos' });
              },
            });
          }
        };
      });

      menu.querySelector('#banner-action-bulk-id')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        removeBannerMenu();
        const titles = await loadChannelTitles();
        await identifyTitlesInBulk(titles, {
          modalTitle: `Identificar: ${channelName}`,
          onComplete: () => {
            showHome?.(tg, sync, profile, { fast: true, selectedSection: 'externos' });
          },
        });
      });

      menu.querySelector('#banner-action-quick-update')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        removeBannerMenu();
        await scanSingleExternalChannel({ tg, sync, channelRecord: ch, isFull: false });
        clearExternalChannelCache(extId);
        showHome?.(tg, sync, profile, { fast: true, selectedSection: 'externos' });
      });

      menu.querySelector('#banner-action-full-update')?.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        removeBannerMenu();
        await scanSingleExternalChannel({ tg, sync, channelRecord: ch, isFull: true });
        clearExternalChannelCache(extId);
        showHome?.(tg, sync, profile, { fast: true, selectedSection: 'externos' });
      });
    };
  });

  focusFirst(app);
}
