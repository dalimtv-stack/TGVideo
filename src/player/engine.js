// src/player/engine.js
// Capa de abstracción de motor de reproducción (Stremio-style)
// Soporta ExoPlayer en APK nativo (Capacitor) y ArtPlayer / HTML5 Video en Web / PC.
import Artplayer from 'artplayer';
import { detectTracksFromUrl, langName } from './trackParser.js';

export function isCapacitorNative() {
  return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
}

export function formatTrackName(track, i, fallbackPrefix) {
  const parts = [];
  if (track.label) parts.push(track.label);
  const lang = track.language || track.lang;
  if (lang) parts.push(langName(lang));
  if (track.codec) parts.push(track.codec.toUpperCase());
  if (track.channels) parts.push(`${track.channels}ch`);
  return parts.length ? parts.join(' · ') : `${fallbackPrefix} ${i + 1}`;
}

// Motor Web con ArtPlayer
class ArtPlayerEngine {
  constructor({ container, url, resumeAt = 0, onEvent }) {
    this.container = container;
    this.url = url;
    this.resumeAt = resumeAt;
    this.onEvent = onEvent || (() => {});
    this.art = null;
    this.video = null;
    this.tracks = { audio: [], text: [] };
    this.destroyed = false;
  }

  async init() {
    this.art = new Artplayer({
      container: this.container,
      url: this.url,
      type: 'mp4',
      autoplay: true,
      autoMini: false,
      fullscreen: false,
      fullscreenWeb: false,
      setting: true,
      pip: false,
      playbackRate: true,
      aspectRatio: true,
      hotkey: false,
      lock: false,
      fastForward: false,
      autoOrientation: true,
      airplay: false,
      theme: '#e50914',
      moreVideoAttr: {
        playsinline: 'true',
        'webkit-playsinline': 'true',
        crossorigin: 'anonymous',
      },
    });

    this.video = this.art.template.$video;

    this.art.on('ready', () => {
      if (this.resumeAt > 0) this.art.currentTime = this.resumeAt;
      this.onEvent('ready', { duration: this.art.duration });
      this.detectTracks();
    });

    this.art.on('video:loadedmetadata', () => {
      this.onEvent('loadedmetadata', { duration: this.video.duration });
      this.detectTracks();
    });

    this.art.on('video:play', () => this.onEvent('play'));
    this.art.on('video:pause', () => this.onEvent('pause'));
    this.art.on('video:timeupdate', () => this.onEvent('timeupdate', { currentTime: this.art.currentTime, duration: this.art.duration }));
    this.art.on('video:ended', () => this.onEvent('ended'));
    this.art.on('video:error', (e) => this.onEvent('error', e));

    if (this.video.textTracks) this.video.textTracks.addEventListener('addtrack', () => this.detectTracks());
    if (this.video.audioTracks) this.video.audioTracks.addEventListener('addtrack', () => this.detectTracks());
  }

  async detectTracks() {
    if (this.destroyed) return;
    const nativeAudio = [];
    if (this.video.audioTracks && this.video.audioTracks.length > 0) {
      for (let i = 0; i < this.video.audioTracks.length; i++) {
        const at = this.video.audioTracks[i];
        nativeAudio.push({ id: at.id || String(i), label: at.label, language: at.language, enabled: at.enabled, native: true });
      }
    }
    const nativeText = [];
    if (this.video.textTracks && this.video.textTracks.length > 0) {
      for (let i = 0; i < this.video.textTracks.length; i++) {
        const tt = this.video.textTracks[i];
        if (tt.kind === 'subtitles' || tt.kind === 'captions') {
          nativeText.push({ id: tt.id || String(i), label: tt.label, language: tt.language, mode: tt.mode, native: true });
        }
      }
    }

    let parsed = null;
    try {
      parsed = await detectTracksFromUrl(this.url);
    } catch (_) {}

    const audio = (parsed && parsed.audio?.length > nativeAudio.length)
      ? parsed.audio.map((p, idx) => ({ ...p, native: !!nativeAudio[idx], enabled: idx === 0 }))
      : nativeAudio;

    const text = (parsed && parsed.text?.length > nativeText.length)
      ? parsed.text.map((p, idx) => ({ ...p, native: !!nativeText[idx], mode: 'disabled' }))
      : nativeText;

    this.tracks = { audio, text };
    this.onEvent('tracks', this.tracks);
  }

  get currentTime() { return this.art?.currentTime || this.video?.currentTime || 0; }
  set currentTime(v) { if (this.art) this.art.currentTime = v; else if (this.video) this.video.currentTime = v; }
  get duration() { return this.art?.duration || this.video?.duration || 0; }
  get paused() { return this.video ? this.video.paused : true; }

  play() { if (this.art) this.art.play(); else if (this.video) this.video.play(); }
  pause() { if (this.art) this.art.pause(); else if (this.video) this.video.pause(); }

  setAudioTrack(index) {
    const audios = this.tracks.audio;
    if (!audios || !audios[index]) return { success: false };
    const track = audios[index];
    if (this.video?.audioTracks && track.native !== false) {
      for (let i = 0; i < this.video.audioTracks.length; i++) {
        this.video.audioTracks[i].enabled = (i === index);
      }
      audios.forEach((t, i) => { t.enabled = (i === index); });
      return { success: true, native: true, label: formatTrackName(track, index, 'Audio') };
    }
    return { success: false, native: false, message: 'Esta pista no se puede cambiar en el navegador web sin códec nativo.' };
  }

