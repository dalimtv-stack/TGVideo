// src/player/playerPrefs.js
// Catálogo de reproductores, rotación del botón del OSD y persistencia de la elección.
// ExoPlayer solo existe en la APK; en la web se alterna ArtPlayer ⇄ Nativo.
import { isAndroidApp } from '../core/platform.js';
import { getDeviceId } from '../ui/settings.js';

export const PLAYERS = {
  exoplayer: { id: 'exoplayer', label: 'ExoPlayer', androidOnly: true },
  artplayer: { id: 'artplayer', label: 'ArtPlayer', androidOnly: false },
  native: { id: 'native', label: 'Nativo', androidOnly: false },
};

export function availablePlayerIds() {
  return Object.values(PLAYERS)
    .filter((p) => !p.androidOnly || isAndroidApp())
    .map((p) => p.id);
}

export function playerLabel(id) {
  return PLAYERS[id]?.label || PLAYERS.artplayer.label;
}

export function nextPlayerId(current) {
  const ids = availablePlayerIds();
  const idx = ids.indexOf(current);
  return ids[(idx + 1) % ids.length];
}

// Texto del único botón del OSD: muestra el reproductor activo.
export function badgeText(id) {
  return `${playerLabel(id)} ⇄`;
}

export function badgeTitle(id) {
  return `Reproductor activo: ${playerLabel(id)}. Pulsa para cambiar a ${playerLabel(nextPlayerId(id))}`;
}

// Guarda el reproductor elegido (dispositivo + perfil) y devuelve su id.
export function setDevicePlayer(profile, playerId) {
  const devId = getDeviceId();
  try {
    localStorage.setItem('tgvideo_device_player', playerId);
    if (profile?.id) localStorage.setItem(`tgvideo_player_${profile.id}`, playerId);
  } catch (_) {}
  if (profile) {
    if (!profile.devices) profile.devices = {};
    if (!profile.devices[devId]) profile.devices[devId] = {};
    profile.devices[devId].player = playerId;
    profile.devices[devId].updated_at = Date.now();
    profile.player = playerId;
  }
  return playerId;
}
