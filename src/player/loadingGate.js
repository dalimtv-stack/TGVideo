// src/player/loadingGate.js
// Controla el cargador (.player-loading) de los reproductores basados en <video>.
// Se mantiene visible, con texto de estado, hasta que se pinta el primer fotograma
// (no basta con loadedmetadata, que llega antes que la imagen).
export function bindLoadingGate(video, loading, status) {
  if (!video || !loading) return () => {};
  let firstFrame = false;
  let waitTimer = null;
  const setText = (t) => { if (status && t) status.textContent = t; };
  const root = loading.closest('.player') || loading.parentElement;

  // Carga inicial: fondo negro y OSD visible para permitir volver atrás
  const show = (t) => {
    setText(t);
    loading.classList.remove('buffering');
    root?.classList.add('is-loading');
    loading.style.display = 'flex';
  };
  const hide = () => {
    clearTimeout(waitTimer);
    loading.style.display = 'none';
    loading.classList.remove('buffering');
    root?.classList.remove('is-loading');
  };

  const onMeta = () => { if (!firstFrame) setText('Preparando reproducción…'); };
  const onPlaying = () => {
    const done = () => { firstFrame = true; hide(); };
    if (firstFrame) return done();
    if (typeof video.requestVideoFrameCallback === 'function') {
      let fired = false;
      video.requestVideoFrameCallback(() => { fired = true; done(); });
      setTimeout(() => { if (!fired) done(); }, 1500);
    } else done();
  };
  const onCanPlay = () => { if (video.paused) hide(); };
  const onError = () => clearTimeout(waitTimer);

  video.addEventListener('loadedmetadata', onMeta);
  video.addEventListener('playing', onPlaying);
  video.addEventListener('canplay', onCanPlay);
  video.addEventListener('error', onError);
  show();
  return () => {
    clearTimeout(waitTimer);
    ['loadedmetadata', 'playing', 'canplay', 'error'].forEach((e) => {
      video.removeEventListener(e, { loadedmetadata: onMeta, playing: onPlaying, canplay: onCanPlay, error: onError }[e]);
    });
  };
}
