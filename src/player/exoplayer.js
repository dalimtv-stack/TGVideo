// src/player/exoplayer.js
// Integración de ExoPlayer nativo para Android TV / APK con descarga de bloques bajo demanda de Telegram
import { getStream, readRange, openStream } from './stream.js';
import { formatTime, showToast, setupDoubleTapSkip, bindNextUp } from './ui-helpers.js';
import { saveProgress } from './progress.js';
import { playArtplayer } from './player.js';
import { getDeviceSettings } from '../ui/settings.js';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function playExoPlayer(opts) {
  const {
    client, peerOf, file, title, profile, resumeAt = 0, mount, sync, nextFile, onNext,
  } = opts;

  const isAndroidNative = typeof window !== 'undefined' &&
    (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform === 'android');
  const ExoPlayerPlugin = window.Capacitor?.Plugins?.ExoPlayerPlugin;

  if (!isAndroidNative || !ExoPlayerPlugin) {
    console.warn('[exoplayer] ExoPlayer no disponible en este entorno, usando ArtPlayer.');
    return playArtplayer(opts);
  }

  const media = file.media?.document || file.media;
  const size = Number(media.size);
  const mime = media.mimeType || 'video/mp4';
  const name = media.attributes?.find(a => a.fileName)?.fileName || 'video.mkv';
  const displayTitle = title?.nombre || title?.name || name;

  const stream = openStream({ client, media, size, mime, name });

  const devSettings = getDeviceSettings(profile);
  const skipSeconds = devSettings.skipSeconds || 10;

  mount.innerHTML = `
    <div class="player player-native player-exoplayer">
      <div class="player-tv-osd" id="pl-osd">
        <div class="player-osd-top">
          <button class="player-osd-back-btn" id="pl-btn-back" data-focusable title="Volver">←</button>
          <div class="player-osd-title">${escapeHtml(displayTitle)}</div>
          <button class="player-osd-badge" id="pl-badge-toggle" title="Cambiar a ArtPlayer" data-focusable>ExoPlayer ⇄</button>
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
            <button class="player-ctrl-btn" id="pl-btn-audio" data-focusable title="Pistas de Audio">
              <svg viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-subs" data-focusable title="Subtítulos">
              <svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-9 7H6.5v-1.5h4.5V11zm7 4h-4.5v-1.5H18V15zm0-3H12v-1.5h6V12z"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="player-osd-toast" id="pl-osd-toast"></div>
      <div class="player-loading" id="pl-loading">
        <div class="spinner"></div>
        <p>Iniciando ExoPlayer por hardware…</p>
      </div>
    </div>
  `;

  const playerEl = mount.querySelector('.player');
  const osd = mount.querySelector('#pl-osd');
  const loading = mount.querySelector('#pl-loading');
  const scrubber = mount.querySelector('#pl-scrubber');
  const scrubberFill = mount.querySelector('#pl-scrubber-fill');
  const timeCur = mount.querySelector('#pl-time-cur');
  const timeDur = mount.querySelector('#pl-time-dur');
  const iconPlay = mount.querySelector('#pl-icon-play');
  const iconPause = mount.querySelector('#pl-icon-pause');

  let currentDuration = 0;
  let currentPosition = resumeAt || 0;
  let isPlaying = false;
  let osdTimer = null;
  let destroyed = false;
  let lastProgressSave = 0;

  const showOsd = () => {
    osd.classList.remove('is-hidden');
    clearTimeout(osdTimer);
    if (isPlaying) {
      osdTimer = setTimeout(() => {
        if (!destroyed && isPlaying) osd.classList.add('is-hidden');
      }, 1500);
    }
  };

  const hideLoading = () => {
    if (loading) loading.style.display = 'none';
  };

  try {
    const { port } = await ExoPlayerPlugin.startStreamServer();
    await ExoPlayerPlugin.registerStream({ id: stream.id, size, mime, name });

    const streamUrl = `http://127.0.0.1:${port}/stream/${stream.id}/${encodeURIComponent(name)}`;

    // Escucha de peticiones de bloques Range desde ExoPlayer hacia Telegram
    const rangeListener = await ExoPlayerPlugin.addListener('needRange', async (ev) => {
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

    const readyListener = await ExoPlayerPlugin.addListener('onReady', (ev) => {
      hideLoading();
      document.body.classList.add('exoplayer-active');
      if (ev?.duration) {
        currentDuration = ev.duration;
        timeDur.textContent = formatTime(currentDuration);
      }
      showToast(playerEl, '▶ ExoPlayer conectado por hardware');
      showOsd();
    });

    const playingListener = await ExoPlayerPlugin.addListener('onPlayingChanged', (ev) => {
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

    const progressListener = await ExoPlayerPlugin.addListener('onPlaybackProgress', (ev) => {
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

      // Guardado periódico de progreso cada 5 segundos
      const now = Date.now();
      if (now - lastProgressSave > 5000 && currentDuration > 0) {
        lastProgressSave = now;
        const key = String(file.id || file.messageId || name);
        saveProgress(profile.id, key, Math.floor(currentPosition), Math.floor(currentDuration));
      }
    });

    const endedListener = await ExoPlayerPlugin.addListener('onEnded', () => {
      isPlaying = false;
      showOsd();
      if (nextFile && onNext) {
        onNext();
      }
    });

    // Iniciar reproducción
    await ExoPlayerPlugin.play({
      url: streamUrl,
      resumeAt: Math.floor(resumeAt),
      title: displayTitle
    });

    // Control de botones OSD
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

    mount.querySelector('#pl-badge-toggle').onclick = () => {
      closePlayer();
      opts.profile.player = 'artplayer';
      playArtplayer(opts);
    };

    const closePlayer = () => {
      if (destroyed) return;
      destroyed = true;
      document.body.classList.remove('exoplayer-active');
      clearTimeout(osdTimer);
      try {
        rangeListener?.remove?.();
        readyListener?.remove?.();
        playingListener?.remove?.();
        progressListener?.remove?.();
        endedListener?.remove?.();
      } catch (ignored) {}

      ExoPlayerPlugin.stop().catch(() => {});
      stream.close();

      const key = String(file.id || file.messageId || name);
      if (currentDuration > 0) {
        saveProgress(profile.id, key, Math.floor(currentPosition), Math.floor(currentDuration));
      }
      mount.innerHTML = '';
    };

    mount.querySelector('#pl-btn-back').onclick = closePlayer;

    // D-Pad y mando de TV
    playerEl.addEventListener('keydown', (e) => {
      showOsd();
      if (['Escape', 'GoBack', 'Back'].includes(e.key) || e.keyCode === 4 ||
          (e.key === 'Backspace' && !['INPUT', 'TEXTAREA'].includes(e.target.tagName))) {
        e.preventDefault();
        e.stopPropagation();
        closePlayer();
        return;
      }

      if (e.key === ' ' || e.key === 'MediaPlayPause') {
        e.preventDefault();
        ExoPlayerPlugin.togglePlay();
        return;
      }

      if (e.key === 'MediaFastForward') {
        e.preventDefault();
        const target = Math.min(currentDuration || currentPosition + skipSeconds, currentPosition + skipSeconds);
        ExoPlayerPlugin.seekTo({ position: target });
        return;
      }

      if (e.key === 'MediaRewind') {
        e.preventDefault();
        const target = Math.max(0, currentPosition - skipSeconds);
        ExoPlayerPlugin.seekTo({ position: target });
        return;
      }
    });

    playerEl.addEventListener('mousemove', showOsd);
    playerEl.addEventListener('click', showOsd);

    showOsd();

  } catch (err) {
    console.error('[exoplayer] Fallo al inicializar ExoPlayer:', err);
    document.body.classList.remove('exoplayer-active');
    return playArtplayer(opts);
  }
}
