/**
 * Homogeneidad del estante: ¿los títulos de un nodo comparten tema entre sí?
 *
 * Mide la masa temática del estante, no su parecido con el nombre de la categoría.
 * Ver decisiones/2026-11-21-homogeneidad-estante.md.
 *
 * Método:
 *  1. se toma el top N de títulos del nodo (N = limit, por defecto 50);
 *  2. se cuentan las palabras de contenido que aparecen en al menos `minDocs` títulos;
 *  3. se descartan palabras de formato/producto (lista BLOCK) y años;
 *  4. las `themeSize` palabras más comunes son el "tema dominante";
 *  5. `coverage` = proporción de títulos que contiene al menos una de ellas;
 *  6. `coverage` mide si hay tema; `theme` se reporta para que una persona vea si el tema
 *     es coherente con el lector que buscamos.
 *
 * Advertencia medida: `coverage` **no distingue** un estante de un tema que no es el
 * nuestro. Cinco nodos reales con `limit=50, themeSize=6, minDocs=3` dieron:
 *   polar 0.66 (tema: antarctica, arctic, ice)   ← estante sano
 *   aging 0.52 (tema: dementia, alzheimer)       ← estante sano
 *   astro 0.44 (tema: space, universe, cosmic)   ← estante sano
 *   crafts 0.36 (tema: christmas, teen, relaxation) ← estacional
 * Un umbral bajo deja pasar casi todo y uno alto descarta estantes sanos. Por eso el
 * valor por defecto (0) NO bloquea: el filtro informa y el criterio de tema queda humano.
 */
import { tokenize } from "./ngram";

const NOISE = new Set([
  "the", "and", "for", "with", "from", "your", "you", "how", "what", "why", "that", "this",
  "a", "an", "of", "to", "in", "on", "at", "as", "is", "are", "be", "by", "or", "it", "s",
  "all", "any", "out", "into", "more", "most", "new", "best", "own", "can", "not", "his",
  "her", "they", "them", "was", "were", "has", "have", "had", "but", "one", "two", "very",
]);

/**
 * Palabras que describen el objeto o su formato, no el tema. Se excluyen del tema
 * dominante porque aparecen en casi todos los estantes y no distinguen nada.
 */
const BLOCK = new Set([
  "print", "large", "giant", "super", "big", "huge", "small",
  "senior", "seniors", "elderly", "adult", "adults", "kid", "kids", "children", "child",
  "gift", "gifts", "present", "presents",
  "guide", "guides", "handbook", "manual", "volume", "vol", "edition", "version", "series",
  "step", "steps", "easy", "simple", "beginner", "beginners", "intro", "introduction",
  "app", "apps", "software", "device", "devices",
  "story", "stories", "tale", "tales", "novel", "fiction",
  "who", "world", "worlds", "life", "lives", "book", "books", "author", "authors",
  "illustrated", "color", "coloring", "colouring", "picture", "pictures", "photo", "photos",
  "complete", "essential", "essentials", "ultimate", "practical", "modern", "great", "little",
  "first", "last", "every", "everything", "perfect", "amazing", "wonderful", "beautiful",
  "true", "real", "inside", "beyond", "after", "before", "about", "through", "over", "under",
  "work", "works", "made", "make", "making", "help", "helps", "tips", "ideas", "things",
]);

export type Homogeneity = {
  /** proporción de títulos que contienen al menos una palabra del tema dominante */
  coverage: number;
  matches: number;
  total: number;
  threshold: number;
  pass: boolean;
  /** palabras más repetidas del estante, después del bloqueo */
  theme: string[];
  /** cuántas palabras distintas superaron el mínimo de frecuencia */
  recurring: number;
};

/**
 * Valor por defecto: 0, es decir, **no bloquea**.
 * Se midió que ningún umbral separa estantes buenos de malos: ver la cabecera del archivo.
 */
export const DEFAULT_MIN_COVERAGE = 0;

export function measureHomogeneity(
  titles: string[],
  opts: { threshold?: number; limit?: number; minDocs?: number; themeSize?: number } = {},
): Homogeneity {
  const threshold = opts.threshold ?? DEFAULT_MIN_COVERAGE;
  const limit = opts.limit ?? 50;
  const minDocs = opts.minDocs ?? 3;
  const themeSize = opts.themeSize ?? 6;

  const sample = titles.filter((t) => t && t.trim().length > 2).slice(0, limit);

  if (!sample.length) {
    // Sin títulos no hay estante que evaluar: nunca habilita la minería.
    return { coverage: 0, matches: 0, total: 0, threshold, pass: false, theme: [], recurring: 0 };
  }

  const sets = sample.map((t) => {
    const w = new Set<string>();
    for (const tok of tokenize(t)) {
      if (tok.norm.length > 2 && !NOISE.has(tok.norm) && !/^\d+$/.test(tok.norm)) w.add(tok.norm);
    }
    return w;
  });

  const df = new Map<string, number>();
  for (const s of sets) for (const w of s) df.set(w, (df.get(w) ?? 0) + 1);

  const frequent = [...df.entries()].filter(([w, n]) => n >= minDocs && !BLOCK.has(w));
  frequent.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const theme = frequent.slice(0, themeSize).map(([w]) => w);

  const matches = theme.length ? sets.filter((s) => theme.some((w) => s.has(w))).length : 0;
  const coverage = Math.round((matches / sets.length) * 1000) / 1000;

  return {
    coverage,
    matches,
    total: sets.length,
    threshold,
    pass: coverage >= threshold,
    theme,
    recurring: frequent.length,
  };
}
