// src/player/player.js
// Orquestador principal modular del reproductor TGVideo (Stremio-style)
// Conecta túneles de Telegram, sincronización de progreso, motor desacoplado (ExoPlayer/ArtPlayer) y OSD.
import { saveProgress, loadProgress } from './progress.js';
import { streamingAvailable, openStream } from './stream.js';
import { extractTitleAndYear } from '../metadata/tmdb.js';
import { prettyEpisodeName } from '../library/parse.js';
import { createPlayerEngine, isCapacitorNative } from './engine.js';
import { createPlayerOSD } from './osd.js';

export function formatPlayerTitle(title, file) {
  if (!title) return file?.label || 'Reproduciendo';

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
  let stream = null;
  let url = null;
  let engine = null;
  let osd = null;
  let cancelled = false;
  let lastSaved = 0;

  const titleText = formatPlayerTitle(title, file);
  const isApk = isCapacitorNative();
  const playerModeLabel = isApk ? 'ExoPlayer' : 'ArtPlayer';

  const close = () => {
    if (cancelled) return;
    cancelled = true;

    if (engine) {
      if (engine.duration > 0 && profile?.id) {
        const progress = saveProgress(profile.id, file.key, engine.currentTime, engine.duration);
        if (sync) sync.schedulePush({ profile, progress });
      }
      engine.destroy();
    }

    if (osd) osd.destroy();
    if (stream) stream.close();
    else if (url) URL.revokeObjectURL(url);

    onClose?.();
  };

  const switchPlayer = () => {
    const curTime = engine?.currentTime || resumeAt || 0;
    close();
    playFile({ client, peerOf, file, title, profile, resumeAt: curTime, onClose, mount, sync, nextFile, onNext });
  };

  try {
    // 1. Obtener mensaje y documento de Telegram
    const targetChannel = file?.channel || title?.channel;
    if (!targetChannel?.id || !targetChannel?.hash) {
      throw new Error('Canal no encontrado para este archivo.');
    }
    const peer = await peerOf(targetChannel);
    const [msg] = await client.getMessages(peer, { ids: [file.messageId] });
    if (cancelled) return;
    if (!msg?.media?.document) throw new Error('Vídeo no encontrado en el canal.');

    const doc = msg.media.document;
    const size = Number(doc?.size?.toString?.() || doc?.size || file.size || 0);
    const mime = doc?.mimeType || file.mimeType || file.mime || 'video/mp4';

    // 2. Montar UI OSD inicial
    osd = createPlayerOSD({
      mount,
      titleText,
      engine: { paused: false, currentTime: resumeAt, duration: 0 },
      onClose: close,
      onSwitchPlayer: switchPlayer,
      playerModeLabel,
      nextFile,
      onNext,
    });

    osd.setLoading(true, 'Conectando con Telegram…');

    // 3. Abrir túnel de streaming o descargar
    if (size > 0 && await streamingAvailable()) {
      osd.setLoading(true, 'Abriendo túnel de streaming…');
      stream = openStream({ client, media: msg.media, size, mime, name: file.label || 'video' });
      if (cancelled) { stream.close(); return; }
      url = stream.url;
    } else {
      osd.setLoading(true, 'Descargando desde Telegram…');
      const buffer = await client.downloadMedia(msg.media, {
        progressCallback: (done, total) => {
          if (cancelled) return;
          const fullSize = Number(total) || size || 1;
          osd.setLoading(true, `Descargando: ${Math.round((Number(done) / fullSize) * 100)}%`);
        },
      });
      if (cancelled) return;
      url = URL.createObjectURL(new Blob([buffer], { type: mime }));
    }

    // 4. Inicializar motor (ExoPlayer en APK o ArtPlayer en Web)
    const videoMount = osd.getVideoMount();
    engine = await createPlayerEngine({
      container: videoMount,
      url,
      resumeAt,
      title: titleText,
      onEvent: (event, data) => {
        if (cancelled) return;

        if (event === 'ready' || event === 'loadedmetadata') {
          osd.setLoading(false);
          osd.updateProgressUI(engine.currentTime, engine.duration);
          osd.updatePlayIcons();
          osd.showOsd();
        } else if (event === 'play' || event === 'pause') {
          osd.updatePlayIcons();
        } else if (event === 'timeupdate') {
          osd.updateProgressUI(data?.currentTime || engine.currentTime, data?.duration || engine.duration);

          const now = Date.now();
          if (now - lastSaved > 8000 && engine.duration > 0 && profile?.id) {
            lastSaved = now;
            const progress = saveProgress(profile.id, file.key, engine.currentTime, engine.duration);
            if (sync) sync.schedulePush({ profile, progress });
          }
        } else if (event === 'ended') {
          if (engine.duration > 0 && profile?.id) {
            saveProgress(profile.id, file.key, engine.duration, engine.duration);
            if (sync) sync.pushProfile({ profile, progress: loadProgress(profile.id) }).catch(() => {});
          }
          if (!nextFile || typeof onNext !== 'function') close();
          else onNext();
        } else if (event === 'error') {
          osd.setLoading(true, 'Error al reproducir el vídeo. Verifica el formato o códecs.');
        }
      },
    });

  } catch (error) {
    if (cancelled) return;
    if (osd) osd.setLoading(true, error.message || 'Error al conectar con Telegram');
    else alert(error.message || 'Error al conectar con Telegram');
  }
}
