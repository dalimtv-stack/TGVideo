@import "./style-base.css";


.player-osd-badge:focus {
  outline: 3px solid #fff;
  outline-offset: 2px;
  background: rgba(255, 255, 255, 0.25);
}

.player-osd-bottom {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
}

.player-timeline-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  width: 100%;
}

.player-osd-time {
  font-size: 0.9rem;
  font-family: monospace;
  font-weight: 600;
  color: #cbd5e1;
  min-width: 3.8rem;
  text-align: center;
}

.player-scrubber-track {
  flex: 1;
  height: 8px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  cursor: pointer;
  position: relative;
  transition: height 0.15s ease;
}

.player-scrubber-track:focus,
.player-scrubber-track:hover {
  height: 12px;
  outline: 2px solid #fff;
  outline-offset: 2px;
}

.player-scrubber-fill {
  height: 100%;
  width: 0%;
  background: #e50914;
  border-radius: 4px;
  position: relative;
}

.player-scrubber-thumb {
  position: absolute;
  right: -6px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 0 6px rgba(0,0,0,0.6);
}

.player-controls-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.2rem;
}

.player-ctrl-btn {
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #f8fafc;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, transform 0.15s;
  padding: 0;
}

.player-ctrl-btn svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
}

.player-ctrl-btn:focus {
  outline: 3px solid #fff;
  outline-offset: 2px;
  background: rgba(255, 255, 255, 0.3);
  transform: scale(1.15);
}

.player-ctrl-btn-primary {
  background: #e50914;
  border-color: #e50914;
  width: 52px;
  height: 52px;
}

.player-ctrl-btn-primary svg {
  width: 26px;
  height: 26px;
}

.player-ctrl-btn-primary:focus {
  outline: 3px solid #fff;
  outline-offset: 2px;
  background: #ff1f2d;
  transform: scale(1.15);
}

.player-osd-toast {
  position: absolute;
  top: 12%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(15, 23, 42, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.4);
  color: #fff;
  font-size: 1.05rem;
  font-weight: 600;
  padding: 0.6rem 1.4rem;
  border-radius: 30px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7);
  z-index: 60;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.2s ease, transform 0.2s ease;
}

.player-osd-toast.show {
  opacity: 1;
  transform: translate(-50%, -40%);
}

