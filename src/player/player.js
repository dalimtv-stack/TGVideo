// Reproductor: descarga el vídeo de Telegram por chunks y lo reproduce
import { saveProgress } from './progress.js';

export async function playFile({ client, peerOf, file, title, profile, resumeAt = 0, onClose, mount }) {
  mount.innerHTML = `
    <div class="player">
      <div class="player-top"><button class="btn-ghost" data-focusable id="pl-back">← Volver</button>
        <div class="player-title">${title.nombre} · ${file.label}</div></div>
      <div class="player-loading" id="pl-loading"><div class="loader"></div>
        <p id="pl-pct">Descargando desde Telegram… 0%</p></div>
      <video id="pl-video" controls playsinline style="display:none"></video>
    </div>`;
  let cancelled = false, url = null;
  const video = mount.querySelector('#pl-video');
  const close = () => {
    cancelled = true;
    if (video.duration) saveProgress(profile.id, file.key, video.currentTime, video.duration);
    video.pause(); if (url) URL.revokeObjectURL(url); onClose();
  };
  mount.querySelector('#pl-back').onclick = close;
  mount.querySelector('#pl-back').focus();

  try {
    const [msg] = await client.getMessages(peerOf(title.channel), { ids: [file.messageId] });
    const buf = await client.downloadMedia(msg.media, {
      progressCallback: (got, total) => {
        if (cancelled) throw new Error('cancelado');
        const t = Number(total) || file.size || 1;
        const el = mount.querySelector('#pl-pct');
        if (el) el.textContent = `Descargando desde Telegram… ${Math.round(Number(got) / t * 100)}%`;
      },
    });
    if (cancelled) return;
    const chunks = [buf];
    const mime = file.mimeType === 'video/x-matroska' ? 'video/webm' : file.mimeType;
    url = URL.createObjectURL(new Blob(chunks, { type: mime }));
    mount.querySelector('#pl-loading').style.display = 'none';
    video.style.display = 'block';
    video.src = url;
    video.onloadedmetadata = () => { if (resumeAt > 0 && resumeAt < video.duration - 5) video.currentTime = resumeAt; video.play().catch(() => {}); };
    let last = 0;
    video.ontimeupdate = () => { if (Date.now() - last > 5000) { last = Date.now(); saveProgress(profile.id, file.key, video.currentTime, video.duration); } };
    video.onended = () => saveProgress(profile.id, file.key, video.duration, video.duration, true);
    video.onerror = () => { mount.querySelector('#pl-loading').style.display = 'flex';
      mount.querySelector('#pl-pct').textContent = 'El navegador no puede reproducir este formato (códec no soportado).'; };
    video.focus();
  } catch (e) {
    if (cancelled) return;
    console.error(e);
    mount.querySelector('#pl-pct').textContent = 'Error al cargar el vídeo: ' + (e?.message || e);
  }
}
