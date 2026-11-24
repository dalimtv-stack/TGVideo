// src/ui/externalsView.js
// Pestaña de Canales Externos: navegación por banners categorizados (Películas, Series, Deportes, Documentales, Música, Otros).
import { createKV } from '../core/kv.js';
import { buildTitlesForExternalChannel, scanSingleExternalChannel } from './adminChannels.js';
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

const CATEGORY_ORDER = ['Películas', 'Series', 'Deportes', 'Documentales', 'Música', 'Otros'];

export async function changeExternalChannelCategory(channelId, newCategory, { sync, onUpdated }) {
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

  // 3. Limpiar caché del canal para forzar reconstrucción de títulos
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
  if (!app) return;

  const validSources = (extSources || []).filter(s => s && (s.id || s.channelId));
  if (validSources.length === 0) {
    app.innerHTML = `
      <div class="externals-view-empty" style="text-align: center; padding: 5rem 1.5rem; color: #94a3b8;">
        <div style="font-size: 3.5rem; margin-bottom: 1rem;">📡</div>
        <h2 style="color: #fff; font-size: 1.5rem; margin-bottom: 0.5rem;">No hay canales externos configurados</h2>
        <p style="max-width: 480px; margin: 0 auto 1.5rem; font-size: 0.95rem; line-height: 1.5;">
          Puedes agregar canales o temas de Telegram externos desde la sección de Administración para explorarlos aquí.
        </p>
      </div>`;
    return;
  }

  const grouped = new Map();
  CATEGORY_ORDER.forEach(cat => grouped.set(cat, []));

  validSources.forEach(src => {
    let cat = src.category || 'Otros';
    if (!CATEGORY_ORDER.includes(cat)) cat = 'Otros';
    grouped.get(cat).push(src);
  });

  let html = `<div class="externals-categories-container" style="display: flex; flex-direction: column; gap: 2.2rem; padding: 0.5rem 0 3rem;">`;

  CATEGORY_ORDER.forEach(cat => {
    const channelsInCat = grouped.get(cat) || [];
    if (channelsInCat.length === 0) return;

    html += `
      <section class="externals-category-section" data-category="${esc(cat)}">
        <h2 class="externals-category-title" style="font-size: 1.25rem; font-weight: 700; color: #fff; margin-bottom: 1rem; display: flex; align-items: center; gap: 0.6rem;">
          <span>${cat === 'Películas' ? '🎬' : cat === 'Series' ? '📺' : cat === 'Deportes' ? '⚽' : cat === 'Documentales' ? '📜' : cat === 'Música' ? '🎵' : '📁'}</span>
          <span>${esc(cat)}</span>
          <span style="font-size: 0.82rem; font-weight: 400; color: #94a3b8;">(${channelsInCat.length})</span>
        </h2>
        <div class="externals-banners-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.2rem;">
          ${channelsInCat.map(ch => {
            const titleName = ch.title || ch.name || 'Canal externo';
            const subtitle = ch.isTopic && ch.group ? `Tema en ${ch.group}` : (ch.group || 'Telegram');
            const targetExtId = String(ch.id ?? ch.channelId);
            return `
              <div class="ext-channel-banner" data-ext-id="${esc(targetExtId)}" data-focusable tabindex="0" role="button" aria-label="Abrir ${esc(titleName)}" title="Click para abrir · Click derecho para opciones">
                <div class="ext-banner-glow"></div>
                <div class="ext-banner-content">
                  <div class="ext-banner-badge">${esc(cat)}</div>
                  <h3 class="ext-banner-title">${esc(titleName)}</h3>
                  <p class="ext-banner-sub">${esc(subtitle)}</p>
                </div>
                <div class="ext-banner-icon">➔</div>
              </div>`;
          }).join('')}
        </div>
      </section>`;
  });

  html += '</div>';
  app.innerHTML = html;

  // Cerrar menú contextual si se hace click fuera
  const removeBannerMenu = () => {
    document.getElementById('banner-context-menu')?.remove();
  };
  document.addEventListener('click', removeBannerMenu);

  // Manejo de eventos en cada banner
  app.querySelectorAll('.ext-channel-banner').forEach(banner => {
    const extId = banner.dataset.extId;
    const ch = validSources.find(s => String(s.id ?? s.channelId) === String(extId));
    if (!ch) return;

    const titleName = ch.title || ch.name || 'Canal externo';

    // Click normal: abrir cuadrícula del canal
    banner.onclick = async () => {
      removeBannerMenu();
      banner.style.opacity = '0.7';

      let channelTitles = (externalTitles || []).filter(t => {
        const oId = String(t.origen?.channelId || t.channel?.id || '');
        return oId === extId || oId.startsWith(extId + ':');
      });

      if (!channelTitles || channelTitles.length === 0) {
        channelTitles = EXT_CHANNEL_TITLES_CACHE.get(extId);
      }

      if (!channelTitles || channelTitles.length === 0) {
        try {
          const cachedFiles = (await kv.get(`ext_files_${extId}`).catch(() => null)) || [];
          if (cachedFiles && cachedFiles.length > 0) {
            channelTitles = buildTitlesForExternalChannel(ch, cachedFiles);
            EXT_CHANNEL_TITLES_CACHE.set(extId, channelTitles);
          }
        } catch (e) {
          console.warn('[externalsView] Error cargando títulos de caché local', e);
        }
      }

      banner.style.opacity = '';

      if (libraryViews?.showGroupGrid) {
        libraryViews.showGroupGrid(tg, sync, profile, {
          id: `ext-${ch.id}`,
          title: titleName,
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

    // Click derecho: menú de opciones (cambiar categoría o actualizar)
    banner.oncontextmenu = (e) => {
      e.preventDefault();
      e.stopPropagation();
      removeBannerMenu();

      const menu = document.createElement('div');
      menu.id = 'banner-context-menu';
      menu.style.cssText = `
        position: fixed; z-index: 100050;
        background: #181c24; border: 1px solid rgba(255,255,255,0.18);
        border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,0.85);
        min-width: 230px; padding: 0.4rem 0; font-family: inherit; color: #fff; font-size: 0.88rem;
      `;

      const currentCat = ch.category || 'Otros';
      const catOptions = ['Películas', 'Series', 'Deportes', 'Documentales', 'Música'];

      menu.innerHTML = `
        <div style="padding: 0.45rem 0.9rem; border-bottom: 1px solid rgba(255,255,255,0.1); font-size: 0.8rem; color: #94a3b8;">
          <strong style="color: #fff; display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(titleName)}</strong>
          <span>Categoría actual: <b style="color: #38bdf8;">${esc(currentCat)}</b></span>
        </div>
        <div style="padding: 0.4rem 0.9rem 0.2rem; font-size: 0.78rem; text-transform: uppercase; color: #64748b; font-weight: 700;">
          Cambiar categoría a:
        </div>
        ${catOptions.map(cat => `
          <div class="banner-menu-item change-cat-btn ${cat === currentCat ? 'is-active' : ''}" data-cat="${esc(cat)}" style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 0.9rem; cursor: pointer; transition: background 0.15s;">
            <span>${cat === 'Películas' ? '🎬 Películas' : cat === 'Series' ? '📺 Series' : cat === 'Deportes' ? '⚽ Deportes' : cat === 'Documentales' ? '📜 Documentales' : '🎵 Música'}</span>
            ${cat === currentCat ? '<span style="color: #38bdf8;">✓</span>' : ''}
          </div>
        `).join('')}
        <div style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 0.3rem; padding-top: 0.3rem;">
          <div class="banner-menu-item" id="banner-action-quick-update" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.9rem; cursor: pointer; color: #38bdf8;">
            <span>⚡</span><span>Actualización rápida</span>
          </div>
          <div class="banner-menu-item" id="banner-action-full-update" style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.9rem; cursor: pointer; color: #cbd5e1;">
            <span>🔄</span><span>Actualización completa</span>
          </div>
        </div>
      `;

      document.body.appendChild(menu);

      // Posicionar menú
      const rect = menu.getBoundingClientRect();
      let left = e.clientX;
      let top = e.clientY;
      if (left + rect.width > window.innerWidth) left = window.innerWidth - rect.width - 8;
      if (top + rect.height > window.innerHeight) top = window.innerHeight - rect.height - 8;
      menu.style.left = `${Math.max(8, left)}px`;
      menu.style.top = `${Math.max(8, top)}px`;

      menu.querySelectorAll('.banner-menu-item').forEach(it => {
        it.addEventListener('mouseenter', () => { it.style.backgroundColor = '#2a3242'; });
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
}