/* Layout adaptativo modal TMDB (TV / Apaisado) */
.meta-modal-body {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

@media (min-width: 768px), (orientation: landscape) and (min-height: 440px) {
  .settings-dialog:has(.meta-modal-body) {
    width: min(940px, 94vw);
    max-height: 88vh;
  }
  .meta-modal-body {
    display: grid;
    grid-template-columns: 340px 1fr;
    gap: 1.5rem;
    align-items: start;
  }
  .meta-col-left {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
  }
  .meta-col-right {
    min-height: 0;
  }
  .meta-results-container {
    max-height: calc(85vh - 120px);
    overflow-y: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .meta-results-container::-webkit-scrollbar {
    display: none;
  }
}

/* Ocultar barra interna nativa de ArtPlayer (usamos OSD Stremio unificado) */
.player-art .art-bottom,
.player-art .art-controls,
.player-art .art-progress,
.player-art .art-loading,
.artplayer-host .art-bottom,
.artplayer-host .art-controls,
.artplayer-host .art-progress,
.artplayer-host .art-loading {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
  pointer-events: none !important;
}

/* Indicador de foco visible y potente para barra de tiempo en TV */
.player-scrubber-track:focus,
.player-scrubber-track.dpad-focused {
  height: 14px !important;
  outline: 3px solid #e50914 !important;
  outline-offset: 3px !important;
  box-shadow: 0 0 24px rgba(229, 9, 20, 1) !important;
  background: rgba(255, 255, 255, 0.4) !important;
}
.player-scrubber-track:focus .player-scrubber-thumb,
.player-scrubber-track.dpad-focused .player-scrubber-thumb {
  transform: translateY(-50%) scale(1.8) !important;
  background: #ffffff !important;
  box-shadow: 0 0 16px #e50914, 0 0 28px rgba(229, 9, 20, 0.9) !important;
}

/* Selector Modal de Pistas de Audio y Subtítulos */
.player-tracks-overlay {
  position: absolute;
  inset: 0;
  z-index: 100;
  background: rgba(0, 0, 0, 0.72);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  animation: fadeIn 0.18s ease-out;
}

.player-tracks-menu {
  background: #111827;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 14px;
  width: min(440px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 16px 36px rgba(0, 0, 0, 0.85);
  overflow: hidden;
}

.player-tracks-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.9rem 1.2rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 1.1rem;
  font-weight: 700;
  color: #f8fafc;
}

.player-tracks-close {
  background: rgba(255, 255, 255, 0.1);
  border: none;
  color: #cbd5e1;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-size: 1.1rem;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.player-tracks-close:focus,
.player-tracks-close:hover {
  background: #e50914;
  color: #fff;
  outline: 2px solid #fff;
}

.player-tracks-list {
  padding: 0.8rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.player-track-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 0.8rem 1rem;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  color: #e2e8f0;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s ease;
}

.player-track-option.is-selected {
  background: rgba(229, 9, 20, 0.15);
  border-color: #e50914;
  color: #fff;
  font-weight: 600;
}

.player-track-option:focus,
.player-track-option:hover {
  outline: 3px solid #e50914;
  outline-offset: 1px;
  background: rgba(229, 9, 20, 0.35);
  color: #fff;
  transform: scale(1.02);
}

.player-track-check {
  color: #e50914;
  font-weight: 800;
  font-size: 1.1rem;
}

.player-track-empty {
  padding: 0.8rem;
  color: #94a3b8;
  font-size: 0.9rem;
  text-align: center;
  font-style: italic;
}

/* ===== Selector de tamaño de portadas y fuentes por perfil ===== */
.ui-scale-setting {
  margin-top: 0.8rem;
  padding-top: 0.8rem;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.ui-scale-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.6rem;
  font-size: 0.95rem;
}
.ui-scale-value {
  color: #e50914;
  font-weight: 700;
  font-size: 0.95rem;
}
.settings-slider {
  width: 100%;
  accent-color: #e50914;
  height: 8px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.2);
  cursor: pointer;
  outline: none;
  margin: 0.4rem 0;
}
.settings-slider:focus,
.settings-slider:focus-visible {
  outline: 3px solid #fff !important;
  outline-offset: 3px !important;
  box-shadow: 0 0 16px rgba(255, 255, 255, 0.8);
}
.ui-scale-ticks {
  display: flex;
  justify-content: space-between;
  font-size: 0.72rem;
  color: #888;
  margin-top: 0.35rem;
  user-select: none;
}

/* ===== Filas con botón expandir en cuadrícula (+) ===== */
.row-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 0 max(1.5rem, calc(var(--sal) + 1rem)) 0.7rem;
}

.row-header .row-title {
  margin: 0;
}

/* Mini tarjeta "+" al inicio de la fila para ver cuadrícula */
.row-expand-card {
  flex: 0 0 calc(38px * var(--ui-scale, 1.12)) !important;
  width: calc(38px * var(--ui-scale, 1.12)) !important;
  cursor: pointer;
  outline: none;
  scroll-margin-left: 0;
  scroll-margin-right: 12px;
  display: flex;
  flex-direction: column;
  margin-left: 0 !important;
  margin-right: 0 !important;
}

.row-expand-card-inner {
  width: 100%;
  height: calc(200px * var(--ui-scale, 1.12));
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  background: transparent;
  transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s, background 0.15s;
}

.row-expand-card:focus .row-expand-card-inner,
.row-expand-card:hover .row-expand-card-inner,
.row-expand-card.dpad-focused .row-expand-card-inner {
  transform: scale(1.05);
  border-color: #fff;
  background: rgba(255, 255, 255, 0.18);
  box-shadow: 0 0 16px rgba(255, 255, 255, 0.35);
}

.row-expand-plus {
  font-size: calc(2rem * var(--ui-font-scale, 1));
  font-weight: 300;
  color: #fff;
  line-height: 1;
  pointer-events: none;
  user-select: none;
}

/* ===== Vista en cuadrícula de grupo / categoría ===== */
.grid-screen {
  padding: 1.5rem max(1.5rem, calc(var(--sal) + 1rem)) 4rem;
  min-height: 100vh;
  min-height: 100dvh;
}

.grid-header {
  display: flex;
  align-items: center;
  gap: 1.2rem;
  margin-bottom: 2rem;
}

.grid-header-info h1 {
  font-size: calc(1.6rem * var(--ui-font-scale, 1));
  font-weight: 700;
  margin: 0 0 0.2rem;
}

.grid-count {
  font-size: 0.9rem;
  color: #aaa;
}

.grid-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(calc(135px * var(--ui-scale, 1.12)), 1fr));
  gap: 1.8rem 1.2rem;
  justify-items: center;
}

