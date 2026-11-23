/**
 * Clasificación y selección compartidas por `cruce.ts` y `cross.ts`.
 *
 * Separa "lo que la gente escribe" de "lo que hay en el catálogo":
 *  - `titleHits`: cuántos títulos contienen la frase (¿describe el tema?).
 *  - `bookShare`: cuántos resultados tienen autor (¿son libros?).
 *  - `classify`: el veredicto de los cuatro posibles.
 */
import { normalize } from "./ngram";

export type Verdict = "candidata" | "saturada" | "nombre-de-libro" | "no-es-libro";

/** Un nombre de libro aparece en 1 o 2 títulos; un tema, en varios. */
export const MIN_BOOK_SHARE = 0.5;
export const MAX_TITLE_HITS_ARTIFACT = 2;
/** Al menos el 20% de los títulos tiene que contener la frase. */
export const MIN_TITLE_SHARE = 0.2;

/**
 * Objetos, no temas. Si la búsqueda contiene una de estas palabras, es un producto.
 * Se aplica a las frases del autocompletar, que traen consultas de todo Amazon
 * ("solar system art decor", "south pole jeans baggy").
 */
const PRODUCT_WORDS = new Set([
  "kit", "kits", "lego", "decor", "poster", "posters", "hat", "hats", "jeans",
  "shirt", "shirts", "costume", "costumes", "toy", "toys", "mug", "mugs",
  "blanket", "blankets", "spray", "sealer", "glove", "gloves", "collar", "collars",
  "leash", "leashes", "backpack", "headphones", "earbuds", "charger", "cable",
  "sticker", "stickers", "calendar", "calendars", "postcard", "notebook",
  "inverter", "underwear", "wheel", "wheels", "rotating", "3t", "controller",
]);

export function looksLikeProduct(phrase: string): boolean {
  return normalize(phrase)
    .split(" ")
    .some((w) => PRODUCT_WORDS.has(w));
}

export function titleHits(phrase: string, titles: string[]): number {
  const words = normalize(phrase).split(" ").filter(Boolean);
  let hits = 0;
  for (const t of titles) {
    const n = ` ${normalize(t)} `;
    if (words.every((w) => n.includes(` ${w} `))) hits++;
  }
  return hits;
}

export function bookShareOf(items: any[]): number {
  if (!items.length) return 0;
  const withAuthor = items.filter((i) => i.author && String(i.author).trim().length > 2).length;
  return Math.round((withAuthor / items.length) * 100) / 100;
}

export function classify(opts: {
  total: number | null;
  maxTotal: number;
  bookShare: number;
  titleHits: number;
  sample: number;
}): Verdict {
  if (opts.bookShare < MIN_BOOK_SHARE) return "no-es-libro";
  const passTotal = opts.total != null && opts.total < opts.maxTotal;
  if (!passTotal) return "saturada";
  const share = opts.sample > 0 ? opts.titleHits / opts.sample : 0;
  if (opts.titleHits > MAX_TITLE_HITS_ARTIFACT && share >= MIN_TITLE_SHARE) return "candidata";
  return "nombre-de-libro";
}

export type Candidate = { phrase: string; agreement: number; bestPosition: number; words: number };

/**
 * Selecciona frases para verificar, mezclando dos sesgos opuestos:
 *  - `agreement`: aparece bajo muchas semillas → término amplio.
 *  - `specific`: frases de 3–4 palabras bien posicionadas → cola larga.
 *
 * Ordenar solo por acuerdo selecciona los términos de categoría (1.639 de 1.828
 * sugerencias salen de una sola semilla, así que el acuerdo premia lo genérico).
 */
export function selectPhrases(
  suggestions: { seed: string; value: string; position: number }[],
  opts: { total: number; maxTotal?: number; half?: number } = { total: 60 },
): Candidate[] {
  const maxTotal = opts.maxTotal ?? 2000;
  const byPhrase = new Map<string, { phrase: string; seeds: Set<string>; bestPosition: number }>();

  for (const s of suggestions) {
    const raw = String(s.value ?? "").trim();
    if (!raw) continue;
    const key = normalize(raw);
    const words = key.split(" ").filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    if (words.some((w) => /^\d{4}$/.test(w))) continue;
    if (/best ?sellers?/.test(key)) continue;
    if (looksLikeProduct(key)) continue;
    const entry = byPhrase.get(key) ?? { phrase: raw, seeds: new Set<string>(), bestPosition: 99 };
    entry.seeds.add(String(s.seed ?? ""));
    entry.bestPosition = Math.min(entry.bestPosition, Number(s.position ?? 99));
    byPhrase.set(key, entry);
  }

  const list: Candidate[] = [...byPhrase.values()].map((e) => ({
    phrase: e.phrase,
    agreement: e.seeds.size,
    bestPosition: e.bestPosition,
    words: normalize(e.phrase).split(" ").filter(Boolean).length,
  }));

  const half = Math.max(1, Math.floor((opts.half ?? opts.total) / 2));
  const broad = [...list]
    .sort((a, b) => b.agreement - a.agreement || a.bestPosition - b.bestPosition)
    .slice(0, half);
  const deep = [...list]
    .sort((a, b) => b.words - a.words || a.bestPosition - b.bestPosition || b.agreement - a.agreement)
    .slice(0, opts.total - half);

  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of [...broad, ...deep]) {
    const k = normalize(c.phrase);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  void maxTotal;
  return out;
}
