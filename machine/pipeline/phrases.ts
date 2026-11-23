#!/usr/bin/env bun
/**
 * Puente E1 → E2: toma una captura de bestsellers y devuelve las frases observadas.
 *
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/phrases.ts Lab/Departamento-de-Investigacion/Data/amazon/crafts.json
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/phrases.ts <captura.json> --limit 40 --commands
 *
 * No toca la red. Escribe la lista en corridas/_crudo/phrases-<label>.json
 * y, con --commands, imprime las líneas de E3 listas para pegar.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync as _existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { extractNgramsAudit, normalize } from "./ngram";
import { AMAZON } from "./paths";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

export type CapturedTitle = { title?: string | null; subtitle?: string | null };

const readWords = (file: string) => new Set(
  readFileSync(new URL(file, import.meta.url).pathname, "utf8").split("\n").filter(Boolean),
);
const ENGLISH_WORDS = readWords("./common-words.txt");
const CATEGORY_WORDS = _existsSync(new URL("./category-words.txt", import.meta.url).pathname)
  ? readWords("./category-words.txt")
  : ENGLISH_WORDS;
const FUNCTION_WORDS = new Set("a an and are as at be by for from in into is it of on or the to with".split(" "));

/** Señal léxica, nunca una compuerta ni motivo para ocultar la frase. */
export function isCommonWord(word: string): boolean {
  return ENGLISH_WORDS.has(word.toLowerCase());
}

function titlesMatchingPhrase(phrase: string, titles: string[]): string[] {
  const words = normalize(phrase).split(" ").filter(Boolean);
  return titles.filter((title) => {
    const normalizedTitle = ` ${normalize(title)} `;
    return words.every((word) => normalizedTitle.includes(` ${word} `));
  });
}

export function titlesFromCapture(data: any): string[] {
  const pages = Array.isArray(data?.pages) ? data.pages : [];
  const out: string[] = [];
  for (const p of pages) {
    for (const it of p?.itemsData ?? []) {
      const t = [it.title, it.subtitle].filter(Boolean).join(" ");
      if (t && t.length > 3) out.push(t);
    }
  }
  return out;
}

export function buildPhrases(capture: unknown, opts: { minBooks?: number; minWords?: number; maxWords?: number; limit?: number } = {}) {
  const titles = titlesFromCapture(capture);
  const extractOptions = {
    minBooks: opts.minBooks ?? 2,
    minWords: opts.minWords ?? 2,
    maxWords: opts.maxWords ?? 4,
  };
  const audit = extractNgramsAudit(titles, extractOptions);
  const ngrams = audit.accepted;
  // La frecuencia entre categorías es una señal para el agente, no una compuerta.
  // No descartar nombres propios aquí: el agente necesita ver la frase y evidencia
  // contextual para decidir si es tema, autor, marca o título.
  const phrases = ngrams.slice(0, opts.limit ?? 60).map((n) => {
    const evidence = titlesMatchingPhrase(n.phrase, titles);
    const words = n.phrase.toLowerCase().split(" ");
    const unusualWords = words.filter((word) => !isCommonWord(word));
    const rareCategoryWords = words.filter((word) =>
      !FUNCTION_WORDS.has(word) && ENGLISH_WORDS.has(word) && !CATEGORY_WORDS.has(word),
    );
    return {
      ...n,
      lexicalSignal: unusualWords.length ? "palabra fuera del diccionario" : "palabras del diccionario",
      unusualWords,
      rareCategoryWords,
      evidenceTitles: evidence.slice(0, 4),
    };
  });
  const reviewExcluded = audit.excluded.slice(0, opts.limit ?? 60).map((n) => ({
    ...n,
    evidenceTitles: titlesMatchingPhrase(n.phrase, titles).slice(0, 4),
  }));
  return { titles, phrases, reviewExcluded };
}

if (import.meta.main) {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) {
    console.error('Uso: phrases.ts <captura.json> [--min-books 2] [--min-words 2] [--max-words 4] [--limit 40] [--commands]');
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(file, "utf8"));
  const titles = titlesFromCapture(data);
  const extractOptions = {
    minBooks: Number(arg("min-books") ?? 2),
    minWords: Number(arg("min-words") ?? 2),
    maxWords: Number(arg("max-words") ?? 4),
  };
  const audit = extractNgramsAudit(titles, extractOptions);
  const ngrams = audit.accepted;
  const limit = Number(arg("limit") ?? 60);
  const top = ngrams.slice(0, limit).map((n) => {
    const evidenceTitles = titlesMatchingPhrase(n.phrase, titles).slice(0, 4);
    const words = n.phrase.toLowerCase().split(" ");
    const unusualWords = words.filter((word) => !isCommonWord(word));
    const rareCategoryWords = words.filter((word) =>
      !FUNCTION_WORDS.has(word) && ENGLISH_WORDS.has(word) && !CATEGORY_WORDS.has(word),
    );
    return {
      ...n,
      lexicalSignal: unusualWords.length ? "palabra fuera del diccionario" : "palabras del diccionario",
      unusualWords,
      rareCategoryWords,
      evidenceTitles,
    };
  });
  const reviewExcluded = audit.excluded.slice(0, limit).map((n) => ({
    ...n,
    evidenceTitles: titlesMatchingPhrase(n.phrase, titles).slice(0, 4),
  }));

  const label = arg("label") ?? basename(file, ".json");
  const outDir = AMAZON;
  mkdirSync(outDir, { recursive: true });
  const outFile = join(outDir, `phrases-${label}.json`);
  writeFileSync(
    outFile,
    JSON.stringify({
      source: file,
      titles: titles.length,
      generated: ngrams.length,
      note: "Las restricciones del extractor son criterios técnicos. Los n-gramas afectados se conservan aparte con el motivo y títulos fuente para revisión del agente.",
      phrases: top,
      reviewExcluded,
    }, null, 2),
  );

  console.log(`títulos: ${titles.length} · candidatas según reglas: ${ngrams.length} · reglas ocultarían: ${audit.excluded.length} · mostradas: ${top.length}`);
  console.log(`archivo: ${outFile}\n`);
  for (const n of top) {
    const rare = n.rareCategoryWords.length ? ` · infrecuentes en estantes: ${n.rareCategoryWords.join(", ")}` : "";
    const unknown = n.unusualWords.length ? ` · fuera del diccionario: ${n.unusualWords.join(", ")}` : "";
    console.log(`${String(n.books).padStart(3)} libros  ${n.phrase}  [${n.lexicalSignal}${rare}${unknown}]`);
    for (const title of n.evidenceTitles) console.log(`      ↳ ${title}`);
  }
  console.log(`\nN-gramas ocultos por reglas técnicas (muestra ${reviewExcluded.length} de ${audit.excluded.length}):`);
  for (const n of reviewExcluded.slice(0, 12)) {
    console.log(`${String(n.books).padStart(3)} libros  ${n.phrase}  [regla: ${n.exclusionReasons.join(", ")}]`);
    for (const title of n.evidenceTitles.slice(0, 2)) console.log(`      ↳ ${title}`);
  }

  if (has("commands")) {
    console.log("\n# E3 — una línea por frase, en orden de evidencia:");
    for (const n of top) {
      console.log(`bun run collect -- "${n.phrase}" --pages 1 --delay 25000 --jitter 7000`);
    }
  }
}
