// src/player/exoplayer.js
// Integración de ExoPlayer nativo para Android TV / APK con túnel de streaming bajo demanda de Telegram
import { getStream, readRange, openStream } from './stream.js';
import { formatTime, showToast } from './ui-helpers.js';
import { saveProgress } from './progress.js';
import { getDeviceSettings } from '../ui/settings.js';
import { registerPlayerController, unregisterPlayerController } from '../ui/dpad.js';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function playExoPlayer(opts) {
  const {
    client, peerOf, file, title, profile, resumeAt = 0, mount, sync, nextFile, onNext, fallbackToArt, onClose,
  } = opts;

  const isAndroidNative = typeof window !== 'undefined' &&
    (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform === 'android');
  const ExoPlayerPlugin = window.Capacitor?.Plugins?.ExoPlayerPlugin;

  if (!isAndroidNative || !ExoPlayerPlugin) {
    console.warn('[exoplayer] ExoPlayer no disponible en este entorno, cambiando a ArtPlayer.');
    if (typeof fallbackToArt === 'function') return fallbackToArt();
    onClose?.();
    return;
  }

  const devSettings = getDeviceSettings(profile);
  const skipSeconds = Number(devSettings.skipSeconds || 10);

  let stream = null;
  let destroyed = false;
  let osdTimer = null;
  let currentDuration = 0;
  let currentPosition = resumeAt || 0;
  let isPlaying = false;
  let lastProgressSave = 0;

  mount.innerHTML = `
    <div class="player player-native player-exoplayer">
      <div class="player-tv-osd" id="pl-osd">
        <div class="player-osd-top">
          <button class="player-osd-back-btn" id="pl-btn-back" data-focusable title="Volver">←</button>
          <div class="player-osd-title" id="pl-title">Cargando…</div>
          <button class="player-osd-badge" id="pl-badge-toggle" title="Cambiar a ArtPlayer" data-focusable>ExoPlayer ⇄ ArtPlayer</button>
        </div>

        <div class="player-osd-bottom">
          <div class="player-timeline-row">
            <span class="player-osd-time" id="pl-time-cur">0:00</span>
            <div class="player-scrubber-track" id="pl-scrubber" tabindex="0" data-focusable role="slider" aria-label="Línea de tiempo">
              <div class="player-scrubber-fill" id="pl-scrubber-fill">
                <div class="player-scrubber-thumb"></div>
              </div>
            </div>
            <span class="player-osd-time" id="pl-time-dur">0:00</span>
          </div>

          <div class="player-controls-row">
            <button class="player-ctrl-btn" id="pl-btn-rw" data-focusable title="Atrasar ${skipSeconds}s">
              <svg viewBox="0 0 24 24"><path d="M11 16.07V7.93c0-.81-.91-1.28-1.54-.77l-4.99 4.07a.996.996 0 0 0 0 1.54l4.99 4.07c.63.51 1.54.04 1.54-.77zm8 0V7.93c0-.81-.91-1.28-1.54-.77l-4.99 4.07a.996.996 0 0 0 0 1.54l4.99 4.07c.63.51 1.54.04 1.54-.77z"/></svg>
            </button>
            <button class="player-ctrl-btn player-ctrl-btn-primary" id="pl-btn-playpause" data-focusable title="Reproducir/Pausar">
              <svg viewBox="0 0 24 24" id="pl-icon-play"><path d="M8 5v14l11-7z"/></svg>
              <svg viewBox="0 0 24 24" id="pl-icon-pause" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-ff" data-focusable title="Adelantar ${skipSeconds}s">
              <svg viewBox="0 0 24 24"><path d="M5.54 7.16 10.53 11.23a.996.996 0 0 1 0 1.54l-4.99 4.07c-.63.51-1.54.04-1.54-.77V7.93c0-.81.91-1.28 1.54-.77zm8 0 4.99 4.07a.996.996 0 0 1 0 1.54l-4.99 4.07c-.63.51-1.54.04-1.54-.77V7.93c0-.81.91-1.28 1.54-.77z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-audio" data-focusable title="Pistas de audio">🔊</button>
            <button class="player-ctrl-btn" id="pl-btn-subs" data-focusable title="Subtítulos">CC</button>
          </div>
        </div>
      </div>
      <div class="player-osd-toast" id="pl-osd-toast"></div>
      <div class="player-loading" id="pl-loading">
        <div class="spinner"></div>
        <p id="pl-status">Abriendo túnel de streaming para ExoPlayer…</p>
      </div>
    </div>
  `;

  const playerEl = mount.querySelector('.player');
  playerEl?.classList.add('native-android-app');
  const osd = mount.querySelector('#pl-osd');
  const loading = mount.querySelector('#pl-loading');
  const statusEl = mount.querySelector('#pl-status');
  const titleEl = mount.querySelector('#pl-title');
  const scrubber = mount.querySelector('#pl-scrubber');
  const scrubberFill = mount.querySelector('#pl-scrubber-fill');
  const timeCur = mount.querySelector('#pl-time-cur');
  const timeDur = mount.querySelector('#pl-time-dur');
  const iconPlay = mount.querySelector('#pl-icon-play');
  const iconPause = mount.querySelector('#pl-icon-pause');

  const seekBy = (delta) => {
    const current = currentPosition || 0;
    const target = Math.max(0, Math.min(currentDuration || Infinity, current + delta));
    ExoPlayerPlugin.seekTo({ position: target });
    showToast(playerEl, `${delta < 0 ? '⏪' : '⏩'} ${delta > 0 ? '+' : ''}${delta}s`);
    showOsd();
  };
  registerPlayerController({
    close: () => closePlayer(),
    onLeft: () => {
      if (document.querySelector('.player-tracks-overlay')) return;
      if (osd.classList.contains('is-hidden')) {
        seekBy(-skipSeconds);
        return;
      }
      const cur = document.activeElement;
      if (cur?.id === 'pl-badge-toggle') {
        mount.querySelector('#pl-btn-back')?.focus();
        showOsd();
        return;
      }
      if (cur?.id === 'pl-btn-back') { showOsd(); return; }
      if (cur?.classList.contains('player-ctrl-btn')) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')].filter(b => b.offsetParent);
        const idx = btns.indexOf(cur);
        if (idx > 0) btns[idx - 1].focus();
        showOsd();
        return;
      }
      if (cur === scrubber) {
        seekBy(-skipSeconds);
        return;
      }
      seekBy(-skipSeconds);
    },
    onRight: () => {
      if (document.querySelector('.player-tracks-overlay')) return;
      if (osd.classList.contains('is-hidden')) {
        seekBy(skipSeconds);
        return;
      }
      const cur = document.activeElement;
      if (cur?.id === 'pl-btn-back') {
        mount.querySelector('#pl-badge-toggle')?.focus();
        showOsd();
        return;
      }
      if (cur?.id === 'pl-badge-toggle') { showOsd(); return; }
      if (cur?.classList.contains('player-ctrl-btn')) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')].filter(b => b.offsetParent);
        const idx = btns.indexOf(cur);
        if (idx !== -1 && idx < btns.length - 1) btns[idx + 1].focus();
        showOsd();
        return;
      }
      if (cur === scrubber) {
        seekBy(skipSeconds);
        return;
      }
      seekBy(skipSeconds);
    },
    onUp: () => {
      if (document.querySelector('.player-tracks-overlay')) return;
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        scrubber.focus();
        return;
      }
      const cur = document.activeElement;
      if (cur?.classList.contains('player-ctrl-btn')) {
        scrubber.focus();
        showOsd();
        return;
      }
      if (cur === scrubber) {
        mount.querySelector('#pl-btn-back')?.focus();
        showOsd();
        return;
      }
      mount.querySelector('#pl-btn-back')?.focus();
      showOsd();
    },
    onDown: () => {
      if (document.querySelector('.player-tracks-overlay')) return;
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
        return;
      }
      const cur = document.activeElement;
      if (cur?.id === 'pl-btn-back' || cur?.id === 'pl-badge-toggle') {
        scrubber.focus();
        showOsd();
        return;
      }
      if (cur === scrubber) {
        mount.querySelector('#pl-btn-playpause')?.focus();
        showOsd();
        return;
      }
      mount.querySelector('#pl-btn-playpause')?.focus();
      showOsd();
    },
    onSelect: () => {
      if (document.querySelector('.player-tracks-overlay')) return;
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
        return;
      }
      const focused = document.activeElement;
      if (focused && focused !== scrubber && (focused.matches('[data-focusable]') || focused.tagName === 'BUTTON')) {
        focused.click();
      } else {
        ExoPlayerPlugin.togglePlay();
        showOsd();
      }
    },
  });

  const showOsd = () => {
    if (destroyed) return;
    osd.classList.remove('is-hidden');
    clearTimeout(osdTimer);
    if (isPlaying) {
      osdTimer = setTimeout(() => {
        if (!destroyed && isPlaying) osd.classList.add('is-hidden');
      }, 2000);
    }
  };

  const hideLoading = () => {
    if (loading) loading.style.display = 'none';
  };

  let rangeListener = null;
  let readyListener = null;
  let playingListener = null;
  let progressListener = null;
  let endedListener = null;

  const closePlayer = async ({ isSwitching = false } = {}) => {
    if (destroyed) return;
    destroyed = true;
    document.body.classList.remove('exoplayer-active');
    unregisterPlayerController();
    clearTimeout(osdTimer);
    try {
      rangeListener?.remove?.();
      readyListener?.remove?.();
      playingListener?.remove?.();
      progressListener?.remove?.();
      endedListener?.remove?.();
    } catch (_) {}

    await ExoPlayerPlugin.stop().catch(() => {});
    if (stream) stream.close();

    const fileKey = String(file?.id || file?.messageId || file?.key || '');
    if (currentDuration > 0 && fileKey) {
      saveProgress(profile.id, fileKey, Math.floor(currentPosition), Math.floor(currentDuration));
    }
    mount.innerHTML = '';
    if (!isSwitching) onClose?.();
  };

  try {
    const targetChannel = file?.channel || title?.channel;
    if (!targetChannel?.id || !targetChannel?.hash) throw new Error('Canal no encontrado para este archivo.');
    const peer = await peerOf(targetChannel);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (destroyed) return;
    if (!msg?.media?.document) throw new Error('Vídeo no encontrado en el canal.');

    const doc = msg.media.document;
    const size = Number(doc?.size?.toString?.() || doc?.size || file.size || 0);
    const mime = doc?.mimeType || file.mimeType || file.mime || 'video/mp4';
    const name = doc?.attributes?.find(a => a.fileName)?.fileName || file.fileName || file.label || 'video.mkv';
    const displayTitle = title?.nombre || title?.name || file.label || name;

    titleEl.textContent = displayTitle;

    stream = openStream({ client, media: msg.media, size, mime, name });

    const serverRes = await ExoPlayerPlugin.startStreamServer();
    const port = serverRes?.port;
    if (!port || port <= 0) throw new Error('No se pudo iniciar el servidor local de streaming.');

    await ExoPlayerPlugin.registerStream({ id: stream.id, size, mime, name });
    const streamUrl = `http://127.0.0.1:${port}/stream/${stream.id}/${encodeURIComponent(name)}`;

    rangeListener = await ExoPlayerPlugin.addListener('needRange', async (ev) => {
      if (destroyed) return;
      const { streamId, start, end, requestId } = ev;
      const s = getStream(streamId);
      if (!s) return;
      try {
        const chunk = await readRange(s, start, end);
        await fetch(`http://127.0.0.1:${port}/chunk?requestId=${encodeURIComponent(requestId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunk
        });
      } catch (err) {
        console.warn('[exoplayer] Error descargando bloque de Telegram:', err);
        await fetch(`http://127.0.0.1:${port}/error?requestId=${encodeURIComponent(requestId)}`, {
          method: 'POST'
        }).catch(() => {});
      }
    });

    readyListener = await ExoPlayerPlugin.addListener('onReady', (ev) => {
      hideLoading();
      document.body.classList.add('exoplayer-active');
      if (ev?.duration) {
        currentDuration = ev.duration;
        timeDur.textContent = formatTime(currentDuration);
      }
      showToast(playerEl, '▶ ExoPlayer conectado');
      showOsd();
    });

    playingListener = await ExoPlayerPlugin.addListener('onPlayingChanged', (ev) => {
      isPlaying = !!ev.isPlaying;
      if (iconPlay && iconPause) {
        iconPlay.style.display = isPlaying ? 'none' : 'block';
        iconPause.style.display = isPlaying ? 'block' : 'none';
      }
      if (isPlaying) {
        hideLoading();
        showOsd();
      }
    });

    progressListener = await ExoPlayerPlugin.addListener('onPlaybackProgress', (ev) => {
      if (destroyed) return;
      hideLoading();
      currentPosition = ev.currentTime || 0;
      if (ev.duration && ev.duration > 0) {
        currentDuration = ev.duration;
        timeDur.textContent = formatTime(currentDuration);
      }
      timeCur.textContent = formatTime(currentPosition);

      if (currentDuration > 0) {
        const pct = Math.min(100, Math.max(0, (currentPosition / currentDuration) * 100));
        scrubberFill.style.width = `${pct}%`;
      }

      const now = Date.now();
      if (now - lastProgressSave > 5000 && currentDuration > 0) {
        lastProgressSave = now;
        const fileKey = String(file?.id || file?.messageId || file?.key || '');
        if (fileKey) {
          saveProgress(profile.id, fileKey, Math.floor(currentPosition), Math.floor(currentDuration));
        }
      }
    });

    endedListener = await ExoPlayerPlugin.addListener('onEnded', () => {
      isPlaying = false;
      showOsd();
      if (nextFile && onNext) {
        onNext();
      }
    });

    // Iniciar reproducción nativa con ExoPlayer
    await ExoPlayerPlugin.play({
      url: streamUrl,
      resumeAt: Math.floor(resumeAt),
      title: displayTitle
    });

    // Controles táctiles y botones
    mount.querySelector('#pl-btn-playpause').onclick = () => {
      ExoPlayerPlugin.togglePlay();
      showOsd();
    };

    mount.querySelector('#pl-btn-rw').onclick = () => {
      const target = Math.max(0, currentPosition - skipSeconds);
      ExoPlayerPlugin.seekTo({ position: target });
      showToast(playerEl, `⏪ -${skipSeconds}s`);
      showOsd();
    };

    mount.querySelector('#pl-btn-ff').onclick = () => {
      const target = Math.min(currentDuration || currentPosition + skipSeconds, currentPosition + skipSeconds);
      ExoPlayerPlugin.seekTo({ position: target });
      showToast(playerEl, `+${skipSeconds}s ⏩`);
      showOsd();
    };


    mount.querySelector('#pl-badge-toggle').onclick = async () => {
      const devId = devSettings?.deviceId || 'device_default';
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('tgvideo_device_player', 'artplayer');
        if (profile?.id) localStorage.setItem(`tgvideo_player_${profile.id}`, 'artplayer');
      }
      if (!profile.devices) profile.devices = {};
      if (!profile.devices[devId]) profile.devices[devId] = {};
      profile.devices[devId].player = 'artplayer';
      profile.devices[devId].updated_at = Date.now();
      profile.player = 'artplayer';

      await closePlayer({ isSwitching: true });
      if (typeof fallbackToArt === 'function') fallbackToArt();
    };

    mount.querySelector('#pl-btn-back').onclick = closePlayer;

    const openNativeTrackMenu = async (kind) => {
      let result;
      try {
        result = await ExoPlayerPlugin.getTracks();
      } catch (error) {
        showToast(playerEl, `No se pudieron leer las pistas: ${error?.message || 'error'}`);
        return;
      }
      const tracks = Array.from(result?.[kind] || []);
      const overlay = document.createElement('div');
      overlay.className = 'player-tracks-overlay';
      const titleText = kind === 'audio' ? 'Pistas de audio' : 'Subtítulos';
      const labelFor = (track, index) => track.label || track.language || `${titleText} ${index + 1}`;
      const noneButton = kind === 'text' ? `<button class="player-track-option" data-disabled="true" data-focusable>Desactivados</button>` : '';
      overlay.innerHTML = `<div class="player-tracks-menu" role="dialog" aria-label="${titleText}"><div class="player-tracks-title"><span>${titleText}</span><button class="player-tracks-close" data-focusable aria-label="Cerrar">✕</button></div><div class="player-tracks-list">${noneButton}${tracks.map((track, index) => `<button class="player-track-option ${track.selected ? 'is-selected' : ''}" data-index="${index}" data-focusable>${escapeHtml(labelFor(track, index))}${track.selected ? ' ✓' : ''}</button>`).join('') || '<div class="player-track-empty">No hay pistas disponibles.</div>'}</div></div>`;
      playerEl.appendChild(overlay);
      const closeMenu = () => { overlay.remove(); (kind === 'audio' ? mount.querySelector('#pl-btn-audio') : mount.querySelector('#pl-btn-subs'))?.focus(); };
      overlay.querySelector('.player-tracks-close')?.addEventListener('click', closeMenu);
      overlay.querySelectorAll('.player-track-option').forEach((button) => button.addEventListener('click', async () => {
        try {
          if (button.dataset.disabled === 'true') await ExoPlayerPlugin.selectTrack({ type: 'text', enabled: false });
          else {
            const track = tracks[Number(button.dataset.index)];
            if (track) await ExoPlayerPlugin.selectTrack({ type: kind, group: track.group, track: track.track, enabled: true });
          }
          showToast(playerEl, `${titleText}: ${button.textContent.trim()}`);
          closeMenu();
        } catch (error) {
          showToast(playerEl, `No se pudo cambiar la pista: ${error?.message || 'error'}`);
        }
      }));
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === 'Back' || e.keyCode === 4) { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault(); e.stopPropagation();
          const options = [...overlay.querySelectorAll('[data-focusable]')].filter(el => !el.disabled);
          const current = options.indexOf(document.activeElement);
          const delta = e.key === 'ArrowUp' ? -1 : 1;
          options[Math.max(0, Math.min(options.length - 1, current + delta))]?.focus();
        }
      });
      overlay.querySelector('.player-track-option')?.focus();
    };
    mount.querySelector('#pl-btn-audio').onclick = () => openNativeTrackMenu('audio');
    mount.querySelector('#pl-btn-subs').onclick = () => openNativeTrackMenu('text');

    scrubber.onclick = (e) => {
      const rect = scrubber.getBoundingClientRect();
      if (rect.width && currentDuration > 0) {
        const pos = (e.clientX - rect.left) / rect.width;
        const target = Math.max(0, Math.min(currentDuration, pos * currentDuration));
        ExoPlayerPlugin.seekTo({ position: target });
        showOsd();
      }
    };

    // Eventos directos sobre el contenedor del reproductor
    playerEl.addEventListener('keydown', (e) => {
      showOsd();
      if (['Escape', 'GoBack', 'Back'].includes(e.key) || e.keyCode === 4 ||
          (e.key === 'Backspace' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName))) {
        e.preventDefault();
        e.stopPropagation();
        closePlayer();
        return;
      }

      if (e.key === 'MediaPlayPause') {
        e.preventDefault();
        ExoPlayerPlugin.togglePlay();
        return;
      }

      if (e.key === 'MediaFastForward') {
        e.preventDefault();
        seekBy(skipSeconds);
        return;
      }

      if (e.key === 'MediaRewind') {
        e.preventDefault();
        seekBy(-skipSeconds);
        return;
      }
    });

    playerEl.addEventListener('mousemove', showOsd);
    playerEl.addEventListener('click', showOsd);
    showOsd();

  } catch (err) {
    console.error('[exoplayer] Fallo al inicializar ExoPlayer:', err);
    document.body.classList.remove('exoplayer-active');
    statusEl.textContent = `No se pudo abrir ExoPlayer: ${err?.message || 'error desconocido'}.`;
    loading.style.display = 'flex';
    showToast(playerEl, 'Error con ExoPlayer. Cambiando a ArtPlayer…');
    if (typeof fallbackToArt === 'function') {
      await closePlayer({ isSwitching: true });
      return fallbackToArt();
    }
    await closePlayer();
  }
}
