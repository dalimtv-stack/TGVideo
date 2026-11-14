export function adjacentSeason(seasons, current, direction) {
  const index = seasons.indexOf(current);
  return index < 0 ? null : seasons[index + direction] ?? null;
}
export function firstUncompleted(files, progress) {
  return files.find(file => !progress[file.key]?.is_completed) || files[0] || null;
}
export function centerSeason(track, button) {
  if (!track || !button) return;
  const padding = Math.max(0, (track.clientWidth - button.offsetWidth) / 2);
  track.style.paddingLeft = `${padding}px`;
  track.style.paddingRight = `${padding}px`;
  track.scrollTo({ left: button.offsetLeft - (track.clientWidth - button.offsetWidth) / 2, behavior: 'instant' });
}
