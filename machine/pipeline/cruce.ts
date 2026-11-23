#!/usr/bin/env bun
/**
 * Cruce coherente: búsquedas reales × resultados de Amazon.
 *
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/cruce.ts --auto Lab/Departamento-de-Investigacion/Data/amazon/autocomplete.json --top 60
 *
 * Toma las frases que la gente escribe (autocompletar), abre la búsqueda de cada una
 * acotada a Books, y cruza tres cosas sobre esa misma carga:
 *   - `total`: cuántos resultados hay (compuerta del mentor, < 2000);
 *   - `titleHits`: cuántos de los 16 títulos contienen la frase (¿describe contenido
 *     o es el nombre de un solo libro?);
 *   - `agreement`: de cuántas semillas distintas salió (señal de búsqueda repetida).
 *
 * Cuesta 1 carga de página por frase. No usa KDPTop.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseTotal } from "./total";
import { fetchAndExtract, pause } from "./http";
import { normalize } from "./ngram";
import { classify, looksLikeProduct, titleHits } from "./classify";
import { AMAZON, AUTOCOMPLETE } from "./paths";

const HERE = dirname(new URL(import.meta.url).pathname);
const CRUDO = AMAZON;


function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (n: string) => process.argv.includes(`--${n}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));



/** Selección: frases que se repiten entre semillas, de 2 a 4 palabras, sin años. */
function pickPhrases(autoFile: string, top: number, mode: string) {
  const data = JSON.parse(readFileSync(autoFile, "utf8"));
  const byPhrase = new Map<string, { phrase: string; seeds: Set<string>; bestPosition: number }>();

  for (const s of data.suggestions ?? []) {
    const raw = String(s.value ?? "").trim();
    if (!raw) continue;
    const key = normalize(raw);
    const words = key.split(" ").filter(Boolean);
    if (words.length < 2 || words.length > 4) continue;
    // Fuera años y frases que piden "los más vendidos": no son temas.
    if (words.some((w) => /^\d{4}$/.test(w))) continue;
    if (/best ?sellers?/.test(key)) continue;
    if (looksLikeProduct(key)) continue;
    const entry = byPhrase.get(key) ?? { phrase: raw, seeds: new Set<string>(), bestPosition: 99 };
    entry.seeds.add(String(s.seed ?? ""));
    entry.bestPosition = Math.min(entry.bestPosition, Number(s.position ?? 99));
    byPhrase.set(key, entry);
  }

  const list = [...byPhrase.values()].map((e) => ({
    phrase: e.phrase,
    agreement: e.seeds.size,
    bestPosition: e.bestPosition,
    words: normalize(e.phrase).split(" ").filter(Boolean).length,
  }));

  // `agreement` (viejo) premia lo genérico: 1.639 de 1.828 frases salen de una sola
  // semilla, así que ordenar por acuerdo selecciona los términos de categoría.
  // `specific` prefiere frases largas y bien posicionadas en el autocompletar.
  const sorted =
    mode === "agreement"
      ? list.sort((a, b) => b.agreement - a.agreement || a.bestPosition - b.bestPosition || a.phrase.localeCompare(b.phrase))
      : list.sort(
          (a, b) =>
            b.words - a.words ||
            a.bestPosition - b.bestPosition ||
            b.agreement - a.agreement ||
            a.phrase.localeCompare(b.phrase),
        );

  return sorted.slice(0, top);
}

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function main() {
  const autoFile = arg("auto") ?? join(AUTOCOMPLETE, "autocomplete.json");
  if (!existsSync(autoFile)) {
    console.error(`Falta ${autoFile}. Correr autocomplete.ts primero.`);
    process.exit(1);
  }
  const top = Number(arg("top") ?? 60);
  const maxTotal = Number(arg("max") ?? 2000);
  const pauseMs = Number(arg("pause") ?? 1500);

  const mode = arg("mode") ?? "specific";
  const candidates = pickPhrases(autoFile, top, mode);
  console.log(`candidatas: ${candidates.length} · modo ${mode} · pausa ${pauseMs} ms`);

  const rows: any[] = [];
  let stopped: string | null = null;

  for (const c of candidates) {
    const url = `https://www.amazon.com/s?k=${encodeURIComponent(c.phrase)}&i=stripbooks&page=1`;
    const { data, blocked } = await fetchAndExtract(url);
    if (blocked) {
      stopped = blocked;
      break;
    }
    await pause(1200);
        const parsed = parseTotal(data?.totalResultsText ?? null);
    const items = (data?.items ?? []).slice(0, 16);
    const titles = items.map((i: any) => String(i.title ?? ""));
    // Señal de libro: Amazon muestra autor en libros y no en productos.
    const withAuthor = items.filter((i: any) => i.author && String(i.author).trim().length > 2).length;
    const bookShare = items.length ? Math.round((withAuthor / items.length) * 100) / 100 : 0;
    const reviews = (data?.items ?? []).slice(0, 10).map((i: any) => Number(i.reviews)).filter((n: number) => Number.isFinite(n));

    const hits = titleHits(c.phrase, titles);
    const pass = parsed.total != null && parsed.total < maxTotal;
    // Un nombre de libro aparece en 1 o 2 títulos; un tema, en varios.
    const artifact = hits <= 2;
    const row = {
      phrase: c.phrase,
      agreement: c.agreement,
      bestPosition: c.bestPosition,
      total: parsed.total,
      isOver: parsed.isOver,
      titleHits: hits,
      sample: titles.length,
      medianReviews: median(reviews),
      bookShare,
      sampleTitles: titles.slice(0, 5),
      passTotal: pass,
      likelyBookTitle: artifact,
      verdict: classify({
        total: parsed.total,
        maxTotal,
        bookShare,
        titleHits: hits,
        sample: titles.length,
      }),
    };
    rows.push(row);
    console.log(
      `${row.verdict.padEnd(15)} ${String(row.total ?? "?").padStart(7)} res · ${String(hits).padStart(2)}/${titles.length} títulos · libros ${Math.round(bookShare * 100)}% · acuerdo ${row.agreement}  ${c.phrase}`,
    );
    if (c !== candidates[candidates.length - 1]) await pause(pauseMs + Math.floor(Math.random() * 4000));
  }


  rows.sort((a, b) => {
    const rank = (r: any) =>
      r.verdict === "candidata" ? 0 : r.verdict === "nombre-de-libro" ? 1 : r.verdict === "no-es-libro" ? 2 : 3;
    return rank(a) - rank(b) || (a.total ?? 1e9) - (b.total ?? 1e9) || b.agreement - a.agreement;
  });

  mkdirSync(CRUDO, { recursive: true });
  const out = join(CRUDO, "cruce.json");
  writeFileSync(out, JSON.stringify({ createdAt: new Date().toISOString(), maxTotal, stopped, rows }, null, 2));

  const cand = rows.filter((r) => r.verdict === "candidata");
  console.log(`\n=== candidatas: ${cand.length} de ${rows.length} ===`);
  for (const r of cand.slice(0, 20)) {
    console.log(`  ${String(r.total).padStart(5)} res · ${r.titleHits}/16 títulos · acuerdo ${r.agreement} · reseñas med ${r.medianReviews ?? "—"}  ${r.phrase}`);
  }
  if (stopped) console.log(`CORTADO: ${stopped}`);
  console.log(`archivo: ${out}`);
}

await main();
