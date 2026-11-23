#!/usr/bin/env bun
/**
 * Prefiltro gratuito por total de resultados (compuerta C1 del mentor, sin API).
 *
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/prefilter.ts --phrases Lab/Departamento-de-Investigacion/Data/amazon/phrases-astronomy.json
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/prefilter.ts --node 13439 --top 20
 *
 * Abre una búsqueda por frase (1 carga de página, sin KDPTop), lee el total de
 * resultados y descarta las que superan el umbral. Devuelve las sobrevivientes
 * ordenadas por número de resultados ascendente: las más chicas primero.
 *
 * Por qué las raras primero: medido con "solar system" (40.000 resultados, saturado),
 * las frases que más títulos comparten son los temas genéricos de la categoría.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseTotal } from "./total";
import { fetchAndExtract, pause } from "./http";
import { AMAZON } from "./paths";

const HERE = dirname(new URL(import.meta.url).pathname);
const CRUDO = AMAZON;


function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (n: string) => process.argv.includes(`--${n}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const listArg = arg("phrases");
  const node = arg("node");
  const max = Number(arg("max") ?? 2000);
  const top = Number(arg("top") ?? 20);
  const pauseMs = Number(arg("pause") ?? 1500);

  let phrases: { phrase: string; books: number }[] = [];
  if (listArg) {
    const data = JSON.parse(readFileSync(listArg, "utf8"));
    phrases = (data.phrases ?? []).slice(0, top);
  } else if (node) {
    console.error(`No hay --phrases y el nodo ${node} necesita su captura. Pasá --phrases.`);
    process.exit(1);
  } else {
    console.error(`Uso: prefilter.ts --phrases <phrases-*.json> [--top 20] [--max 2000] [--pause 12000]`);
    process.exit(1);
  }

  if (!phrases.length) {
    console.error("Sin frases para prefiltrear.");
    process.exit(1);
  }

  const results: any[] = [];
  let stopped: string | null = null;

  for (const p of phrases) {
    const url = `https://www.amazon.com/s?k=${encodeURIComponent(p.phrase)}&i=stripbooks&page=1`;
    const { data, blocked } = await fetchAndExtract(url);
    if (blocked) {
      stopped = blocked;
      break;
    }
    await pause(1500);
        const text = data?.totalResultsText ?? null;
    const parsed = parseTotal(text);
    const pass = parsed.total != null && parsed.total < max;
    results.push({ phrase: p.phrase, books: p.books, total: parsed.total, isOver: parsed.isOver, pass });
    console.log(
      `${pass ? "PASA " : "descart"} ${String(parsed.total ?? "?").padStart(7)}  ${p.phrase}`,
    );
    if (p !== phrases[phrases.length - 1]) await pause(pauseMs + Math.floor(Math.random() * 3000));
  }


  const survivors = results.filter((r) => r.pass).sort((a, b) => a.total - b.total);
  mkdirSync(CRUDO, { recursive: true });
  const file = join(CRUDO, `prefilter-${slug(listArg ?? String(node))}.json`);
  writeFileSync(file, JSON.stringify({ createdAt: new Date().toISOString(), max, results, survivors, stopped }, null, 2));

  console.log(`\nsobrevivientes: ${survivors.length} de ${results.length} (umbral < ${max})`);
  for (const s of survivors) console.log(`  ${String(s.total).padStart(6)}  ${s.phrase}`);
  if (stopped) console.log(`CORTADO: ${stopped}`);
  console.log(`archivo: ${file}`);
}

await main();
