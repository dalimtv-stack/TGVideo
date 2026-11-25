// Canales macro: agrupa archivos por "Sección:" del caption
export const SEP = '::';
export const TSEP = ':';
export const POST = '::tgstorage';
export const NO_SECTION = '(Sin sección)';

export function splitBySection(files) {
  const map = new Map();
  for (const f of files) {
    const rawS = f.section ? String(f.section).trim() : '';
    const s = rawS || NO_SECTION;
    const lowerKey = s.toLowerCase();

    // Encontrar si ya existe una sección con el mismo nombre normalizado (ignora mayúsculas/espacios)
    let matchedKey = null;
    for (const existingKey of map.keys()) {
      if (existingKey.toLowerCase() === lowerKey) {
        matchedKey = existingKey;
        break;
      }
    }

    const finalKey = matchedKey || s;
    if (!map.has(finalKey)) map.set(finalKey, []);
    map.get(finalKey).push(f);
  }
  return map;
}
