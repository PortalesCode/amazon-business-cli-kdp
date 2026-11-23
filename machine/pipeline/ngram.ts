/**
 * E2 — extracción de frases observadas.
 * Toma títulos y subtítulos de libros que venden y devuelve n-gramas repetidos.
 * Nada de esto toca la red: es lógica pura y testeable.
 *
 * Reglas:
 *  - se conserva la forma literal de la frase (así se buscó, así se mide);
 *  - se cuenta por forma normalizada (singular/plural, acentos) para no duplicar;
 *  - las stopwords y palabras de formato no pueden abrir ni cerrar un n-grama,
 *    pero sí pueden ir adentro: "mental exercises for dogs" es una frase real.
 */

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "with", "your", "my",
  "how", "what", "why", "when", "who", "that", "this", "it", "its", "is", "are", "be",
  "from", "by", "at", "as", "into", "about", "you", "we", "our", "their", "his", "her",
  "de", "del", "la", "el", "los", "las", "y", "o", "en", "con", "para", "por", "un", "una",
]);

// Palabras de formato: describen el objeto, no el tema. Nunca son un nicho.
const FORMAT_WORDS = new Set([
  "book", "books", "guide", "guides", "workbook", "journal", "planner", "logbook",
  "notebook", "edition", "paperback", "hardcover", "kindle", "ebook", "handbook",
  "manual", "vol", "volume", "series", "complete", "ultimate", "essential", "essentials",
  "beginner", "beginners", "new", "updated", "revised", "made", "easy",
  "libro", "libros", "guia", "cuaderno", "diario", "edicion",
]);

// Objetos y formatos de bajo contenido: si aparecen en cualquier posición, el
// n-grama no es un nicho. "day calendar" no es un tema, es un producto de temporada.
const BLOCK_ANY = new Set([
  "calendar", "calendars", "wall", "desk", "day", "sticker", "stickers",
  "coloring", "colouring", "paint", "sudoku", "crossword", "maze", "mazes",
  "puzzle", "puzzles", "word", "words", "search", "activity", "activities",
  // Formatos de impresión: describen el objeto, no el tema.
  "print", "large", "giant", "red", "letter", "comfort",
  // Ediciones y versiones de biblias.
  "kjv", "esv", "niv", "nkjv", "nasb", "bible", "bibles", "testament",
  "version", "holy", "scripture", "scriptures",
  // Editoriales, premios, colecciones y series infantiles.
  "national", "geographic", "award", "winner", "prize", "bestselling",
  "collection", "set", "boxed", "box",
  "magic", "house", "tree", "reader", "readers",
  // Aparato de libro.
  "index", "tables", "contents", "illustrated", "photographs",
]);

export type Ngram = {
  /** forma literal, tal como aparece en los títulos */
  phrase: string;
  words: number;
  /** cantidad de libros distintos que la usan */
  books: number;
  /** forma normalizada, para deduplicar */
  key: string;
};

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function singularize(word: string): string {
  if (word.length <= 3) return word;
  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("sses")) return word.slice(0, -2);
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us")) return word.slice(0, -1);
  return word;
}

type Tok = { lit: string; norm: string };

export function tokenize(text: string): Tok[] {
  return normalize(text)
    .split(" ")
    .filter((t) => t.length > 1)
    .map((t) => ({ lit: t, norm: singularize(t) }));
}

export type ExtractOptions = {
  minWords?: number;
  maxWords?: number;
  minBooks?: number;
};

export type AuditedNgram = Ngram & { exclusionReasons: string[] };

