// Canales macro: agrupa archivos por "Sección:" del caption
export const SEP = '::';
export const TSEP = ':';
export const POST = '::tgstorage';
export const NO_SECTION = '(Sin sección)';

export function splitBySection(files) {
  const map = new Map();
  for (const f of files) {
    const s = f.section || NO_SECTION;
    if (!map.has(s)) map.set(s, []);
    map.get(s).push(f);
  }
  return map;
}