.grid-cards .lib-card {
  width: 100%;
  max-width: calc(160px * var(--ui-scale, 1.12));
}

.grid-cards .lib-card-poster {
  width: 100%;
  height: calc(210px * var(--ui-scale, 1.12));
}

@media (max-width: 680px) {
  .row-header {
    margin: 0 max(1rem, var(--sal)) 0.6rem;
    gap: 0.5rem;
  }
  .row-expand-card {
    flex: 0 0 calc(34px * var(--ui-scale, 1.12)) !important;
    width: calc(34px * var(--ui-scale, 1.12)) !important;
  }
  .row-expand-card-inner {
    height: calc(155px * var(--ui-scale, 1.12));
  }
  .row-expand-plus {
    font-size: 1.6rem;
  }
  .grid-screen {
    padding: 1rem max(1rem, var(--sal)) 3rem;
  }
  .grid-cards {
    grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
    gap: 1.2rem 0.75rem;
  }
  .grid-cards .lib-card-poster {
    height: calc(155px * var(--ui-scale, 1.12));
  }
}

/* ===== Modal de Actualización de Biblioteca ===== */
.update-modal {
  max-width: 480px;
  width: 90%;
  background: #1c1c1e;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.8);
}

.btn-update-option {
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  border-radius: 10px;
  transition: all 0.15s ease;
  cursor: pointer;
}

.btn-update-option:hover,
.btn-update-option:focus {
  background: rgba(229, 9, 20, 0.2);
  border-color: var(--accent, #e50914);
  transform: translateY(-2px);
  outline: none;
}


/* ===== Siguiente episodio (cuenta atrás) ===== */
.player-next-up {
  position: absolute;
  right: max(1rem, env(safe-area-inset-left, 0px));
  bottom: max(5.5rem, calc(env(safe-area-inset-bottom, 0px) + 4.5rem));
  z-index: 40;
  pointer-events: auto;
  max-width: min(320px, 80vw);
}
.player-next-up-inner {
  background: rgba(0, 0, 0, 0.82);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  padding: 0.75rem 1rem;
  backdrop-filter: blur(8px);
}
.player-next-up-label {
  font-size: 0.8rem;
  color: #bbb;
  margin-bottom: 0.25rem;
}
.player-next-up-count {
  color: #e50914;
  font-weight: 700;
}
.player-next-up-title {
  font-size: 0.95rem;
  color: #fff;
  font-weight: 600;
  line-height: 1.3;
  margin-bottom: 0.5rem;
}
.player-next-up-cancel {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.35);
  color: #ddd;
  border-radius: 4px;
  padding: 0.3rem 0.7rem;
  font-size: 0.8rem;
  cursor: pointer;
}
.player-next-up-cancel:hover,
.player-next-up-cancel:focus {
  border-color: #fff;
  color: #fff;
  outline: none;
}