  setSubtitleTrack(index) {
    const subs = this.tracks.text;
    if (index === -1) {
      if (this.video?.textTracks) {
        for (let i = 0; i < this.video.textTracks.length; i++) this.video.textTracks[i].mode = 'disabled';
      }
      subs.forEach(t => { t.mode = 'disabled'; });
      return { success: true, disabled: true };
    }
    const track = subs[index];
    if (!track) return { success: false };
    if (this.video?.textTracks && track.native !== false) {
      for (let i = 0; i < this.video.textTracks.length; i++) {
        this.video.textTracks[i].mode = (i === index) ? 'showing' : 'disabled';
      }
      subs.forEach((t, i) => { t.mode = (i === index) ? 'showing' : 'disabled'; });
      return { success: true, native: true, label: formatTrackName(track, index, 'Subtítulo') };
    }
    return { success: false, native: false, message: 'Esta pista no se puede mostrar en este navegador.' };
  }

  destroy() {
    this.destroyed = true;
    try {
      if (this.art) this.art.destroy(false);
    } catch (_) {}
  }
}

// Motor Nativo ExoPlayer para APK de Android
class ExoPlayerEngine {
  constructor({ container, url, resumeAt = 0, title = '', onEvent }) {
    this.container = container;
    this.url = url;
    this.resumeAt = resumeAt;
    this.title = title;
    this.onEvent = onEvent || (() => {});
    this._currentTime = resumeAt;
    this._duration = 0;
    this._paused = false;
    this.tracks = { audio: [], text: [] };
    this.listeners = [];
  }

  async init() {
    const plugin = window.Capacitor?.Plugins?.ExoPlayerPlugin;
    if (!plugin) {
      throw new Error('ExoPlayerPlugin no disponible en este entorno.');
    }

    // Configurar fondo transparente del webview para que ExoPlayer renderice por debajo
    try {
      document.body.classList.add('exoplayer-active');
    } catch (_) {}

    this.listeners.push(
      await plugin.addListener('onTimeUpdate', (data) => {
        this._currentTime = data.currentTime || 0;
        this._duration = data.duration || this._duration || 0;
        this.onEvent('timeupdate', { currentTime: this._currentTime, duration: this._duration });
      }),
      await plugin.addListener('onStateChanged', (data) => {
        if (data.state === 'READY') {
          this._duration = data.duration || 0;
          this.onEvent('ready', { duration: this._duration });
        } else if (data.state === 'PLAYING') {
          this._paused = false;
          this.onEvent('play');
        } else if (data.state === 'PAUSED') {
          this._paused = true;
          this.onEvent('pause');
        } else if (data.state === 'ENDED') {
          this.onEvent('ended');
        }
      }),
      await plugin.addListener('onTracks', (data) => {
        this.tracks = {
          audio: (data.audio || []).map((t, i) => ({ ...t, native: true, enabled: t.selected ?? (i === 0) })),
          text: (data.text || []).map((t) => ({ ...t, native: true, mode: t.selected ? 'showing' : 'disabled' })),
        };
        this.onEvent('tracks', this.tracks);
      }),
      await plugin.addListener('onError', (err) => {
        this.onEvent('error', err);
      })
    );

    await plugin.play({
      url: this.url,
      resumeAt: this.resumeAt,
      title: this.title,
    });
  }

  get currentTime() { return this._currentTime; }
  set currentTime(v) {
    this._currentTime = v;
    window.Capacitor?.Plugins?.ExoPlayerPlugin?.seek({ time: v });
  }
  get duration() { return this._duration; }
  get paused() { return this._paused; }

  play() {
    this._paused = false;
    window.Capacitor?.Plugins?.ExoPlayerPlugin?.resume();
  }
  pause() {
    this._paused = true;
    window.Capacitor?.Plugins?.ExoPlayerPlugin?.pause();
  }

  async setAudioTrack(index) {
    const audios = this.tracks.audio;
    if (!audios || !audios[index]) return { success: false };
    const track = audios[index];
    try {
      await window.Capacitor?.Plugins?.ExoPlayerPlugin?.setAudioTrack({ index });
      audios.forEach((t, i) => { t.enabled = (i === index); });
      return { success: true, native: true, label: formatTrackName(track, index, 'Audio') };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  async setSubtitleTrack(index) {
    const subs = this.tracks.text;
    try {
      await window.Capacitor?.Plugins?.ExoPlayerPlugin?.setSubtitleTrack({ index });
      subs.forEach((t, i) => { t.mode = (i === index) ? 'showing' : 'disabled'; });
      if (index === -1) return { success: true, disabled: true };
      const track = subs[index];
      return { success: true, native: true, label: formatTrackName(track, index, 'Subtítulo') };
    } catch (e) {
      return { success: false, message: e.message };
    }
  }

  destroy() {
    try {
      document.body.classList.remove('exoplayer-active');
      this.listeners.forEach(l => l.remove?.());
      window.Capacitor?.Plugins?.ExoPlayerPlugin?.stop();
    } catch (_) {}
  }
}

// Factoría principal del motor
export async function createPlayerEngine({ container, url, resumeAt = 0, title = '', onEvent, forceWeb = false }) {
  if (!forceWeb && isCapacitorNative() && window.Capacitor?.Plugins?.ExoPlayerPlugin) {
    try {
      const exo = new ExoPlayerEngine({ container, url, resumeAt, title, onEvent });
      await exo.init();
      return exo;
    } catch (e) {
      console.warn('[engine] Error iniciando ExoPlayer nativo, recurriendo a ArtPlayer:', e);
    }
  }
  const art = new ArtPlayerEngine({ container, url, resumeAt, onEvent });
  await art.init();
  return art;
}
