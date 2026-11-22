// src/ui/ageRating.js
// Normalización y renderizado del distintivo de edad recomendada con colores para TV y Web.

export function getAgeRatingInfo(raw) {
  if (!raw && raw !== 0) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const upper = str.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ");

  // 1. Adulto / X
  if (/^X\b/i.test(upper) || upper === 'X' || upper.includes('PELICULA X') || upper.includes('+18X') || upper.includes('ADULT')) {
    return { label: 'X', color: '#ff3333', className: 'age-rating--x' };
  }

  // 2. 18 / R / NC-17 / TV-MA
  if (
    upper.includes('18') ||
    /\b(R|NC-?17|TV-?MA|R18)\b/.test(upper) ||
    upper.includes('MAYORES DE 18')
  ) {
    return { label: '18', color: '#ff3333', className: 'age-rating--18' };
  }

  // 3. 16 / 15 (BBFC)
  if (
    upper.includes('16') ||
    upper.includes('15') ||
    upper.includes('MAYORES DE 16')
  ) {
    return { label: '16', color: '#f97316', className: 'age-rating--16' };
  }

  // 4. 12 / 13 / 14 / PG-13 / TV-14 / 12A
  if (
    upper.includes('12') ||
    upper.includes('13') ||
    upper.includes('14') ||
    /\b(PG-?13|TV-?14|12A)\b/.test(upper) ||
    upper.includes('MAYORES DE 12')
  ) {
    return { label: '12', color: '#eab308', className: 'age-rating--12' };
  }

  // 5. 7 / 6 / PG / TV-PG / TV-Y7
  if (
    upper.includes('7') ||
    upper.includes('6') ||
    /\b(PG|TV-?PG|TV-?Y7)\b/.test(upper) ||
    upper.includes('MENORES DE 7')
  ) {
    return { label: '7', color: '#22c55e', className: 'age-rating--7' };
  }

  // 6. APTA / TP / Todos los públicos / Infantil / G / TV-G / TV-Y / U / 0
  if (
    upper.includes('APTA') ||
    upper.includes('TP') ||
    upper.includes('TODOS') ||
    upper.includes('INFANTIL') ||
    upper.includes('INFANCIA') ||
    upper.includes('FSK 0') ||
    /\b(A|G|U|TV-?G|TV-?Y|0)\b/.test(upper)
  ) {
    return { label: 'APTA', color: '#0284c7', className: 'age-rating--apta' };
  }

  // 7. NR / Not Rated / Sin calificar / SC / Unrated
  if (
    upper === 'NR' ||
    upper === 'SC' ||
    upper.includes('NOT RATED') ||
    upper.includes('SIN CALIFICAR') ||
    upper.includes('UNRATED') ||
    upper.includes('NO RECOMENDADA')
  ) {
    return { label: 'NR', color: '#94a3b8', className: 'age-rating--nr' };
  }

  return { label: str, color: '#0284c7', className: 'age-rating--custom' };
}

export function resolveTitleAgeRating(t) {
  if (!t) return null;
  const raw = t.metadata?.ageRating || t.ageRating || t.archivos?.[0]?.ageRating;
  if (raw) return getAgeRatingInfo(raw);

  // Fallback: detectar en nombre del archivo o del título (ej: [18], (+16), 18+, etc.)
  const candidate = `${t.nombre || ''} ${t.archivos?.[0]?.name || ''}`;
  const m = candidate.match(/\[(?:\+)?(18|16|12|7|APTA|X|NR)\]/i)
    || candidate.match(/\((?:\+)?(18|16|12|7|APTA|X|NR)\)/i)
    || candidate.match(/\b(?:\+|edad\s*:?\s*)?(18|16|12|7|NR)\b/i);
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