/* Subtítulos nativos: zona segura inferior (iPhone) */
.native-video::cue,
video::cue {
  background: transparent !important;
  background-color: transparent !important;
  color: #FECB00 !important;
  -webkit-text-stroke: 4px #000000 !important;
  text-shadow: 0 3px 9px rgba(0, 0, 0, 0.5) !important;
}
.player-native,
.player {
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.player-osd-bottom {
  padding-bottom: max(0.6rem, env(safe-area-inset-bottom, 0px));
  padding-left: max(0.75rem, env(safe-area-inset-left, 0px));
  padding-right: max(0.75rem, env(safe-area-inset-right, 0px));
}
.player-osd-top {
  padding-top: max(0.5rem, env(safe-area-inset-top, 0px));
  padding-left: max(0.75rem, env(safe-area-inset-left, 0px));
  padding-right: max(0.75rem, env(safe-area-inset-right, 0px));
}

/* ===== Ajustes nov-2026 ===== */
/* Foco de temporadas sin recorte */
.seasons-track { padding-top: 10px; margin-top: -10px; padding-left: 6px; padding-right: 6px; }
/* "+" pegado al margen izquierdo de la fila con separación uniforme */
.row-expand-card { margin-left: 0 !important; margin-right: 0 !important; }
.row-track { align-items: flex-start; overflow-y: hidden; min-height: calc(265px * var(--ui-scale, 1.12)); }
.row-track .lib-card-name { height: 2.7em; min-height: 2.7em; max-height: 2.7em; line-height: 1.35; word-break: break-word; }

/* Subtítulos iPhone: vídeo a pantalla completa sin desplazar la caja de subtítulos */
.player-native, .player { padding-bottom: 0; }
.player video { position: absolute; inset: 0; width: 100%; height: 100%; }
.player-next-up-cancel:focus { outline: 3px solid #fff; outline-offset: 2px; }

/* Ajustes de perfil / menú compacto para Android TV y pantallas panorámicas */
.profile-settings-form {
  font-size: 0.88rem;
  gap: 0.65rem;
}
.profile-settings-form label {
  gap: 0.35rem;
  font-size: 0.88rem;
}
.profile-settings-form input,
.profile-settings-form select,
.profile-settings-form button {
  font-size: 0.88rem;
  padding: 0.55rem 0.75rem;
}
.profile-settings-form .settings-section {
  padding: 0.6rem 0.75rem;
  gap: 0.45rem;
  margin-top: 0;
}
.profile-settings-form .settings-legend {
  font-size: 0.88rem;
}
.profile-settings-form .settings-radios {
  gap: 0.45rem;
}
.profile-settings-form .settings-radio-label {
  padding: 0.45rem 0.6rem;
}
.profile-settings-form .settings-radio-info strong {
  font-size: 0.88rem;
}
.profile-settings-form .settings-radio-info small {
  font-size: 0.76rem;
  line-height: 1.25;
}
.profile-settings-form .ui-scale-ticks {
  font-size: 0.7rem;
}
.profile-settings-cols {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.profile-settings-col {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-width: 0;
}

/* Ajustes de perfil: compacto, solo nombre y avatar */
.settings-dialog:has(.profile-settings-form) {
  width: min(380px, 94vw);
  padding: 1rem 1.25rem;
}

/* Ajustes de dispositivo: una sola columna, cabe en TV */
/* Ajustes de dispositivo: diseño ultra-compacto para pantallas gigantes y TVs */
.settings-dialog:has(.device-settings-form) {
  width: min(500px, 92vw);
  max-height: 85vh;
  padding: 0.7rem 1rem;
  overflow-y: auto;
}
.device-settings-form {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  font-size: 0.82rem;
}
.device-settings-form .settings-section {
  margin-top: 0;
  padding: 0.45rem 0.65rem;
  gap: 0.35rem;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.device-settings-form .settings-legend {
  font-size: 0.78rem;
  padding: 0 0.35rem;
  margin-bottom: 0.15rem;
}
.device-settings-form .settings-radios {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.device-settings-form .settings-radio-label {
  padding: 0.35rem 0.55rem;
  gap: 0.5rem;
}
.device-settings-form .settings-radio-info strong {
  font-size: 0.82rem;
}
.device-settings-form .settings-radio-info small {
  font-size: 0.72rem;
  line-height: 1.2;
}
.device-settings-form .settings-field-row {
  margin: 0;
  padding: 0;
}
.device-settings-form .settings-label-inline {
  font-size: 0.82rem;
}
.device-settings-form .ui-scale-setting {
  margin-top: 0.25rem;
  padding-top: 0.25rem;
}
.device-settings-form .ui-scale-header {
  font-size: 0.8rem;
  margin-bottom: 0.25rem;
}
.device-settings-form .ui-scale-ticks {
  font-size: 0.62rem;
  margin-top: 0.2rem;
}
.device-settings-form .settings-actions {
  margin-top: 0.6rem;
}
.device-settings-form .settings-actions .btn {
  padding: 0.5rem 1rem;
  font-size: 0.85rem;
}

/* Botonera de acciones en la ficha (Reproducir, Favoritos, Visto) */
.detail-actions-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 0.8rem;
}

.btn-icon-action {
  position: relative;
  width: calc(44px * var(--ui-scale, 1.12));
  height: calc(44px * var(--ui-scale, 1.12));
  min-width: calc(44px * var(--ui-scale, 1.12));
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  outline: none;
  transition: transform 0.15s, background 0.15s, border-color 0.15s, color 0.15s;
}

.btn-icon-action .btn-action-icon {
  font-size: calc(1.3rem * var(--ui-font-scale, 1));
  line-height: 1;
}

.btn-icon-action:hover,
.btn-icon-action:focus,
.btn-icon-action.dpad-focused {
  background: rgba(255, 255, 255, 0.25);
  border-color: #fff;
  transform: scale(1.08);
}

.btn-icon-action.active {
  color: #e50914;
  border-color: #e50914;
  background: rgba(229, 9, 20, 0.15);
}

/* Tooltip emergente que se muestra sólo con foco o hover */
.btn-icon-action .btn-action-tooltip {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  background: #111;
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 0.78rem;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  visibility: hidden;
  transition: opacity 0.15s, visibility 0.15s;
  box-shadow: 0 4px 12px rgba(0,0,0,0.5);
  border: 1px solid #444;
  z-index: 10;
}

.btn-icon-action:hover .btn-action-tooltip,
.btn-icon-action:focus .btn-action-tooltip,
.btn-icon-action.dpad-focused .btn-action-tooltip {
  opacity: 1;
  visibility: visible;
}

/* Forzar line-clamp a 3 líneas en sinopsis para evitar botón "más" innecesario */
.detail-syn:not(.expanded) {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* ExoPlayer en APK nativo (fondo transparente para renderizado por debajo) */
body.exoplayer-active,
body.exoplayer-active #app,
body.exoplayer-active .player,
body.exoplayer-active .player-video-mount {
  background: transparent !important;
  background-color: transparent !important;
}

/* Modal selector de pistas de audio y subtitulos */
.player-tracks-modal {
  position: absolute;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, 0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}
.player-tracks-dialog {
  background: #1c1c1c;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  width: min(440px, 92vw);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.85);
}
.player-tracks-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.player-tracks-header h3 {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
}
.player-tracks-close {
  background: transparent;
  border: none;
  color: #fff;
  font-size: 1.6rem;
  cursor: pointer;
  line-height: 1;
}
.player-tracks-list {
  padding: 0.8rem;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}
.player-track-option {
  padding: 0.8rem 1.1rem;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid transparent;
  border-radius: 8px;
  color: #ddd;
  font-size: 0.95rem;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}
.player-track-option:hover,
.player-track-option:focus {
  background: rgba(255, 255, 255, 0.2);
  border-color: #fff;
  color: #fff;
  outline: none;
}


/* El tamaño de carátulas/letras pertenece al perfil y tiene exactamente cinco posiciones. */
.profile-scale-setting { display: block; grid-column: 1 / -1; }
.profile-scale-setting .ui-scale-header { display: flex; justify-content: space-between; gap: .75rem; }
.profile-scale-setting .ui-scale-ticks { display: flex; justify-content: space-between; gap: .15rem; }
.profile-scale-setting .ui-scale-ticks span { flex: 1; text-align: center; font-size: .62rem; line-height: 1.15; }

/* La APK usa pantalla completa del sistema; el control propio queda solo en web. */
.player-exoplayer #pl-btn-fullscreen,
.player-native.native-android-app #pl-btn-fullscreen { display: none !important; }


/* Ajustes de dispositivo: formulario compacto también en pantallas pequeñas o TV. */
.settings-overlay:has(.device-settings-form) .settings-dialog {
  width: min(480px, 92vw);
  max-height: 88vh;
  padding: .85rem;
}
.settings-overlay:has(.device-settings-form) .settings-dialog header { margin-bottom: .75rem; }
.settings-overlay:has(.device-settings-form) .device-settings-form,
.settings-overlay:has(.device-settings-form) .settings-radios { gap: .55rem; }
.settings-overlay:has(.device-settings-form) .settings-section { padding: .55rem; margin-bottom: .5rem; }
.settings-overlay:has(.device-settings-form) .settings-radio-info strong { font-size: .88rem; }
.settings-overlay:has(.device-settings-form) .settings-radio-info small { font-size: .72rem; line-height: 1.3; }
.settings-overlay:has(.device-settings-form) .settings-field-row,
.settings-overlay:has(.device-settings-form) .settings-label-inline { gap: .35rem; font-size: .82rem; }


/* En los carruseles, el título va bajo la carátula y nunca se duplica dentro. */
.row-track .poster-name { display: none !important; }
.row-track .lib-card { scroll-snap-align: center; }
.row-track { scroll-snap-type: x mandatory; }
