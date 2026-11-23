#!/usr/bin/env bun
/**
 * Captura de lo que la gente escribe: autocompletar de Amazon.
 *
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/autocomplete.ts --seeds auto --out Lab/Departamento-de-Investigacion/Data/amazon/autocomplete.json
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/autocomplete.ts --seeds-file seeds.txt
 *
 * Pide directo al endpoint de sugerencias de Amazon (JSON, sin navegador, sin cuenta).
 * `alias=stripbooks` acota a libros. Cada semilla devuelve hasta 11 sugerencias.
 *
 * Semillas automáticas: nombres de las categorías del árbol + los n-gramas frecuentes
 * de los títulos capturados. Así se cruzan dos fuentes: lo que Amazon llama al estante
 * y lo que dicen los libros que venden.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AMAZON, AUTOCOMPLETE } from "./paths";

const HERE = dirname(new URL(import.meta.url).pathname);

const AUTO = AUTOCOMPLETE;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (n: string) => process.argv.includes(`--${n}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ENDPOINT = "https://completion.amazon.com/api/2017/suggestions";
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export type Suggestion = { seed: string; value: string; position: number };

export async function fetchSuggestions(prefix: string, limit = 11): Promise<string[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("prefix", prefix);
  url.searchParams.set("suggestion-type", "KEYWORD");
  url.searchParams.set("alias", "stripbooks");
  url.searchParams.set("site-variant", "desktop");
  url.searchParams.set("version", "3");
  url.searchParams.set("event", "onKeyPress");
  url.searchParams.set("lop", "en_US");
  url.searchParams.set("mid", "ATVPDKIKX0DER");
  url.searchParams.set("plain-mid", "1");
  url.searchParams.set("client-info", "amazon-search-ui");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "user-agent": UA, accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (res.status === 429 || res.status >= 500) {
        await sleep(800 * (attempt + 1));
        continue;
      }
      if (!res.ok) return [];
      const data: any = await res.json();
      const list = Array.isArray(data?.suggestions) ? data.suggestions : [];
      return list.map((s: any) => String(s?.value ?? "").trim()).filter(Boolean);
    } catch {
      await sleep(600 * (attempt + 1));
    }
  }
  return [];
}

function autoSeeds(): string[] {
  const seeds = new Set<string>();

  const tree = join(AMAZON, "arbol-books.json");
  if (existsSync(tree)) {
    const data = JSON.parse(readFileSync(tree, "utf8"));
    for (const node of data.nodes ?? []) {
      if (node.name) seeds.add(String(node.name));
      for (const child of node.children ?? []) if (child.name) seeds.add(String(child.name));
    }
  }

  for (const f of Array.from(new Bun.Glob("phrases-*.json").scanSync({ cwd: AMAZON }))) {
    try {
      const data = JSON.parse(readFileSync(join(AMAZON, f), "utf8"));
      for (const p of (data.phrases ?? []).slice(0, 25)) if (p.phrase) seeds.add(String(p.phrase));
    } catch {}
  }

  return [...seeds]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length >= 4 && s.length <= 60)
    .filter((s) => !/&|,/.test(s) || s.split(" ").length <= 4);
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: size }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  });
  await Promise.all(workers);
}

if (import.meta.main) {
  const seedsFile = arg("seeds-file");
  const seeds = seedsFile
    ? readFileSync(seedsFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean)
    : autoSeeds();

  const maxSeeds = Number(arg("max-seeds") ?? seeds.length);
  const picked = seeds.slice(0, maxSeeds);
  const limit = Number(arg("limit") ?? 11);
  const concurrency = Number(arg("concurrency") ?? 4);

  console.log(`semillas: ${picked.length} · concurrencia ${concurrency}`);

  const out: Suggestion[] = [];
  let done = 0;
  let failed = 0;

  await pool(picked, concurrency, async (seed) => {
    const values = await fetchSuggestions(seed, limit);
    if (!values.length) failed++;
    values.forEach((value, position) => out.push({ seed, value, position }));
    done++;
    if (done % 50 === 0) console.log(`  ${done}/${picked.length} semillas · ${out.length} sugerencias`);
    await sleep(120 + Math.floor(Math.random() * 120));
  });

  // Expansión por alfabeto sobre las semillas más prometedoras (opcional).
  if (has("expand")) {
    const alphabet = "abcdefghijklmnopqrstuvwxyz".split("");
    const targets = picked.slice(0, Number(arg("expand-top") ?? 40));
    console.log(`expansión alfabética: ${targets.length} semillas × 26`);
    for (const seed of targets) {
      for (const letter of alphabet) {
        const values = await fetchSuggestions(`${seed} ${letter}`, limit);
        values.forEach((value, position) => out.push({ seed: `${seed} ${letter}`, value, position }));
        await sleep(90);
      }
    }
  }

  mkdirSync(AUTO, { recursive: true });
  const file = arg("out") ?? join(AUTO, "autocomplete.json");
  writeFileSync(
    file,
    JSON.stringify({ createdAt: new Date().toISOString(), seeds: picked.length, failed, suggestions: out }, null, 2),
  );

  const unique = new Set(out.map((s) => s.value.toLowerCase()));
  console.log(`sugerencias: ${out.length} · únicas: ${unique.size} · semillas sin respuesta: ${failed}`);
  console.log(`archivo: ${file}`);
}
