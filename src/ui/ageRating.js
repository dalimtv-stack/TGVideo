// src/ui/ageRating.js
// Normalización y renderizado del distintivo de edad recomendada con colores para TV y Web.

export function getAgeRatingInfo(raw) {
  if (!raw && raw !== 0) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const upper = str.toUpperCase().replace(/\s+/g, '');

  // 18 / Adult / X
  if (/^(\+?18|R|NC-?17|TV-?MA|ADULT(O|S)?)$/i.test(upper) || upper === '18' || upper === '+18') {
    return { label: '18', color: '#ff3333', className: 'age-rating--18' };
  }
  if (upper === 'X' || upper.startsWith('X') || upper.includes('+18X')) {
    return { label: 'X', color: '#ff3333', className: 'age-rating--x' };
  }
  // 16
  if (/^(\+?16)$/i.test(upper) || upper === '16' || upper === '+16') {
    return { label: '16', color: '#f97316', className: 'age-rating--16' };
  }
  // 12 / 13 / 14
  if (/^(\+?12|\+?13|\+?14|PG-?13|TV-?14)$/i.test(upper) || upper === '12' || upper === '+12' || upper === '13' || upper === '14') {
    return { label: '12', color: '#eab308', className: 'age-rating--12' };
  }
  // 7
  if (/^(\+?7|PG|TV-?PG|TV-?Y7)$/i.test(upper) || upper === '7' || upper === '+7') {
    return { label: '7', color: '#22c55e', className: 'age-rating--7' };
  }
  // APTA / TP / General
  if (/^(APTA|TP|A|G|TV-?G|TV-?Y|TODOS|ALL|INFANTIL)$/i.test(upper)) {
    return { label: 'APTA', color: '#0284c7', className: 'age-rating--apta' };
  }

  // Fallbacks numéricos si contienen valores conocidos
  if (upper.includes('18')) return { label: '18', color: '#ff3333', className: 'age-rating--18' };
  if (upper.includes('16')) return { label: '16', color: '#f97316', className: 'age-rating--16' };
  if (upper.includes('12')) return { label: '12', color: '#eab308', className: 'age-rating--12' };
  if (upper.includes('7')) return { label: '7', color: '#22c55e', className: 'age-rating--7' };

  return { label: str, color: '#0284c7', className: 'age-rating--custom' };
}

export function resolveTitleAgeRating(t) {
  if (!t) return null;
  const raw = t.metadata?.ageRating || t.ageRating || t.archivos?.[0]?.ageRating;
  if (raw) return getAgeRatingInfo(raw);

  // Fallback: detectar en nombre del archivo o del título (ej: [18], (+16), 18+, etc.)
  const candidate = `${t.nombre || ''} ${t.archivos?.[0]?.name || ''}`;
  const m = candidate.match(/\[(?:\+)?(18|16|12|7|APTA|X)\]/i)
    || candidate.match(/\((?:\+)?(18|16|12|7|APTA|X)\)/i)
    || candidate.match(/\b(?:\+|edad\s*:?\s*)?(18|16|12|7)\b/i);
  if (m) {
    return getAgeRatingInfo(m[1]);
  }
  return null;
}

export function renderAgeBadgeHtml(t) {
  const info = resolveTitleAgeRating(t);
  if (!info) return '';
  return `<span class="age-rating-badge ${info.className}" style="color:${info.color}; border-color:${info.color};" title="Edad recomendada: ${info.label}">${info.label}</span>`;
}