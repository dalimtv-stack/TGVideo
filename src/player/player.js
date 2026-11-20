// src/player/player.js
// Reproductor principal TGVideo (ArtPlayer y Nativo con OSD Stremio y D-Pad para TV)
import Artplayer from 'artplayer';
import { saveProgress, loadProgress } from './progress.js';
import { streamingAvailable, openStream } from './stream.js';
import { extractTitleAndYear } from '../metadata/tmdb.js';
import { prettyEpisodeName } from '../library/parse.js';
import { registerPlayerController, unregisterPlayerController } from '../ui/dpad.js';
import { ensureTracksDetected, openAudioSelector, openSubtitlesSelector, formatTrackName, applyCenteredCueFix } from './tracks.js';
import { escapeHtml, formatTime, showToast, setupDoubleTapSkip, bindNextUp } from './ui-helpers.js';
import { langName } from './trackParser.js';
import { getDeviceSettings, getDeviceId } from '../ui/settings.js';
import { playExoPlayer } from './exoplayer.js';
import { badgeText, badgeTitle, nextPlayerId, playerLabel, setDevicePlayer } from './playerPrefs.js';
import { isAndroidApp as isAndroidPlatform } from '../core/platform.js';
import { ensureConnected } from '../core/telegram.js';
import { bindWakeLock } from './wakeLock.js';
import { bindLoadingGate } from './loadingGate.js';

export function formatPlayerTitle(title, file) {
  if (!title) return file?.label || 'Reproduciendo';

  try {
    const rawName = title.metadata?.name || title.metadata?.title || title.nombre || '';
    const parsed = extractTitleAndYear(rawName);
    const cleanTitle = parsed.title || rawName;
    const year = title.metadata?.date?.slice(0, 4) || parsed.year || '';
    const yearSuffix = year ? ` (${year})` : '';

    if (title.tipo === 'serie') {
      const epNum = (file?.season || file?.episode)
        ? `T${file.season || 1}·E${String(file.episode || 1).padStart(2, '0')}`
        : '';
      const epName = file?.metadata?.name || prettyEpisodeName(file?.fileName || file?.label, cleanTitle);
      return `${cleanTitle} · ${epNum ? epNum + ' - ' : ''}${epName}`;
    }

    if (title.isSaga) {
      return file?.metadata?.name || file?.sagaName || file?.label || cleanTitle;
    }

    return `${cleanTitle}${yearSuffix}`;
  } catch (err) {
    console.warn('[player] Error al formatear título:', err);
    return title.metadata?.name || title.nombre || file?.label || 'Reproduciendo';
  }
}

export async function playFile({
  client,
  peerOf,
  file,
  title,
  profile,
  resumeAt = 0,
  onClose,
  mount,
  sync,
  nextFile = null,
  onNext = null,
}) {
  const devSettings = getDeviceSettings(profile);
  const isAndroidApp = typeof window !== 'undefined' &&
    (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform === 'android');
  let playerType = devSettings.player || 'artplayer';
  if (!isAndroidApp && playerType === 'exoplayer') {
    playerType = 'artplayer';
  }
  const skipSeconds = Number(devSettings.skipSeconds || 10);

  const opts = { client, peerOf, file, title, profile, resumeAt, skipSeconds, onClose, mount, sync, nextFile, onNext };
  if (playerType === 'exoplayer') {
    return playExoPlayer({
      ...opts,
      fallbackToArt: () => playArtplayer(opts),
      switchPlayer: (resume) => playFile({ ...opts, resumeAt: resume ?? opts.resumeAt })
    });
  }
  if (playerType === 'native') {
    return playNative(opts);
  }
  return playArtplayer(opts);
}

