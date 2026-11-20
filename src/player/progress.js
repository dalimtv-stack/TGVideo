// src/player/progress.js
// Progreso local y sincronización de favoritos y estado de reproducción por perfil
const key = (pid) => `tgv_progress_${pid}`;

export function loadProgress(pid) {
  try { return JSON.parse(localStorage.getItem(key(pid)) || '{}'); } catch { return {}; }
}

export function writeFullProgress(pid, allProgress) {
  try { localStorage.setItem(key(pid), JSON.stringify(allProgress || {})); } catch (_) {}
}

export function saveProgress(pid, fileKey, current_time, duration, forceDone = false) {
  const all = loadProgress(pid);
  const is_completed = forceDone || (duration > 0 && current_time / duration >= 0.9);
  all[fileKey] = { current_time, duration, is_completed, updated_at: Date.now() };
  writeFullProgress(pid, all);
  return all;
}

/** Estado de un título: siguiente archivo a ver y si va en "Seguir viendo" */
export function titleState(title, progress) {
  const files = title.archivos;
  let lastIdx = -1, lastAt = 0, started = false;
  files.forEach((f, i) => {
    const p = progress[f.key];
    if (p) { started = true; if (p.updated_at > lastAt) { lastAt = p.updated_at; lastIdx = i; } }
  });
  if (!started) return { started: false, next: files[0] || null, continueWatching: false, updatedAt: 0 };
  const last = files[lastIdx];
  const lp = progress[last.key];
  if (!lp.is_completed) return { started, next: last, resumeAt: lp.current_time, continueWatching: true, updatedAt: lastAt };
  // Último visto completado → buscar siguiente no completado (p.ej. episodio nuevo subido)
  const next = files.slice(lastIdx + 1).find(f => !progress[f.key]?.is_completed)
    || (title.tipo === 'serie' ? files.find(f => !progress[f.key]?.is_completed) : null);
  return { started, next: next || null, continueWatching: !!next && title.tipo === 'serie', updatedAt: lastAt };
}

// Funciones de Favoritos y Visto por perfil
const favKey = (pid) => `tgv_favorites_${pid}`;

export function loadFavorites(pid) {
  try { return JSON.parse(localStorage.getItem(favKey(pid)) || '[]'); } catch { return []; }
}

export function saveFavorites(pid, list) {
  const clean = Array.isArray(list) ? list.map(String) : [];
  const unique = Array.from(new Set(clean));
  try { localStorage.setItem(favKey(pid), JSON.stringify(unique)); } catch (_) {}
  return unique;
}

export function mergeFavorites(local = [], remote = []) {
  const arr1 = Array.isArray(local) ? local.map(String) : [];
  const arr2 = Array.isArray(remote) ? remote.map(String) : [];
  return Array.from(new Set([...arr1, ...arr2]));
}

export function isFavorite(pid, titleId) {
  if (!pid || !titleId) return false;
  return loadFavorites(pid).includes(String(titleId));
}

export function toggleFavorite(pid, titleId, sync, profile) {
  if (!pid || !titleId) return false;
  const list = loadFavorites(pid);
  const idStr = String(titleId);
  const idx = list.indexOf(idStr);
  if (idx >= 0) list.splice(idx, 1);
  else list.unshift(idStr);
  const updated = saveFavorites(pid, list);

  if (profile) {
    profile.favorites = updated;
  }
  if (sync?.schedulePush) {
    try {
      sync.schedulePush({
        profile: profile || { id: pid },
        progress: loadProgress(pid),
        favorites: updated,
      });
    } catch (_) {}
  }
  return updated.includes(idStr);
}

export function toggleAllWatched(pid, title) {
  if (!pid || !title?.archivos?.length) return false;
  const all = loadProgress(pid);
  const files = title.archivos;
  const isAllDone = files.every(f => all[f.key]?.is_completed);
  const targetCompleted = !isAllDone;
  const now = Date.now();

  for (const f of files) {
    const cur = all[f.key] || {};
    all[f.key] = {
      current_time: targetCompleted ? (f.duration || cur.duration || 1) : 0,
      duration: f.duration || cur.duration || 0,
      is_completed: targetCompleted,
      updated_at: now
    };
  }
  writeFullProgress(pid, all);
  return targetCompleted;
}
