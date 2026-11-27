// src/player/exoplayer.js
// Integración de ExoPlayer nativo para Android TV / APK con túnel de streaming bajo demanda de Telegram,
// soporte de Scrubbing Mode interactivo, SeekParameters optimizados y decodificación por hardware acelerada.
import { getStream, readRange, openStream } from './stream.js';
import { ensureConnected, resetExportedSenders } from '../core/telegram.js';
import { formatTime, showToast, bindNextUp } from './ui-helpers.js';
import { saveProgress } from './progress.js';
import { getDeviceSettings } from '../ui/settings.js';
import { badgeText, badgeTitle, nextPlayerId, playerLabel, setDevicePlayer } from './playerPrefs.js';
import { keepScreenOn } from './wakeLock.js';
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
    client, peerOf, file, title, profile, resumeAt = 0, mount, sync, nextFile, onNext, fallbackToArt, switchPlayer, onClose,
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

  // Activar modo transparente en html y body para que el reproductor nativo sea visible inmediatamente
  if (typeof document !== 'undefined') {
    document.documentElement.classList.add('exoplayer-active');
    document.body.classList.add('exoplayer-active');
    document.documentElement.style.backgroundColor = 'transparent';
    document.body.style.backgroundColor = 'transparent';
  }

  let osdTimer = null;
  let currentDuration = 0;
  let currentPosition = resumeAt || 0;
  let isPlaying = false;
  let lastProgressSave = 0;

  // Estado de Scrubbing interactivo
  let isScrubbing = false;
  let scrubPosition = 0;
  let scrubSeekTimeout = null;
  let dpadScrubDebounceTimer = null;

  mount.innerHTML = `
    <div class="player player-native player-exoplayer">
      <div class="player-tv-osd" id="pl-osd">
        <div class="player-osd-top">
          <button class="player-osd-back-btn" id="pl-btn-back" data-focusable title="Volver">←</button>
          <div class="player-osd-title" id="pl-title">Cargando…</div>
          <div class="player-osd-engine-box">
            <button class="player-osd-badge" id="pl-badge-toggle" title="${badgeTitle('exoplayer')}" data-focusable>${badgeText('exoplayer')}</button>
          </div>
        </div>

        <div class="player-osd-bottom">
          <div class="player-timeline-row">
            <span class="player-osd-time" id="pl-time-cur">0:00</span>
            <div class="player-scrubber-track" id="pl-scrubber" tabindex="0" data-focusable role="slider" aria-label="Línea de tiempo">
              <div class="player-scrubber-buffered" id="pl-scrubber-buf"></div>
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
  const scrubberBuf = mount.querySelector('#pl-scrubber-buf');
  const scrubberFill = mount.querySelector('#pl-scrubber-fill');
  const timeCur = mount.querySelector('#pl-time-cur');
  const timeDur = mount.querySelector('#pl-time-dur');
  const iconPlay = mount.querySelector('#pl-icon-play');
  const iconPause = mount.querySelector('#pl-icon-pause');

  const showOsd = () => {
    if (destroyed) return;
    osd.classList.remove('is-hidden');
    clearTimeout(osdTimer);
    if (isPlaying && !isScrubbing) {
      osdTimer = setTimeout(() => {
        if (!destroyed && isPlaying && !isScrubbing) osd.classList.add('is-hidden');
      }, 3000);
    }
  };

  const hideLoading = () => {
    if (loading) loading.style.display = 'none';
  };

  // 1. Gestión de Scrubbing interactivo
  const startScrubbing = async (initialTarget) => {
    if (isScrubbing) return;
    isScrubbing = true;
    scrubber.classList.add('is-scrubbing');
    clearTimeout(osdTimer);
    showOsd();
    try {
      if (typeof ExoPlayerPlugin.setScrubbingMode === 'function') {
        await ExoPlayerPlugin.setScrubbingMode({ enabled: true });
      }
    } catch (_) {}
    if (typeof initialTarget === 'number') {
      updateScrubPosition(initialTarget);
    }
  };

  const updateScrubPosition = (targetSeconds) => {
    if (currentDuration <= 0) return;
    const clamped = Math.max(0, Math.min(currentDuration, targetSeconds));
    scrubPosition = clamped;
    timeCur.textContent = formatTime(clamped);
    const pct = (clamped / currentDuration) * 100;
    scrubberFill.style.width = `${pct}%`;

    // Despacho agrupado de búsqueda rápida (CLOSEST_SYNC) para que el decodificador pinte keyframes al vuelo
    clearTimeout(scrubSeekTimeout);
    scrubSeekTimeout = setTimeout(() => {
      if (destroyed || !isScrubbing) return;
      ExoPlayerPlugin.seekTo({ position: clamped, fast: true }).catch(() => {});
    }, 70);
  };

  const stopScrubbing = async (finalTarget) => {
    if (!isScrubbing) return;
    isScrubbing = false;
    clearTimeout(scrubSeekTimeout);
    clearTimeout(dpadScrubDebounceTimer);
    scrubber.classList.remove('is-scrubbing');

    const target = typeof finalTarget === 'number' ? finalTarget : scrubPosition;
    currentPosition = target;
    timeCur.textContent = formatTime(target);

    try {
      // Posicionamiento final exacto
      await ExoPlayerPlugin.seekTo({ position: target, exact: true });
      if (typeof ExoPlayerPlugin.setScrubbingMode === 'function') {
        await ExoPlayerPlugin.setScrubbingMode({ enabled: false });
      }
    } catch (_) {}

    showOsd();
  };

  // Salto rápido para botones de avance / retroceso
  const fastSeekBy = async (delta) => {
    const current = isScrubbing ? scrubPosition : (currentPosition || 0);
    const target = Math.max(0, Math.min(currentDuration || Infinity, current + delta));
    currentPosition = target;
    timeCur.textContent = formatTime(target);
    if (currentDuration > 0) {
      scrubberFill.style.width = `${Math.min(100, Math.max(0, (target / currentDuration) * 100))}%`;
    }
    await ExoPlayerPlugin.seekTo({ position: target, fast: true }).catch(() => {});
    showToast(playerEl, `${delta < 0 ? '⏪' : '⏩'} ${delta > 0 ? '+' : ''}${delta}s`);
    showOsd();
  };

  // D-Pad controller registration
  registerPlayerController({
    close: () => closePlayer(),
    onPlayPause: () => {
      if (document.querySelector('.player-tracks-overlay')) return;
      if (isScrubbing) {
        stopScrubbing();
        return;
      }
      ExoPlayerPlugin.togglePlay();
      showToast(playerEl, isPlaying ? '⏸ Pausa' : '▶ Reproduciendo');
      showOsd();
    },
    onForward: () => {
      if (document.querySelector('.player-tracks-overlay')) return;
      fastSeekBy(skipSeconds);
    },
    onRewind: () => {
      if (document.querySelector('.player-tracks-overlay')) return;
      fastSeekBy(-skipSeconds);
    },
    onLeft: () => {
      if (document.querySelector('.player-tracks-overlay')) return;
      if (osd.classList.contains('is-hidden')) {
        fastSeekBy(-skipSeconds);
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
        // Scrubbing interactivo en la barra con D-pad
        if (!isScrubbing) {
          startScrubbing(currentPosition - skipSeconds);
        } else {
          updateScrubPosition(scrubPosition - skipSeconds);
        }
        clearTimeout(dpadScrubDebounceTimer);
        dpadScrubDebounceTimer = setTimeout(() => {
          if (isScrubbing) stopScrubbing();
        }, 500);
        return;
      }
      fastSeekBy(-skipSeconds);
    },
    onRight: () => {
      if (document.querySelector('.player-tracks-overlay')) return;
      if (osd.classList.contains('is-hidden')) {
        fastSeekBy(skipSeconds);
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
        // Scrubbing interactivo en la barra con D-pad
        if (!isScrubbing) {
          startScrubbing(currentPosition + skipSeconds);
        } else {
          updateScrubPosition(scrubPosition + skipSeconds);
        }
        clearTimeout(dpadScrubDebounceTimer);
        dpadScrubDebounceTimer = setTimeout(() => {
          if (isScrubbing) stopScrubbing();
        }, 500);
        return;
      }
      fastSeekBy(skipSeconds);
    },
    onUp: () => {
      if (document.querySelector('.player-tracks-overlay')) return;
      if (isScrubbing) {
        stopScrubbing();
      }
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
      if (isScrubbing) {
        stopScrubbing();
      }
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
      if (isScrubbing) {
        stopScrubbing();
        return;
      }
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

  let rangeListener = null;
  let readyListener = null;
  let playingListener = null;
  let progressListener = null;
  let endedListener = null;
  let metricListener = null;
  let nextUp = null;

  const closePlayer = async ({ isSwitching = false } = {}) => {
    if (destroyed) return;
    destroyed = true;
    if (typeof document !== 'undefined') {
      document.documentElement.classList.remove('exoplayer-active');
      document.body.classList.remove('exoplayer-active');
      document.documentElement.style.backgroundColor = '';
      document.body.style.backgroundColor = '';
    }
    unregisterPlayerController();
    clearTimeout(osdTimer);
    clearTimeout(scrubSeekTimeout);
    clearTimeout(dpadScrubDebounceTimer);
    keepScreenOn(false);
    if (nextUp?.remove) nextUp.remove();
    try {
      if (rangeListener?.remove) await rangeListener.remove();
      if (readyListener?.remove) await readyListener.remove();
      if (playingListener?.remove) await playingListener.remove();
      if (progressListener?.remove) await progressListener.remove();
      if (endedListener?.remove) await endedListener.remove();
      if (metricListener?.remove) await metricListener.remove();
      await ExoPlayerPlugin.removeAllListeners().catch(() => {});
    } catch (_) {}

    await ExoPlayerPlugin.stop().catch(() => {});
    if (stream) {
      try { stream.close(); } catch (_) {}
    }
    if (client) {
      try { await resetExportedSenders(client); } catch (_) {}
    }

    const fileKey = String(file?.key || file?.id || file?.messageId || '');
    if (currentDuration > 0 && fileKey) {
      const progress = saveProgress(profile.id, fileKey, Math.floor(currentPosition), Math.floor(currentDuration));
      if (sync && profile?.id) {
        try {
          sync.pushProfile({ profile, progress }).catch(() => {});
        } catch (_) {}
      }
    }
    mount.innerHTML = '';
    if (!isSwitching) onClose?.();
  };

  try {
    if (loading) loading.style.display = 'flex';
    if (statusEl) statusEl.textContent = 'Conectando con Telegram…';
    const targetChannel = file?.channel || title?.channel;
    const realChannelId = targetChannel?.tgChannelId || targetChannel?.channelId || String(targetChannel?.id || "").split("_top_")[0];
    if (!realChannelId) throw new Error('Canal no encontrado para este archivo.');
    if (statusEl) statusEl.textContent = 'Localizando archivo…';
    await ensureConnected(client, { forceResetSenders: true });
    let peer = null;
    try {
      peer = await peerOf(targetChannel);
    } catch (_) {}
    if (!peer || (!peer.accessHash && !peer.chatId && !peer.channelId)) {
      try {
        peer = await client.getInputEntity(realChannelId);
      } catch (entityErr) {
        console.warn("[exoplayer] Error resolviendo peer con getInputEntity", entityErr);
        if (peerOf) peer = await peerOf(targetChannel);
      }
    }
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (destroyed) return;
    if (!msg?.media?.document) throw new Error('Vídeo no encontrado en el canal.');
    if (statusEl) statusEl.textContent = 'Iniciando ExoPlayer…';

    const doc = msg.media.document;
    const size = Number(doc?.size?.toString?.() || doc?.size || file.size || 0);
    const mime = doc?.mimeType || file.mimeType || file.mime || 'video/mp4';
    const name = doc?.attributes?.find(a => a.fileName)?.fileName || file.fileName || file.label || 'video.mp4';
    const displayTitle = title?.nombre || title?.name || file.label || name;

    titleEl.textContent = displayTitle;

    await ensureConnected(client);
    stream = openStream({ client, media: msg.media, size, mime, name });

    const serverRes = await ExoPlayerPlugin.startStreamServer();
    const port = serverRes?.port;
    if (!port || port <= 0) throw new Error('No se pudo iniciar el servidor local de streaming.');

    await ExoPlayerPlugin.registerStream({ id: stream.id, size, mime, name });
    const streamUrl = `http://127.0.0.1:${port}/stream/${stream.id}/${encodeURIComponent(name)}`;

    try {
      await ExoPlayerPlugin.removeAllListeners().catch(() => {});
    } catch (_) {}

    rangeListener = await ExoPlayerPlugin.addListener('needRange', async (ev) => {
      const { streamId, start, end, requestId } = ev || {};
      if (!ev || streamId !== stream.id) return;
      if (destroyed || !requestId) {
        if (requestId) {
          fetch(`http://127.0.0.1:${port}/error?requestId=${encodeURIComponent(requestId)}`, { method: 'POST' }).catch(() => {});
        }
        return;
      }
      const s = getStream(streamId);
      if (!s) {
        await fetch(`http://127.0.0.1:${port}/error?requestId=${encodeURIComponent(requestId)}`, { method: 'POST' }).catch(() => {});
        return;
      }
      try {
        const chunk = await readRange(s, start, end);
        if (destroyed) {
          await fetch(`http://127.0.0.1:${port}/error?requestId=${encodeURIComponent(requestId)}`, { method: 'POST' }).catch(() => {});
          return;
        }
        await fetch(`http://127.0.0.1:${port}/chunk?requestId=${encodeURIComponent(requestId)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: chunk
        });
      } catch (err) {
        console.warn('[exoplayer] Error descargando bloque de Telegram:', err);
        await fetch(`http://127.0.0.1:${port}/error?requestId=${encodeURIComponent(requestId)}`, { method: 'POST' }).catch(() => {});
      }
    });

    readyListener = await ExoPlayerPlugin.addListener('onReady', (ev) => {
      hideLoading();
      if (typeof document !== 'undefined') {
        document.documentElement.classList.add('exoplayer-active');
        document.body.classList.add('exoplayer-active');
        document.documentElement.style.backgroundColor = 'transparent';
        document.body.style.backgroundColor = 'transparent';
      }
      if (ev?.duration) {
        currentDuration = ev.duration;
        timeDur.textContent = formatTime(currentDuration);
      }
      showToast(playerEl, '▶ ExoPlayer conectado');
      showOsd();
    });

    metricListener = await ExoPlayerPlugin.addListener('onPerformanceMetric', (ev) => {
      if (ev?.type === 'firstFrame') {
        console.info(`[exoplayer] Tiempo hasta primer fotograma: ${ev.elapsedMs} ms`);
      } else if (ev?.type === 'decoderInit') {
        console.info(`[exoplayer] Decodificador hardware: ${ev.decoder} (${ev.durationMs} ms)`);
      }
    });

    playingListener = await ExoPlayerPlugin.addListener('onPlayingChanged', (ev) => {
      isPlaying = !!ev.isPlaying;
      keepScreenOn(isPlaying);
      if (iconPlay && iconPause) {
        iconPlay.style.display = isPlaying ? 'none' : 'block';
        iconPause.style.display = isPlaying ? 'block' : 'none';
      }
      if (isPlaying) {
        hideLoading();
        showOsd();
      } else {
        const fileKey = String(file?.key || file?.id || file?.messageId || '');
        if (fileKey && currentDuration > 0) {
          const progress = saveProgress(profile.id, fileKey, Math.floor(currentPosition), Math.floor(currentDuration));
          if (sync && profile?.id) {
            try {
              sync.schedulePush({ profile, progress });
            } catch (_) {}
          }
        }
      }
    });

    nextUp = bindNextUp({
      getTime: () => currentPosition,
      getDuration: () => currentDuration,
      playerEl,
      nextFile,
      title,
      onNext: async (nf) => {
        await closePlayer({ isSwitching: true });
        onNext?.(nf);
      },
    });

    progressListener = await ExoPlayerPlugin.addListener('onPlaybackProgress', (ev) => {
      if (destroyed) return;
      hideLoading();

      if (ev.duration && ev.duration > 0) {
        currentDuration = ev.duration;
        timeDur.textContent = formatTime(currentDuration);
      }

      // Actualizar búfer cargado
      if (scrubberBuf && ev.bufferedTime && currentDuration > 0) {
        const bufPct = Math.min(100, Math.max(0, (ev.bufferedTime / currentDuration) * 100));
        scrubberBuf.style.width = `${bufPct}%`;
      }

      // Durante scrubbing no sobreescribir la posición visual interactiva
      if (!isScrubbing) {
        currentPosition = ev.currentTime || 0;
        timeCur.textContent = formatTime(currentPosition);

        if (currentDuration > 0) {
          const pct = Math.min(100, Math.max(0, (currentPosition / currentDuration) * 100));
          scrubberFill.style.width = `${pct}%`;
        }
      }

      nextUp.check();

      const now = Date.now();
      if (now - lastProgressSave > 5000 && currentDuration > 0) {
        lastProgressSave = now;
        const fileKey = String(file?.key || file?.id || file?.messageId || '');
        if (fileKey) {
          const progress = saveProgress(profile.id, fileKey, Math.floor(currentPosition), Math.floor(currentDuration));
          if (sync && profile?.id) {
            try {
              sync.schedulePush({ profile, progress });
            } catch (_) {}
          }
        }
      }
    });

    endedListener = await ExoPlayerPlugin.addListener('onEnded', () => {
      isPlaying = false;
      showOsd();
      const fileKey = String(file?.key || file?.id || file?.messageId || '');
      if (fileKey && currentDuration > 0) {
        const progress = saveProgress(profile.id, fileKey, Math.floor(currentDuration), Math.floor(currentDuration), true);
        if (sync && profile?.id) {
          try {
            sync.schedulePush({ profile, progress }, 0);
          } catch (_) {}
        }
      }
      if (nextFile && onNext) {
        closePlayer({ isSwitching: true });
        onNext(nextFile);
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

    mount.querySelector('#pl-btn-rw').onclick = () => fastSeekBy(-skipSeconds);
    mount.querySelector('#pl-btn-ff').onclick = () => fastSeekBy(skipSeconds);

    mount.querySelector('#pl-badge-toggle').onclick = async () => {
      const target = setDevicePlayer(profile, nextPlayerId('exoplayer'));
      showToast(playerEl, `Cambiando a ${playerLabel(target)}…`);
      const resume = currentPosition || resumeAt || 0;
      await closePlayer({ isSwitching: true });
      if (typeof switchPlayer === 'function') switchPlayer(resume);
      else if (typeof fallbackToArt === 'function') fallbackToArt();
    };

    mount.querySelector('#pl-btn-back').onclick = closePlayer;

    const openNativeTrackMenu = async (kind) => {
      if (!ExoPlayerPlugin || typeof ExoPlayerPlugin.getTracks !== 'function') {
        showToast(playerEl, 'Pistas no disponibles en este dispositivo');
        return;
      }
      let result = null;
      try {
        result = await ExoPlayerPlugin.getTracks();
        for (let attempt = 0; attempt < 4 && !(result?.audio?.length || result?.text?.length); attempt++) {
          await new Promise((r) => setTimeout(r, 700));
          result = await ExoPlayerPlugin.getTracks();
        }
      } catch (error) {
        console.warn('[exoplayer] getTracks error', error);
        showToast(playerEl, `No se pudieron leer las pistas: ${error?.message || 'error'}`);
        return;
      }
      try {
        const raw = result?.[kind];
        const tracks = Array.isArray(raw)
          ? raw
          : (raw && typeof raw === 'object' ? Object.values(raw) : []);
        const overlay = document.createElement('div');
        overlay.className = 'player-tracks-overlay';
        const titleText = kind === 'audio' ? 'Pistas de audio' : 'Subtítulos';
        const labelFor = (track, index) => {
          if (!track || typeof track !== 'object') return `${titleText} ${index + 1}`;
          return track.label || track.language || `${titleText} ${index + 1}`;
        };
        const noneButton = kind === 'text'
          ? `<button class="player-track-option" data-disabled="true" data-focusable>Desactivados</button>`
          : '';
        const listHtml = tracks.length
          ? tracks.map((track, index) => {
              const selected = !!(track && track.selected);
              return `<button class="player-track-option ${selected ? 'is-selected' : ''}" data-index="${index}" data-focusable>${escapeHtml(labelFor(track, index))}${selected ? ' ✓' : ''}</button>`;
            }).join('')
          : '<div class="player-track-empty">No hay pistas disponibles.</div>';
        overlay.innerHTML = `<div class="player-tracks-menu" role="dialog" aria-label="${titleText}"><div class="player-tracks-title"><span>${titleText}</span><button class="player-tracks-close" data-focusable aria-label="Cerrar">✕</button></div><div class="player-tracks-list">${noneButton}${listHtml}</div></div>`;
        playerEl.appendChild(overlay);

        const closeMenu = () => {
          try { overlay.remove(); } catch (_) {}
          try {
            (kind === 'audio' ? mount.querySelector('#pl-btn-audio') : mount.querySelector('#pl-btn-subs'))?.focus?.();
          } catch (_) {}
        };
        overlay.querySelector('.player-tracks-close')?.addEventListener('click', closeMenu);
        overlay.querySelectorAll('.player-track-option').forEach((button) => {
          button.addEventListener('click', async () => {
            try {
              if (button.dataset.disabled === 'true') {
                await ExoPlayerPlugin.selectTrack({ type: 'text', enabled: false });
              } else {
                const track = tracks[Number(button.dataset.index)];
                if (track) {
                  await ExoPlayerPlugin.selectTrack({
                    type: kind,
                    group: Number(track.group),
                    track: Number(track.track),
                    enabled: true,
                  });
                }
              }
              showToast(playerEl, `${titleText}: ${button.textContent.trim()}`);
              closeMenu();
            } catch (error) {
              console.warn('[exoplayer] selectTrack error', error);
              showToast(playerEl, `No se pudo cambiar la pista: ${error?.message || 'error'}`);
            }
          });
        });
        overlay.addEventListener('keydown', (e) => {
          if (e.key === 'Escape' || e.key === 'Back' || e.keyCode === 4) {
            e.preventDefault();
            e.stopPropagation();
            closeMenu();
            return;
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            const options = [...overlay.querySelectorAll('[data-focusable]')].filter(el => !el.disabled);
            const current = options.indexOf(document.activeElement);
            const delta = e.key === 'ArrowUp' ? -1 : 1;
            const next = Math.max(0, Math.min(options.length - 1, (current < 0 ? 0 : current) + delta));
            options[next]?.focus?.();
          }
        });
        setTimeout(() => {
          try { overlay.querySelector('.player-track-option, .player-tracks-close')?.focus?.(); } catch (_) {}
        }, 50);
      } catch (error) {
        console.warn('[exoplayer] menú de pistas error', error);
        showToast(playerEl, `Error al mostrar pistas: ${error?.message || 'error'}`);
      }
    };

    mount.querySelector('#pl-btn-audio').onclick = () => openNativeTrackMenu('audio');
    mount.querySelector('#pl-btn-subs').onclick = () => openNativeTrackMenu('text');

    // Manejo táctil / ratón de la barra con Scrubbing interactivo suave
    const getPosFromEvent = (e) => {
      const rect = scrubber.getBoundingClientRect();
      if (!rect.width || currentDuration <= 0) return 0;
      const clientX = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      return ratio * currentDuration;
    };

    scrubber.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { scrubber.setPointerCapture(e.pointerId); } catch (_) {}
      const target = getPosFromEvent(e);
      startScrubbing(target);
    });

    scrubber.addEventListener('pointermove', (e) => {
      if (!isScrubbing) return;
      e.preventDefault();
      const target = getPosFromEvent(e);
      updateScrubPosition(target);
    });

    const finishPointerScrub = (e) => {
      if (!isScrubbing) return;
      e.preventDefault();
      try { scrubber.releasePointerCapture(e.pointerId); } catch (_) {}
      const finalTarget = getPosFromEvent(e);
      stopScrubbing(finalTarget);
    };

    scrubber.addEventListener('pointerup', finishPointerScrub);
    scrubber.addEventListener('pointercancel', finishPointerScrub);

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

      const isPlayPauseKey = e.key === 'MediaPlayPause' || e.key === 'MediaPlay' || e.key === 'MediaPause' ||
        e.key === 'Play' || e.key === 'Pause' || e.key === 'ToggleMediaPlayPause' ||
        e.keyCode === 179 || e.keyCode === 85 || e.keyCode === 126 || e.keyCode === 127 || e.keyCode === 250 || e.keyCode === 19;
      if (isPlayPauseKey) {
        e.preventDefault();
        if (isScrubbing) {
          stopScrubbing();
          return;
        }
        ExoPlayerPlugin.togglePlay();
        showToast(playerEl, isPlaying ? '⏸ Pausa' : '▶ Reproduciendo');
        return;
      }

      const isForwardKey = e.key === 'MediaFastForward' || e.key === 'FastForward' ||
        e.key === 'MediaTrackNext' || e.key === 'MediaSkipForward' || e.key === 'MediaStepForward' ||
        e.keyCode === 228 || e.keyCode === 90 || e.keyCode === 178 || e.keyCode === 87 || e.keyCode === 176 || e.keyCode === 272 || e.keyCode === 274;
      if (isForwardKey) {
        e.preventDefault();
        fastSeekBy(skipSeconds);
        return;
      }

      const isRewindKey = e.key === 'MediaRewind' || e.key === 'Rewind' ||
        e.key === 'MediaTrackPrevious' || e.key === 'MediaSkipBackward' || e.key === 'MediaStepBackward' ||
        e.keyCode === 227 || e.keyCode === 89 || e.keyCode === 177 || e.keyCode === 88 || e.keyCode === 273 || e.keyCode === 275;
      if (isRewindKey) {
        e.preventDefault();
        fastSeekBy(-skipSeconds);
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