// -------------------------------------------------------------
// Reproductor Nativo HTML5 (<video>)
// -------------------------------------------------------------
export async function playNative({
  client,
  peerOf,
  file,
  title,
  profile,
  resumeAt,
  skipSeconds,
  onClose,
  mount,
  sync,
  nextFile = null,
  onNext = null,
}) {
  const displayTitle = formatPlayerTitle(title, file);
  const isWeb = !(typeof window !== 'undefined' && (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform === 'android'));
  const isAndroidApp = typeof window !== 'undefined' &&
    (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform === 'android');

  mount.innerHTML = `
    <div class="player player-native">
      <div class="player-tv-osd" id="pl-osd">
        <div class="player-osd-top">
          <button class="player-osd-back-btn" id="pl-btn-back" data-focusable title="Volver">←</button>
          <div class="player-osd-title">${escapeHtml(displayTitle)}</div>
          <div class="player-osd-engine-box">
            <button class="player-osd-badge" id="pl-badge-toggle" title="${badgeTitle('native')}" data-focusable>${badgeText('native')}</button>
          </div>
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
            <button class="player-ctrl-btn" id="pl-btn-rw" data-focusable title="Atrasar 10s">
              <svg viewBox="0 0 24 24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
            </button>
            <button class="player-ctrl-btn player-ctrl-btn-primary" id="pl-btn-playpause" data-focusable title="Reproducir/Pausar">
              <svg id="pl-icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <svg id="pl-icon-pause" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-ff" data-focusable title="Adelantar 10s">
              <svg viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-audio" data-focusable title="Pistas de Audio">
              <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-subs" data-focusable title="Subtítulos">
              <svg viewBox="0 0 24 24"><path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>
            </button>
            ${isWeb ? `<button class="player-ctrl-btn" id="pl-btn-fullscreen" data-focusable title="Pantalla completa"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></button>` : ''}
          </div>
        </div>
      </div>

      <div class="player-osd-toast" id="pl-osd-toast"></div>
      <div class="player-codec-notice" id="pl-codec-notice" style="display:none;">
        <span>Safari no puede mostrar este formato. En iPhone requiere MP4 con H.264 y AAC.</span>
      </div>
      <div class="player-loading" id="pl-loading">
        <div class="loader"></div>
        <p id="pl-status">Abriendo túnel de streaming…</p>
      </div>
      <video class="native-video" playsinline webkit-playsinline crossorigin="anonymous" autoplay preload="auto"></video>
    </div>`;

  const playerEl = mount.querySelector('.player');
  const isAndroidNative = typeof window !== 'undefined' && (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform === 'android');
  if (isAndroidNative) playerEl?.classList.add('native-android-app');
  const video = mount.querySelector('video');
  applyCenteredCueFix(video);
  const loading = mount.querySelector('#pl-loading');
  const status = mount.querySelector('#pl-status');
  const osd = mount.querySelector('#pl-osd');
  const codecNotice = mount.querySelector('#pl-codec-notice');
  const timeCur = mount.querySelector('#pl-time-cur');
  const timeDur = mount.querySelector('#pl-time-dur');
  const scrubber = mount.querySelector('#pl-scrubber');
  const scrubberFill = mount.querySelector('#pl-scrubber-fill');
  const iconPlay = mount.querySelector('#pl-icon-play');
  const iconPause = mount.querySelector('#pl-icon-pause');

  let cancelled = false;
  let stream = null;
  let url = null;
  let osdTimer = null;

  const nextUp = bindNextUp({
    getTime: () => video?.currentTime || 0,
    getDuration: () => video?.duration || 0,
    playerEl,
    nextFile,
    title,
    onNext: (nf) => {
      close({ isNext: true });
      onNext?.(nf);
    },
  });

  const updatePlayIcons = () => {
    if (video.paused) {
      if (iconPlay) iconPlay.style.display = 'block';
      if (iconPause) iconPause.style.display = 'none';
    } else {
      if (iconPlay) iconPlay.style.display = 'none';
      if (iconPause) iconPause.style.display = 'block';
    }
  };

  // Temporizador OSD: 1.5s sin pulsaciones de mando según especificación del usuario
  const OSD_TIMEOUT_MS = 1500;

  const showOsd = () => {
    osd.classList.remove('is-hidden');
    clearTimeout(osdTimer);
    if (!video.paused) {
      osdTimer = setTimeout(() => {
        osd.classList.add('is-hidden');
        if (osd.contains(document.activeElement)) document.activeElement.blur();
      }, OSD_TIMEOUT_MS);
    }
  };

  const hideOsd = () => {
    clearTimeout(osdTimer);
    osd.classList.add('is-hidden');
    if (osd.contains(document.activeElement)) document.activeElement.blur();
  };

  playerEl.addEventListener('mousemove', showOsd);
  playerEl.addEventListener('keydown', showOsd, true);
  playerEl.addEventListener('touchend', (e) => {
    if (e.target.closest('.player-osd-bottom, .player-osd-top, .player-tracks-overlay, .player-next-up, button')) return;
    e.preventDefault();
    showOsd();
  }, { passive: false });
  playerEl.addEventListener('click', (e) => {
    if (e.target.closest('.player-osd-bottom, .player-osd-top, .player-tracks-overlay, .player-next-up, button')) return;
    if (osd.classList.contains('is-hidden')) showOsd();
    else hideOsd();
  });

  const goFullscreen = () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const req = playerEl.requestFullscreen || playerEl.webkitRequestFullscreen;
    if (req) {
      Promise.resolve(req.call(playerEl, { navigationUI: 'hide' }))
        .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
        .catch(() => {});
    }
  };

  const exitFullscreen = () => {
    try { screen.orientation?.unlock?.(); } catch (_) {}
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
  };

  goFullscreen();

  const cleanupSkip = setupDoubleTapSkip({ container: playerEl, video, skipSeconds });

  const close = ({ isNext = false } = {}) => {
    if (cancelled) return;
    cancelled = true;
    unregisterPlayerController();
    if (cleanupSkip) cleanupSkip();
    clearTimeout(osdTimer);
    exitFullscreen();
    if (video) {
      try {
        if (video.duration) {
          saveProgress(profile.id, file.key, video.currentTime, video.duration);
          if (sync && profile?.id) {
            sync.pushProfile({ profile, progress: loadProgress(profile.id) }).catch(() => {});
          }
        }
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch (_) {}
    }
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    if (!isNext) onClose?.();
  };

  mount.querySelector('#pl-btn-back').onclick = close;

  mount.querySelector('#pl-badge-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const curTime = video?.currentTime || resumeAt || 0;
    if (cancelled) return;
    cancelled = true;
    unregisterPlayerController();
    if (cleanupSkip) cleanupSkip();
    clearTimeout(osdTimer);
    exitFullscreen();
    try { video.pause(); } catch (_) {}
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    const target = setDevicePlayer(profile, nextPlayerId('native'));
    showToast(playerEl, `Cambiando a ${playerLabel(target)}…`);
    playFile({ client, peerOf, file, title, profile, resumeAt: curTime, onClose, mount, sync, nextFile, onNext });
  });

  mount.querySelector('#pl-btn-playpause').onclick = () => {
    if (video.paused) { video.play(); showToast(playerEl, '▶ Reproduciendo'); }
    else { video.pause(); showToast(playerEl, '⏸ Pausa'); }
    updatePlayIcons();
    showOsd();
  };

  mount.querySelector('#pl-btn-rw').onclick = () => {
    video.currentTime = Math.max(0, video.currentTime - skipSeconds);
    showToast(playerEl, `⏪ -${skipSeconds}s`);
    showOsd();
  };

  mount.querySelector('#pl-btn-ff').onclick = () => {
    video.currentTime = Math.min(video.duration || Infinity, video.currentTime + skipSeconds);
    showToast(playerEl, `+${skipSeconds}s ⏩`);
    showOsd();
  };

  mount.querySelector('#pl-btn-audio').onclick = () => {
    openAudioSelector(video, playerEl, mount.querySelector('#pl-btn-audio'));
    showOsd();
  };

  mount.querySelector('#pl-btn-subs').onclick = () => {
    openSubtitlesSelector(video, playerEl, mount.querySelector('#pl-btn-subs'));
    showOsd();
  };

  const __fsBtn = mount.querySelector('#pl-btn-fullscreen');
  if (__fsBtn) __fsBtn.onclick = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else if (playerEl.requestFullscreen) {
      playerEl.requestFullscreen().catch(() => {});
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    }
  };

  scrubber.onclick = (e) => {
    const rect = scrubber.getBoundingClientRect();
    if (rect.width && video.duration) {
      const pos = (e.clientX - rect.left) / rect.width;
      video.currentTime = pos * video.duration;
      showOsd();
    }
  };

  let pendingSeekTime = null;
  let seekDebounceTimer = null;

  const applyPendingSeek = () => {
    if (pendingSeekTime !== null && video) {
      const target = pendingSeekTime;
      pendingSeekTime = null;
      video.currentTime = target;
    }
  };

  const stepScrubber = (delta) => {
    const dur = video.duration || 0;
    if (!dur) return;
    const current = pendingSeekTime !== null ? pendingSeekTime : video.currentTime;
    const target = Math.max(0, Math.min(dur, current + delta));
    pendingSeekTime = target;

    timeCur.textContent = formatTime(target);
    scrubberFill.style.width = `${Math.min(100, (target / dur) * 100)}%`;
    showToast(playerEl, `⏱ ${formatTime(target)}`);
    showOsd();

    clearTimeout(seekDebounceTimer);
    seekDebounceTimer = setTimeout(() => {
      applyPendingSeek();
    }, 1000);
  };

  scrubber.addEventListener('focus', () => scrubber.classList.add('dpad-focused'));
  scrubber.addEventListener('blur', () => {
    scrubber.classList.remove('dpad-focused');
    if (pendingSeekTime !== null) {
      clearTimeout(seekDebounceTimer);
      applyPendingSeek();
    }
  });

  const handleTracksOverlayDpad = (action) => {
    const overlay = playerEl.querySelector('.player-tracks-overlay');
    if (!overlay) return false;

    if (action === 'close') {
      overlay.remove();
      mount.querySelector('#pl-btn-audio')?.focus();
      return true;
    }

    const focusables = [...overlay.querySelectorAll('[data-focusable]')];
    if (focusables.length === 0) return true;

    const curIdx = focusables.indexOf(document.activeElement);

    if (action === 'up') {
      const nextIdx = curIdx > 0 ? curIdx - 1 : focusables.length - 1;
      focusables[nextIdx].focus();
      return true;
    }
    if (action === 'down') {
      const nextIdx = (curIdx !== -1 && curIdx < focusables.length - 1) ? curIdx + 1 : 0;
      focusables[nextIdx].focus();
      return true;
    }
    if (action === 'select') {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        document.activeElement.click();
      }
      return true;
    }
    return true;
  };

  const tvController = {
    close: () => {
      if (handleTracksOverlayDpad('close')) return;
      close();
    },
    onLeft: () => {
      if (handleTracksOverlayDpad('left')) return;
      if (osd.classList.contains('is-hidden')) {
        video.currentTime = Math.max(0, video.currentTime - skipSeconds);
        showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(video.currentTime)})`);
        return;
      }
      if (document.activeElement?.id === 'pl-badge-toggle') {
        mount.querySelector('#pl-btn-back')?.focus();
        showOsd();
        return;
      }
      if (document.activeElement?.id === 'pl-btn-back') { showOsd(); return; }
      const isBtn = document.activeElement?.classList.contains('player-ctrl-btn');
      if (isBtn) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')];
        const idx = btns.indexOf(document.activeElement);
        if (idx > 0) btns[idx - 1].focus();
        showOsd();
        return;
      }
      if (document.activeElement === scrubber) { stepScrubber(-skipSeconds); return; }
      video.currentTime = Math.max(0, video.currentTime - skipSeconds);
      showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(video.currentTime)})`);
      showOsd();
    },
    onRight: () => {
      if (handleTracksOverlayDpad('right')) return;
      if (osd.classList.contains('is-hidden')) {
        video.currentTime = Math.min(video.duration || Infinity, video.currentTime + skipSeconds);
        showToast(playerEl, `⏩ +${skipSeconds}s (${formatTime(video.currentTime)})`);
        return;
      }
      if (document.activeElement?.id === 'pl-btn-back') {
        mount.querySelector('#pl-badge-toggle')?.focus();
        showOsd();
        return;
      }
      if (document.activeElement?.id === 'pl-badge-toggle') { showOsd(); return; }
      const isBtn = document.activeElement?.classList.contains('player-ctrl-btn');
      if (isBtn) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')];
        const idx = btns.indexOf(document.activeElement);
        if (idx !== -1 && idx < btns.length - 1) btns[idx + 1].focus();
        showOsd();
        return;
      }
      if (document.activeElement === scrubber) { stepScrubber(skipSeconds); return; }
      video.currentTime = Math.min(video.duration || Infinity, video.currentTime + skipSeconds);
      showToast(playerEl, `⏩ +${skipSeconds}s (${formatTime(video.currentTime)})`);
      showOsd();
    },
    onUp: () => {
      if (handleTracksOverlayDpad('up')) return;
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-back')?.focus();
        return;
      }
      const cur = document.activeElement;
      if (cur?.classList.contains('player-ctrl-btn')) scrubber.focus();
      else if (cur === scrubber) mount.querySelector('#pl-btn-back')?.focus();
      else mount.querySelector('#pl-btn-back')?.focus();
      showOsd();
    },
    onDown: () => {
      if (handleTracksOverlayDpad('down')) return;
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        scrubber.focus();
        return;
      }
      const cur = document.activeElement;
      if (cur?.id === 'pl-btn-back' || cur?.id === 'pl-badge-toggle') scrubber.focus();
      else if (cur === scrubber) mount.querySelector('#pl-btn-playpause')?.focus();
      else if (cur?.classList.contains('player-ctrl-btn')) showOsd();
      else scrubber.focus();
    },
    onSelect: () => {
      if (handleTracksOverlayDpad('select')) return;
      if (osd.classList.contains('is-hidden')) {
        if (video.paused) { video.play(); showToast(playerEl, '▶ Reproduciendo'); }
        else { video.pause(); showToast(playerEl, '⏸ Pausa'); }
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
        return;
      }
      if (document.activeElement === scrubber) {
        if (pendingSeekTime !== null) {
          clearTimeout(seekDebounceTimer);
          applyPendingSeek();
        }
        if (video.paused) video.play(); else video.pause();
        showOsd();
        return;
      }
      if (osd.contains(document.activeElement)) {
        document.activeElement.click();
        showOsd();
      } else {
        if (video.paused) { video.play(); showToast(playerEl, '▶ Reproduciendo'); }
        else { video.pause(); showToast(playerEl, '⏸ Pausa'); }
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
      }
    },
  };

  registerPlayerController(tvController);

  try {
    if (loading) loading.style.display = 'flex';
    if (status) status.textContent = 'Conectando con Telegram…';
    const targetChannel = file?.channel || title?.channel;
    if (!targetChannel?.id || !targetChannel?.hash) throw new Error('Canal no encontrado para este archivo.');
    if (status) status.textContent = 'Localizando archivo…';
    await ensureConnected(client, { forceResetSenders: true });
    const peer = await peerOf(targetChannel);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (cancelled) return;
    if (!msg?.media?.document) throw new Error('Vídeo no encontrado en el canal.');
    if (status) status.textContent = 'Abriendo túnel de streaming…';

    const doc = msg.media.document;
    const size = Number(doc?.size?.toString?.() || doc?.size || file.size || 0);
    const mime = doc?.mimeType || file.mimeType || file.mime || 'video/mp4';

    if (size > 0 && await streamingAvailable()) {
      status.textContent = 'Abriendo túnel de streaming…';
      stream = openStream({ client, media: msg.media, size, mime, name: file.label || 'video' });
      if (cancelled) { stream.close(); return; }
      url = stream.url;
    } else {
      status.textContent = 'Descargando desde Telegram…';
      const buffer = await client.downloadMedia(msg.media, {
        progressCallback: (done, total) => {
          if (cancelled) return;
          const fullSize = Number(total) || size || 1;
          status.textContent = `Descargando: ${Math.round((Number(done) / fullSize) * 100)}%`;
        },
      });
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([buffer], { type: mime }));
    }

    if (cancelled) return;

    let lastSaved = 0;
    let audioOnlyChecked = false;

    const checkTracks = async () => {
      const tracksData = await ensureTracksDetected(video, { deep: true });
      const audios = tracksData.audio;
      const subs = tracksData.text;

      const btnAudio = mount.querySelector('#pl-btn-audio');
      const btnSubs = mount.querySelector('#pl-btn-subs');
      if (btnAudio) btnAudio.title = audios.length > 1 ? `Pistas de Audio (${audios.length})` : 'Pistas de Audio';
      if (btnSubs) btnSubs.title = subs.length > 0 ? `Subtítulos (${subs.length})` : 'Subtítulos';
    };

    bindLoadingGate(video, loading, status);
    bindWakeLock(video);
    video.src = url;

    video.onloadedmetadata = () => {
      if (resumeAt > 0) video.currentTime = resumeAt;
      timeDur.textContent = formatTime(video.duration);
      checkTracks();
    };

    video.oncanplay = () => {
      checkTracks();
    };

    video.onplay = () => {
      updatePlayIcons();
      showOsd();
    };

    video.onpause = () => {
      updatePlayIcons();
      clearTimeout(osdTimer);
      osd.classList.remove('is-hidden');
      if (sync && profile?.id && video.duration) {
        const progress = saveProgress(profile.id, file.key, video.currentTime, video.duration);
        sync.schedulePush({ profile, progress });
      }
    };

    video.ontimeupdate = () => {
      if (pendingSeekTime !== null) return;
      try { nextUp?.check(); } catch (_) {}
      timeCur.textContent = formatTime(video.currentTime);
      if (video.duration) {
        scrubberFill.style.width = `${Math.min(100, (video.currentTime / video.duration) * 100)}%`;
      }

      const now = Date.now();
      if (now - lastSaved > 8000 && video.duration) {
        lastSaved = now;
        const progress = saveProgress(profile.id, file.key, video.currentTime, video.duration);
        if (sync && profile?.id) sync.schedulePush({ profile, progress });
      }

      if (!audioOnlyChecked && video.currentTime > 2.2 && !video.paused) {
        audioOnlyChecked = true;
        if (video.videoWidth === 0 && codecNotice) {
          codecNotice.style.display = 'flex';
          showOsd();
        }
      }
    };

    video.onended = () => {
      if (video.duration) {
        saveProgress(profile.id, file.key, video.duration, video.duration);
        if (sync && profile?.id) {
          sync.pushProfile({ profile, progress: loadProgress(profile.id) }).catch(() => {});
        }
      }
      if (!nextFile || typeof onNext !== 'function') {
        close();
      } else {
        close({ isNext: true });
        onNext(nextFile);
      }
    };

    video.onerror = () => {
      loading.style.display = 'flex';
      status.textContent = 'Error al reproducir el archivo. Prueba cambiando a ArtPlayer.';
      if (codecNotice) codecNotice.style.display = 'flex';
    };

    video.play().catch(() => {});

  } catch (error) {
    if (cancelled) return;
    status.textContent = error.message || 'Error al conectar con Telegram';
  }
}