/** Devuelve también los n-gramas que las reglas tradicionales habrían ocultado. */
export function extractNgramsAudit(
  texts: string[],
  opts: ExtractOptions = {},
): { accepted: Ngram[]; excluded: AuditedNgram[] } {
  const minWords = opts.minWords ?? 2;
  const maxWords = opts.maxWords ?? 4;
  const minBooks = opts.minBooks ?? 2;

  const rejected = new Map<string, { phrase: string; books: Set<number>; words: number; reasons: Set<string> }>();

  texts.forEach((text, bookIdx) => {
    const toks = tokenize(text);
    for (let n = minWords; n <= maxWords; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const slice = toks.slice(i, i + n);
        const first = slice[0].norm;
        const last = slice[slice.length - 1].norm;
        const reasons = new Set<string>();
        if (STOPWORDS.has(first) || STOPWORDS.has(last)) reasons.add("stopword_boundary");
        if (FORMAT_WORDS.has(first) || FORMAT_WORDS.has(last)) reasons.add("format_boundary");
        if (slice.every((s) => FORMAT_WORDS.has(s.norm))) reasons.add("format_only");
        if (slice.some((s) => BLOCK_ANY.has(s.norm))) reasons.add("format_or_low_content_word");
        if (slice.some((s) => /^\d+$/.test(s.norm))) reasons.add("contains_number");
        if (reasons.size) {
          const key = slice.map((s) => s.norm).join(" ");
          const phrase = slice.map((s) => s.lit).join(" ");
          const prev = rejected.get(key);
          if (prev) {
            prev.books.add(bookIdx);
            for (const reason of reasons) prev.reasons.add(reason);
          } else {
            rejected.set(key, { phrase, books: new Set([bookIdx]), words: n, reasons });
          }
        }
      }
    }
  });

  const excluded = [...rejected.entries()]
    .map(([key, value]) => ({
      key,
      phrase: value.phrase,
      words: value.words,
      books: value.books.size,
      exclusionReasons: [...value.reasons].sort(),
    }))
    .filter((ngram) => ngram.books >= minBooks)
    .sort((a, b) => b.books - a.books || b.words - a.words);

  return {
    accepted: extractNgrams(texts, opts),
    excluded,
  };
}

export function extractNgrams(texts: string[], opts: ExtractOptions = {}): Ngram[] {
  const minWords = opts.minWords ?? 2;
  const maxWords = opts.maxWords ?? 4;
  const minBooks = opts.minBooks ?? 2;
  const hits = new Map<string, { phrase: string; books: Set<number>; words: number }>();
  texts.forEach((text, bookIdx) => {
    const toks = tokenize(text);
    for (let n = minWords; n <= maxWords; n++) {
      for (let i = 0; i + n <= toks.length; i++) {
        const slice = toks.slice(i, i + n);
        const first = slice[0].norm;
        const last = slice[slice.length - 1].norm;
        if (STOPWORDS.has(first) || FORMAT_WORDS.has(first)) continue;
        if (STOPWORDS.has(last) || FORMAT_WORDS.has(last)) continue;
        if (slice.every((s) => FORMAT_WORDS.has(s.norm))) continue;
        if (slice.some((s) => BLOCK_ANY.has(s.norm))) continue;
        if (slice.some((s) => /^\d+$/.test(s.norm))) continue;
        const key = slice.map((s) => s.norm).join(" ");
        const phrase = slice.map((s) => s.lit).join(" ");
        const prev = hits.get(key);
        if (prev) prev.books.add(bookIdx);
        else hits.set(key, { phrase, books: new Set([bookIdx]), words: n });
      }
    }
  });

  let out: Ngram[] = [...hits.entries()]
    .map(([key, v]) => ({ key, phrase: v.phrase, words: v.words, books: v.books.size }))
    .filter((n) => n.books >= minBooks);

  // Dedupe: si A está contenido en B con los mismos libros, A no agrega información.
  const redundant = new Set<string>();
  for (const big of out) {
    for (const small of out) {
      if (small.key === big.key || small.books !== big.books || small.words >= big.words) continue;
      if (` ${big.key} `.includes(` ${small.key} `)) redundant.add(small.key);
    }
  }
  out = out.filter((n) => !redundant.has(n.key));

  return out.sort((a, b) => b.books - a.books || b.words - a.words);
}
