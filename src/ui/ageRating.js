// src/ui/ageRating.js
// Normalización y renderizado del distintivo de edad recomendada con colores para TV y Web.

const AGE_SEVERITY = {
  'X': 100,
  '18': 18,
  '16': 16,
  '12': 12,
  '7': 7,
  'APTA': 0,
  'NR': -1,
};

export function getAgeRatingInfo(raw) {
  if (!raw && raw !== 0) return null;
  const str = String(raw).trim();
  if (!str) return null;
  const upper = str.toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u2011/g, "-")
    .replace(/\s+/g, " ");

  // 1. Adulto / X
  if (/^X\b/i.test(upper) || upper === 'X' || upper.includes('PELICULA X') || upper.includes('+18X') || upper.includes('ADULT')) {
    return { label: 'X', color: '#ff3333', className: 'age-rating--x' };
  }

  // K-16, R-16, R‑16 pasan a 16 (se evalúan antes de la regla R de 18)
  if (/\b(?:K|R)[-‑]?16\b/i.test(upper)) {
    return { label: '16', color: '#f97316', className: 'age-rating--16' };
  }

  // TV-PG mantiene la clasificación de 7 años; debe resolverse antes de la regla PG.
  if (/\bTV-?PG\b/.test(upper)) {
    return { label: '7', color: '#22c55e', className: 'age-rating--7' };
  }

  // 2. 18 / R / NC-17 / TV-MA
  // R pasa a 18 (K-16 y R-16 ya clasificados arriba)
  if (
    upper.includes('18') ||
    /\b(R|NC-?17|TV-?MA|R18)\b/.test(upper) ||
    upper.includes('MAYORES DE 18')
  ) {
    return { label: '18', color: '#ff3333', className: 'age-rating--18' };
  }

  // 3. 16 / 15 / 15+ / M (Mature)
  // 15, 15+, M, K-16, R-16 pasan a 16
  if (
    upper.includes('16') ||
    /\b15\+?\b/.test(upper) ||
    upper.includes('MAYORES DE 16') ||
    (/\bM\b/.test(upper) && !upper.includes('MAYORES') && !upper.includes('MIN'))
  ) {
    return { label: '16', color: '#f97316', className: 'age-rating--16' };
  }

  // 4. 12 / 12A / 14 / PG / PG-13 / 13 / TV-14
  // 12A, 14, PG, PG-13 pasan a 12
  if (
    upper.includes('12') ||
    /\b12A\b/.test(upper) ||
    /\b14\b/.test(upper) ||
    upper.includes('13') ||
    /\b(PG|PG-?13|TV-?14)\b/.test(upper) ||
    upper.includes('MAYORES DE 12')
  ) {
    return { label: '12', color: '#eab308', className: 'age-rating--12' };
  }

  // 5. 7 / 7i / 6 / TV-PG / TV-Y7
  // 7i pasa a 7
  if (
    upper.includes('7') ||
    /\b7I\b/.test(upper) ||
    upper.includes('6') ||
    /\b(TV-?PG|TV-?Y7)\b/.test(upper) ||
    upper.includes('MENORES DE 7')
  ) {
    return { label: '7', color: '#22c55e', className: 'age-rating--7' };
  }

  // 6. APTA / A / Ai / TP / Todos los públicos / Infantil / G / TV-G / TV-Y / U / 0
  // A y Ai pasan a APTA
  if (
    upper.includes('APTA') ||
    upper.includes('TP') ||
    upper.includes('TODOS') ||
    upper.includes('INFANTIL') ||
    upper.includes('INFANCIA') ||
    upper.includes('FSK 0') ||
    /\b(A|AI|G|U|TV-?G|TV-?Y|0)\b/.test(upper)
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

  // Si es una saga o colección: evaluar todos sus archivos y películas para tomar la calificación más restrictiva
  const isCollectionOrSaga = t.isSaga || t.isVirtualSaga || t.metadata?.tipo === 'collection' || (Array.isArray(t.archivos) && t.archivos.length > 1 && t.tipo === 'pelicula');
  if (isCollectionOrSaga) {
    let maxRatingInfo = null;
    let maxSeverity = -2;

    const explicitRaw = t.metadata?.ageRating || t.ageRating;
    if (explicitRaw) {
      const explicitInfo = getAgeRatingInfo(explicitRaw);
      if (explicitInfo) {
        const sev = AGE_SEVERITY[explicitInfo.label] ?? 0;
        if (sev > maxSeverity) {
          maxSeverity = sev;
          maxRatingInfo = explicitInfo;
        }
      }
    }

    let maxRatingRaw = explicitRaw || null;
    const files = Array.isArray(t.archivos) ? t.archivos : [];
    for (const f of files) {
      const raw = f.ageRating || f.metadata?.ageRating;
      let info = null;
      let detectedRaw = null;
      if (raw) {
        info = getAgeRatingInfo(raw);
        detectedRaw = raw;
      } else {
        const candidate = `${f.sagaName || ''} ${f.fileName || ''} ${f.label || ''}`;
        const m = candidate.match(/\[(?:\+)?(18|16|12|7|APTA|X|NR|12A|7I|14|15\+?|AI?|K[-‑]?16|R[-‑]?16|PG(?:-?13)?|M|R)\]/i)
          || candidate.match(/\((?:\+)?(18|16|12|7|APTA|X|NR|12A|7I|14|15\+?|AI?|K[-‑]?16|R[-‑]?16|PG(?:-?13)?|M|R)\)/i)
          || candidate.match(/\b(?:\+|edad\s*:?\s*)?(18|16|12|7|NR|12A|7I|14|15\+?|K[-‑]?16|R[-‑]?16|PG(?:-?13)?)\b/i);
        if (m) { info = getAgeRatingInfo(m[1]); detectedRaw = m[1]; }
      }
      if (info) {
        const sev = AGE_SEVERITY[info.label] ?? 0;
        if (sev > maxSeverity) {
          maxSeverity = sev;
          maxRatingInfo = info;
          maxRatingRaw = detectedRaw || info.label;
        }
      }
    }

    if (maxRatingInfo) return { ...maxRatingInfo, raw: String(maxRatingRaw || maxRatingInfo.label).trim() };
  }

  // Título individual estándar
  const raw = t.metadata?.ageRating || t.ageRating || t.archivos?.[0]?.ageRating;
  if (raw) { const info = getAgeRatingInfo(raw); return info ? { ...info, raw: String(raw).trim() } : null; }

  // Fallback: detectar en nombre del archivo o del título (ej: [18], (+16), 18+, etc.)
  const candidate = `${t.nombre || ''} ${t.archivos?.[0]?.fileName || t.archivos?.[0]?.name || ''}`;
  const m = candidate.match(/\[(?:\+)?(18|16|12|7|APTA|X|NR|12A|7I|14|15\+?|AI?|K[-‑]?16|R[-‑]?16|PG(?:-?13)?|M|R)\]/i)
    || candidate.match(/\((?:\+)?(18|16|12|7|APTA|X|NR|12A|7I|14|15\+?|AI?|K[-‑]?16|R[-‑]?16|PG(?:-?13)?|M|R)\)/i)
    || candidate.match(/\b(?:\+|edad\s*:?\s*)?(18|16|12|7|NR|12A|7I|14|15\+?|K[-‑]?16|R[-‑]?16|PG(?:-?13)?)\b/i);
  if (m) {
    const info = getAgeRatingInfo(m[1]);
    return info ? { ...info, raw: m[1] } : null;
  }
  return null;
}

export function renderAgeBadgeHtml(t) {
  const info = resolveTitleAgeRating(t);
  if (!info) return '';
  return `<span class="age-rating-badge ${info.className}" style="color:${info.color}; border-color:${info.color};" title="Edad recomendada: ${info.label}">${info.label}</span>`;
}