// -------------------------------------------------------------
// Reproductor ArtPlayer (Motor predeterminado en Web y Android)
// -------------------------------------------------------------
export async function playArtplayer({
  client,
  peerOf,
  file,
  title,
  profile,
  resumeAt = 0,
  skipSeconds,
  onClose,
  mount,
  sync,
  nextFile = null,
  onNext = null,
}) {
  const displayTitle = formatPlayerTitle(title, file);
  const isWeb = !(typeof window !== 'undefined' && (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform === 'android'));
  const isAndroidApp = typeof window !== 'undefined' &&
    (window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform === 'android');

  mount.innerHTML = `
    <div class="player player-art">
      <div class="player-tv-osd" id="pl-osd">
        <div class="player-osd-top">
          <button class="player-osd-back-btn" id="pl-btn-back" data-focusable title="Volver">←</button>
          <div class="player-osd-title">${escapeHtml(displayTitle)}</div>
          <div class="player-osd-engine-box">
            <button class="player-osd-badge" id="pl-badge-toggle" title="${badgeTitle('artplayer')}" data-focusable>${badgeText('artplayer')}</button>
          </div>
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
            <button class="player-ctrl-btn" id="pl-btn-rw" data-focusable title="Atrasar 10s">
              <svg viewBox="0 0 24 24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
            </button>
            <button class="player-ctrl-btn player-ctrl-btn-primary" id="pl-btn-playpause" data-focusable title="Reproducir/Pausar">
              <svg id="pl-icon-play" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              <svg id="pl-icon-pause" viewBox="0 0 24 24" style="display:none;"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-ff" data-focusable title="Adelantar 10s">
              <svg viewBox="0 0 24 24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-audio" data-focusable title="Pistas de Audio">
              <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>
            </button>
            <button class="player-ctrl-btn" id="pl-btn-subs" data-focusable title="Subtítulos">
              <svg viewBox="0 0 24 24"><path d="M19 4H5a2 2 0 00-2 2v12a2 2 0 002 2h14a2 2 0 002-2V6a2 2 0 00-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z"/></svg>
            </button>
            ${isWeb ? `<button class="player-ctrl-btn" id="pl-btn-fullscreen" data-focusable title="Pantalla completa"><svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></button>` : ''}
          </div>
        </div>
      </div>

      <div class="player-osd-toast" id="pl-osd-toast"></div>
      <div class="player-codec-notice" id="pl-codec-notice" style="display:none;">
        <span>Safari no puede mostrar este formato. En iPhone requiere MP4 con H.264 y AAC.</span>
      </div>
      <div class="player-loading" id="pl-loading">
        <div class="loader"></div>
        <p id="pl-status">Abriendo túnel de streaming…</p>
      </div>
      <div class="artplayer-host" id="artplayer-container"></div>
    </div>`;

  const playerEl = mount.querySelector('.player');
  const container = mount.querySelector('#artplayer-container');
  const loading = mount.querySelector('#pl-loading');
  const status = mount.querySelector('#pl-status');
  const osd = mount.querySelector('#pl-osd');
  const codecNotice = mount.querySelector('#pl-codec-notice');
  const timeCur = mount.querySelector('#pl-time-cur');
  const timeDur = mount.querySelector('#pl-time-dur');
  const scrubber = mount.querySelector('#pl-scrubber');
  const scrubberFill = mount.querySelector('#pl-scrubber-fill');
  const iconPlay = mount.querySelector('#pl-icon-play');
  const iconPause = mount.querySelector('#pl-icon-pause');

  let cancelled = false;
  let stream = null;
  let url = null;
  let art = null;
  let cleanupSkip = null;
  let osdTimer = null;

  const updatePlayIcons = () => {
    if (art?.template?.$video?.paused) {
      if (iconPlay) iconPlay.style.display = 'block';
      if (iconPause) iconPause.style.display = 'none';
    } else {
      if (iconPlay) iconPlay.style.display = 'none';
      if (iconPause) iconPause.style.display = 'block';
    }
  };

  // Temporizador OSD: 1.5s sin pulsaciones de mando según especificación del usuario
  const OSD_TIMEOUT_MS = 1500;

  const showOsd = () => {
    osd.classList.remove('is-hidden');
    clearTimeout(osdTimer);
    if (art && !art.template.$video.paused) {
      osdTimer = setTimeout(() => {
        osd.classList.add('is-hidden');
        if (osd.contains(document.activeElement)) document.activeElement.blur();
      }, OSD_TIMEOUT_MS);
    }
  };

  const hideOsd = () => {
    clearTimeout(osdTimer);
    osd.classList.add('is-hidden');
    if (osd.contains(document.activeElement)) document.activeElement.blur();
  };

  playerEl.addEventListener('mousemove', showOsd);
  playerEl.addEventListener('keydown', showOsd, true);
  playerEl.addEventListener('touchend', (e) => {
    if (e.target.closest('.player-osd-bottom, .player-osd-top, .player-tracks-overlay, .player-next-up, button')) return;
    e.preventDefault();
    showOsd();
  }, { passive: false });
  playerEl.addEventListener('click', (e) => {
    if (e.target.closest('.player-osd-bottom, .player-osd-top, .player-tracks-overlay, .player-next-up, button')) return;
    if (osd.classList.contains('is-hidden')) showOsd();
    else hideOsd();
  });

  const goFullscreen = () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    const req = playerEl.requestFullscreen || playerEl.webkitRequestFullscreen;
    if (req) {
      Promise.resolve(req.call(playerEl, { navigationUI: 'hide' }))
        .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
        .catch(() => {});
    }
  };

  const exitFullscreen = () => {
    try { screen.orientation?.unlock?.(); } catch (_) {}
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (document.webkitFullscreenElement) document.webkitExitFullscreen?.();
  };

  goFullscreen();

  const close = ({ isNext = false } = {}) => {
    if (cancelled) return;
    cancelled = true;
    unregisterPlayerController();
    if (cleanupSkip) cleanupSkip();
    clearTimeout(osdTimer);
    exitFullscreen();
    if (art) {
      try {
        if (art.duration) {
          saveProgress(profile.id, file.key, art.currentTime, art.duration);
          if (sync && profile?.id) {
            sync.pushProfile({ profile, progress: loadProgress(profile.id) }).catch(() => {});
          }
        }
        if (art.template?.$video) {
          try {
            art.template.$video.pause();
            art.template.$video.removeAttribute('src');
            art.template.$video.load();
          } catch (_) {}
        }
        art.destroy(true);
      } catch (_) {}
    }
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    if (!isNext) onClose?.();
  };

  mount.querySelector('#pl-btn-back').onclick = close;

  mount.querySelector('#pl-badge-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const curTime = art?.currentTime || resumeAt || 0;
    if (cancelled) return;
    cancelled = true;
    unregisterPlayerController();
    if (cleanupSkip) cleanupSkip();
    clearTimeout(osdTimer);
    exitFullscreen();
    if (art) {
      try {
        if (art.duration) saveProgress(profile.id, file.key, art.currentTime, art.duration);
        if (art.template?.$video) {
          try {
            art.template.$video.pause();
            art.template.$video.removeAttribute('src');
            art.template.$video.load();
          } catch (_) {}
        }
        art.destroy(true);
      } catch (_) {}
    }
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);
    const target = setDevicePlayer(profile, nextPlayerId('artplayer'));
    showToast(playerEl, `Cambiando a ${playerLabel(target)}…`);
    playFile({ client, peerOf, file, title, profile, resumeAt: curTime, onClose, mount, sync, nextFile, onNext });
  });

  mount.querySelector('#pl-btn-playpause').onclick = () => {
    if (art) {
      if (art.template.$video.paused) { art.play(); showToast(playerEl, '▶ Reproduciendo'); }
      else { art.pause(); showToast(playerEl, '⏸ Pausa'); }
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-rw').onclick = () => {
    if (art) {
      art.currentTime = Math.max(0, art.currentTime - skipSeconds);
      showToast(playerEl, `⏪ -${skipSeconds}s`);
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-ff').onclick = () => {
    if (art) {
      art.currentTime = Math.min(art.duration || Infinity, art.currentTime + skipSeconds);
      showToast(playerEl, `+${skipSeconds}s ⏩`);
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-audio').onclick = () => {
    const vid = art?.template?.$video;
    if (vid) {
      openAudioSelector(vid, playerEl, mount.querySelector('#pl-btn-audio'));
      showOsd();
    }
  };

  mount.querySelector('#pl-btn-subs').onclick = () => {
    const vid = art?.template?.$video;
    if (vid) {
      openSubtitlesSelector(vid, playerEl, mount.querySelector('#pl-btn-subs'));
      showOsd();
    }
  };

  const __fsBtn = mount.querySelector('#pl-btn-fullscreen');
  if (__fsBtn) __fsBtn.onclick = () => {
    if (art?.fullscreen) {
      art.fullscreen.toggle();
    } else if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      playerEl.requestFullscreen?.().catch(() => {});
    }
  };

  scrubber.onclick = (e) => {
    const rect = scrubber.getBoundingClientRect();
    if (rect.width && art?.duration) {
      const pos = (e.clientX - rect.left) / rect.width;
      art.currentTime = pos * art.duration;
      showOsd();
    }
  };

  let pendingSeekTime = null;
  let seekDebounceTimer = null;

  const applyPendingSeek = () => {
    if (pendingSeekTime !== null && art) {
      const target = pendingSeekTime;
      pendingSeekTime = null;
      art.currentTime = target;
    }
  };

  const stepScrubber = (delta) => {
    const dur = art?.duration || 0;
    if (!dur) return;
    const current = pendingSeekTime !== null ? pendingSeekTime : (art?.currentTime || 0);
    const target = Math.max(0, Math.min(dur, current + delta));
    pendingSeekTime = target;

    timeCur.textContent = formatTime(target);
    scrubberFill.style.width = `${Math.min(100, (target / dur) * 100)}%`;
    showToast(playerEl, `⏱ ${formatTime(target)}`);
    showOsd();

    clearTimeout(seekDebounceTimer);
    seekDebounceTimer = setTimeout(() => {
      applyPendingSeek();
    }, 1000);
  };

  scrubber.addEventListener('focus', () => scrubber.classList.add('dpad-focused'));
  scrubber.addEventListener('blur', () => {
    scrubber.classList.remove('dpad-focused');
    if (pendingSeekTime !== null) {
      clearTimeout(seekDebounceTimer);
      applyPendingSeek();
    }
  });

  const handleTracksOverlayDpad = (action) => {
    const overlay = playerEl.querySelector('.player-tracks-overlay');
    if (!overlay) return false;

    if (action === 'close') {
      overlay.remove();
      mount.querySelector('#pl-btn-audio')?.focus();
      return true;
    }

    const focusables = [...overlay.querySelectorAll('[data-focusable]')];
    if (focusables.length === 0) return true;

    const curIdx = focusables.indexOf(document.activeElement);

    if (action === 'up') {
      const nextIdx = curIdx > 0 ? curIdx - 1 : focusables.length - 1;
      focusables[nextIdx].focus();
      return true;
    }
    if (action === 'down') {
      const nextIdx = (curIdx !== -1 && curIdx < focusables.length - 1) ? curIdx + 1 : 0;
      focusables[nextIdx].focus();
      return true;
    }
    if (action === 'select') {
      if (document.activeElement && overlay.contains(document.activeElement)) {
        document.activeElement.click();
      }
      return true;
    }
    return true;
  };

  const tvController = {
    close: () => {
      if (handleTracksOverlayDpad('close')) return;
      close();
    },
    onLeft: () => {
      if (handleTracksOverlayDpad('left')) return;
      if (osd.classList.contains('is-hidden')) {
        if (art) {
          art.currentTime = Math.max(0, art.currentTime - skipSeconds);
          showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(art.currentTime)})`);
        }
        return;
      }
      if (document.activeElement?.id === 'pl-badge-toggle') {
        mount.querySelector('#pl-btn-back')?.focus();
        showOsd();
        return;
      }
      if (document.activeElement?.id === 'pl-btn-back') { showOsd(); return; }
      const isBtn = document.activeElement?.classList.contains('player-ctrl-btn');
      if (isBtn) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')];
        const idx = btns.indexOf(document.activeElement);
        if (idx > 0) btns[idx - 1].focus();
        showOsd();
        return;
      }
      if (document.activeElement === scrubber && art) { stepScrubber(-skipSeconds); return; }
      if (art) {
        art.currentTime = Math.max(0, art.currentTime - skipSeconds);
        showToast(playerEl, `⏪ -${skipSeconds}s (${formatTime(art.currentTime)})`);
        showOsd();
      }
    },
    onRight: () => {
      if (handleTracksOverlayDpad('right')) return;
      if (osd.classList.contains('is-hidden')) {
        if (art) {
          art.currentTime = Math.min(art.duration || Infinity, art.currentTime + skipSeconds);
          showToast(playerEl, `⏩ +${skipSeconds}s (${formatTime(art.currentTime)})`);
        }
        return;
      }
      if (document.activeElement?.id === 'pl-btn-back') {
        mount.querySelector('#pl-badge-toggle')?.focus();
        showOsd();
        return;
      }
      if (document.activeElement?.id === 'pl-badge-toggle') { showOsd(); return; }
      const isBtn = document.activeElement?.classList.contains('player-ctrl-btn');
      if (isBtn) {
        const btns = [...mount.querySelectorAll('.player-controls-row .player-ctrl-btn')];
        const idx = btns.indexOf(document.activeElement);
        if (idx !== -1 && idx < btns.length - 1) btns[idx + 1].focus();
        showOsd();
        return;
      }
      if (document.activeElement === scrubber && art) { stepScrubber(skipSeconds); return; }
      if (art) {
        art.currentTime = Math.min(art.duration || Infinity, art.currentTime + skipSeconds);
        showToast(playerEl, `⏩ +${skipSeconds}s (${formatTime(art.currentTime)})`);
        showOsd();
      }
    },
    onUp: () => {
      if (handleTracksOverlayDpad('up')) return;
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        mount.querySelector('#pl-btn-back')?.focus();
        return;
      }
      const cur = document.activeElement;
      if (cur?.classList.contains('player-ctrl-btn')) scrubber.focus();
      else if (cur === scrubber) mount.querySelector('#pl-btn-back')?.focus();
      else mount.querySelector('#pl-btn-back')?.focus();
      showOsd();
    },
    onDown: () => {
      if (handleTracksOverlayDpad('down')) return;
      if (osd.classList.contains('is-hidden')) {
        showOsd();
        scrubber.focus();
        return;
      }
      const cur = document.activeElement;
      if (cur?.id === 'pl-btn-back' || cur?.id === 'pl-badge-toggle') scrubber.focus();
      else if (cur === scrubber) mount.querySelector('#pl-btn-playpause')?.focus();
      else if (cur?.classList.contains('player-ctrl-btn')) showOsd();
      else scrubber.focus();
    },
    onSelect: () => {
      if (handleTracksOverlayDpad('select')) return;
      if (osd.classList.contains('is-hidden')) {
        if (art) {
          if (art.template.$video.paused) { art.play(); showToast(playerEl, '▶ Reproduciendo'); }
          else { art.pause(); showToast(playerEl, '⏸ Pausa'); }
          showOsd();
          mount.querySelector('#pl-btn-playpause')?.focus();
        }
        return;
      }
      if (document.activeElement === scrubber) {
        if (pendingSeekTime !== null) {
          clearTimeout(seekDebounceTimer);
          applyPendingSeek();
        }
        if (art) {
          if (art.template.$video.paused) art.play(); else art.pause();
          showOsd();
        }
        return;
      }
      if (osd.contains(document.activeElement)) {
        document.activeElement.click();
        showOsd();
      } else if (art) {
        if (art.template.$video.paused) { art.play(); showToast(playerEl, '▶ Reproduciendo'); }
        else { art.pause(); showToast(playerEl, '⏸ Pausa'); }
        showOsd();
        mount.querySelector('#pl-btn-playpause')?.focus();
      }
    },
  };

  registerPlayerController(tvController);

  try {
    if (loading) loading.style.display = 'flex';
    if (status) status.textContent = 'Conectando con Telegram…';
    const targetChannel = file?.channel || title?.channel;
    if (!targetChannel?.id || !targetChannel?.hash) throw new Error('Canal no encontrado para este archivo.');
    if (status) status.textContent = 'Localizando archivo…';
    await ensureConnected(client, { forceResetSenders: true });
    const peer = await peerOf(targetChannel);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (cancelled) return;
    if (!msg?.media?.document) throw new Error('Vídeo no encontrado en el canal.');
    if (status) status.textContent = 'Abriendo túnel de streaming…';

    const doc = msg.media.document;
    const size = Number(doc?.size?.toString?.() || doc?.size || file.size || 0);
    const mime = doc?.mimeType || file.mimeType || file.mime || 'video/mp4';

    if (size > 0 && await streamingAvailable()) {
      status.textContent = 'Abriendo túnel de streaming…';
      stream = openStream({ client, media: msg.media, size, mime, name: file.label || 'video' });
      if (cancelled) { stream.close(); return; }
      url = stream.url;
    } else {
      status.textContent = 'Descargando desde Telegram…';
      const buffer = await client.downloadMedia(msg.media, {
        progressCallback: (done, total) => {
          if (cancelled) return;
          const fullSize = Number(total) || size || 1;
          status.textContent = `Descargando: ${Math.round((Number(done) / fullSize) * 100)}%`;
        },
      });
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([buffer], { type: mime }));
    }

    if (cancelled) return;

    art = new Artplayer({
      container,
      url,
      title: displayTitle,
      autoplay: true,
      playsInline: true,
      theme: '#e50914',
      lang: 'es',
      volume: 0.85,
      autoSize: false,
      autoMini: false,
      mutex: true,
      hotkey: false,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: false,
      fullscreenWeb: false,
      pip: true,
      setting: true,
      screenshot: false,
      lock: true,
      fastForward: true,
      autoOrientation: true,
      autoPlayback: false,
      airplay: true,
      gesture: true,
      backdrop: true,
      moreVideoAttr: {
        'playsinline': true,
        'webkit-playsinline': true,
        'x5-video-player-type': 'h5',
      },
    });

    const video = art.template.$video;
    applyCenteredCueFix(video);
    bindLoadingGate(video, loading, status);
    bindWakeLock(video);
    ensureTracksDetected(video, { deep: true }).catch(() => {});

    const nextUp = bindNextUp({
      getTime: () => art?.currentTime || video?.currentTime || 0,
      getDuration: () => art?.duration || video?.duration || 0,
      playerEl,
      nextFile,
      title,
      onNext: (nf) => {
        close({ isNext: true });
        onNext?.(nf);
      },
    });

    let lastSaved = 0;
    let audioOnlyChecked = false;

    cleanupSkip = setupDoubleTapSkip({ container: art.template.$player, video, skipSeconds });

    if (video.webkitSupportsFullscreen) {
      art.controls.add({
        name: 'iosNativeFs',
        position: 'right',
        index: 68,
        html: '<span class="art-ios-btn" title="Pantalla completa nativa de iOS (para pistas de audio y subtítulos)">iOS</span>',
        tooltip: 'Pantalla completa iOS (Audios/Subs)',
        click() {
          try { video.webkitEnterFullscreen(); } catch (err) { console.warn(err); }
        }
      });
    }

    const checkTracks = async () => {
      const tracksData = await ensureTracksDetected(video, { deep: true });
      const audios = tracksData.audio;
      const subs = tracksData.text;

      const btnAudio = mount.querySelector('#pl-btn-audio');
      const btnSubs = mount.querySelector('#pl-btn-subs');
      if (btnAudio) btnAudio.title = audios.length > 1 ? `Pistas de Audio (${audios.length})` : 'Pistas de Audio';
      if (btnSubs) btnSubs.title = subs.length > 0 ? `Subtítulos (${subs.length})` : 'Subtítulos';

      if (audios.length > 1) {
        try {
          if (!art.setting.find('audioTracks')) {
            art.setting.add({
              name: 'audioTracks',
              width: 220,
              html: 'Pista de audio',
              tooltip: 'Audio',
              selector: audios.map((track, i) => {
                const isNative = track.native !== false && typeof track.enabled === 'boolean';
                return {
                  default: isNative ? !!track.enabled : (i === 0),
                  html: isNative ? formatTrackName(track, i, "Audio") : (track.label || langName(track.language) || `Audio ${i + 1}`),
                  value: i,
                };
              }),
              onSelect(item) {
                const idx = Number(item.value);
                const track = audios[idx];
                if (track && track.native === false) {
                  showToast(playerEl, "Esta pista no se puede cambiar en este dispositivo.");
                } else if (audios.length > 0 && audios[idx]) {
                  audios.forEach((t, i) => { t.enabled = (i === idx); });
                  showToast(playerEl, `✓ Audio: ${item.html}`);
                }
                return item.html;
              },
            });
          }
        } catch (_) {}
      }

      if (subs.length > 0) {
        try {
          if (!art.setting.find('nativeSubtitles')) {
            art.setting.add({
              name: 'nativeSubtitles',
              width: 220,
              html: 'Subtítulos',
              tooltip: 'Subtítulos',
              selector: [
                { default: subs.every(t => t.mode !== 'showing'), html: 'Desactivados', value: -1 },
                ...subs.map((track, i) => {
                  const isNative = track.native !== false && typeof track.mode === 'string';
                  return {
                    default: isNative && track.mode === 'showing',
                    html: isNative ? formatTrackName(track, i, "Subtítulo") : (track.label || langName(track.language) || `Subtítulo ${i + 1}`),
                    value: i,
                  };
                }),
              ],
              onSelect(item) {
                const idx = Number(item.value);
                if (idx >= 0 && subs[idx]?.native === false) {
                  showToast(playerEl, "Esta pista no se puede mostrar en este dispositivo.");
                  return item.html;
                }
                subs.forEach((t, i) => {
                  if (typeof t.mode === 'string') t.mode = (i === idx) ? "showing" : "disabled";
                });
                if (idx >= 0) applyCenteredCueFix(video);
                showToast(playerEl, idx === -1 ? "Subtítulos desactivados" : `✓ Subtítulos: ${item.html}`);
                return item.html;
              },
            });
          }
        } catch (_) {}
      }
    };

    art.on('ready', () => {
      if (resumeAt > 0) art.currentTime = resumeAt;
      if (video.duration) timeDur.textContent = formatTime(video.duration);
      checkTracks();
    });

    art.on('video:loadedmetadata', () => {
      timeDur.textContent = formatTime(video.duration);
      checkTracks();
    });

    art.on('video:canplay', () => {
      checkTracks();
    });

    if (video.textTracks) video.textTracks.addEventListener('addtrack', checkTracks);
    if (video.audioTracks) video.audioTracks.addEventListener('addtrack', checkTracks);

    art.on('video:play', () => {
      updatePlayIcons();
      showOsd();
    });

    art.on('video:pause', () => {
      updatePlayIcons();
      clearTimeout(osdTimer);
      osd.classList.remove('is-hidden');
      if (sync && profile?.id && art?.duration) {
        const progress = saveProgress(profile.id, file.key, art.currentTime, art.duration);
        sync.schedulePush({ profile, progress });
      }
    });

    art.on('video:timeupdate', () => {
      if (pendingSeekTime !== null) return;
      try { nextUp?.check(); } catch (_) {}
      timeCur.textContent = formatTime(art.currentTime);
      if (art.duration) {
        scrubberFill.style.width = `${Math.min(100, (art.currentTime / art.duration) * 100)}%`;
      }

      const now = Date.now();
      if (now - lastSaved > 8000 && art.duration) {
        lastSaved = now;
        const progress = saveProgress(profile.id, file.key, art.currentTime, art.duration);
        if (sync && profile?.id) sync.schedulePush({ profile, progress });
      }

      if (!audioOnlyChecked && video.currentTime > 2.2 && !video.paused) {
        audioOnlyChecked = true;
        if (video.videoWidth === 0 && codecNotice) {
          codecNotice.style.display = 'flex';
          showOsd();
        }
      }
    });

    art.on('video:ended', () => {
      if (art.duration) {
        saveProgress(profile.id, file.key, art.duration, art.duration);
        if (sync && profile?.id) {
          sync.pushProfile({ profile, progress: loadProgress(profile.id) }).catch(() => {});
        }
      }
      if (!nextFile || typeof onNext !== 'function') {
        close();
      } else {
        close({ isNext: true });
        onNext(nextFile);
      }
    });

    art.on('video:error', () => {
      loading.style.display = 'flex';
      status.textContent = 'Error al reproducir el archivo. Prueba el otro reproductor o verifica los códecs.';
      if (codecNotice) codecNotice.style.display = 'flex';
    });

  } catch (error) {
    if (cancelled) return;
    status.textContent = error.message || 'Error al conectar con Telegram';
  }
}
