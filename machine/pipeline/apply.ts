#!/usr/bin/env bun
/**
 * E4 — aplica las cuatro compuertas a una captura real y escribe el brief.
 *
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/apply.ts --keyword "rabbit care"
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/apply.ts --keyword "rabbit care" --json
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/apply.ts --keyword "rabbit care" --write
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/apply.ts --fixture test/fixtures/rabbit-care.json
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/apply.ts --list
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/apply.ts --all --out Lab/Departamento-de-Investigacion/corridas
 *
 * Lee de la base de kdp-extension-chromium. No toca Amazon y no gasta cupo.
 * Por defecto NO escribe: el brief se escribe solo con --write.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { PhraseInput, Row } from "./types";
import { evaluate } from "./gates";
import { loadCriteria } from "./criteria";
import { renderAnalysis } from "./render";
import { parseTotal } from "./total";
import { DB_PATH, CORRIDAS } from "./paths";

const HERE = dirname(new URL(import.meta.url).pathname);
const DEFAULT_DB = DB_PATH;
const DEFAULT_OUT = CORRIDAS;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function slug(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

type DbRow = {
  asin: string | null;
  position: number | null;
  title: string | null;
  subtitle: string | null;
  bsr_overall: number | null;
  estimate_source: string | null;
  pub_date: string | null;
  reviews: number | null;
  price: number | null;
  pages: number | null;
  sponsored: number | null;
};

export function fromDb(dbPath: string, keyword: string): PhraseInput | null {
  if (!existsSync(dbPath)) throw new Error(`No existe la base: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });

  const dates = db
    .query(`select substr(created_at,1,10) d, count(*) n from runs
            where keyword = ? and kind = 'search' group by d order by d desc limit 1`)
    .all(keyword) as { d: string; n: number }[];
  if (!dates.length) return null;
  const date = dates[0].d;

  // Última corrida por página, dentro de la fecha elegida.
  const pages = db
    .query(
      `select page, id, total_results, total_results_is_over, currency, created_at
       from runs
       where keyword = ? and kind = 'search' and substr(created_at,1,10) = ?
       order by page asc, created_at asc`,
    )
    .all(keyword, date) as {
    page: number | null;
    id: number;
    total_results: number | null;
    total_results_is_over: number | null;
    currency: string | null;
    created_at: string;
  }[];
  if (!pages.length) return null;

  const latestByPage = new Map<number, (typeof pages)[number]>();
  for (const p of pages) latestByPage.set(p.page ?? 1, p);

  const runIds = [...latestByPage.values()].map((p) => p.id);
  const placeholders = runIds.map(() => "?").join(",");
  const raw = db
    .query(
      `select asin, position, title, subtitle, bsr_overall, estimate_source, pub_date, reviews, price, pages, sponsored
       from items where run_id in (${placeholders})`,
    )
    .all(...runIds) as DbRow[];

  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const [, p] of [...latestByPage.entries()].sort((a, b) => a[0] - b[0])) {
    const items = raw
      .filter((r) => r.position != null)
      .sort((a, b) => (a.position as number) - (b.position as number));
    for (const r of items) {
      const key = r.asin ?? `${p.page}-${r.position}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        asin: r.asin,
        position: ((p.page ?? 1) - 1) * 16 + (r.position as number),
        title: r.title,
        subtitle: r.subtitle,
        // Un libro marcado 'sin-bsr' no tiene ranking porque no vendió: se le asigna
      // la peor banda en vez de contarlo como dato faltante.
      bsr: r.bsr_overall ?? (r.estimate_source === "sin-bsr" ? 5_000_000 : null),
        pubDate: r.pub_date,
        reviews: r.reviews,
        price: r.price,
        pages: r.pages,
        sponsored: !!r.sponsored,
      });
    }
  }

  const first = latestByPage.get(1) ?? pages[0];
  const withTotal = [...latestByPage.values()]
    .sort((a, b) => (a.page ?? 1) - (b.page ?? 1))
    .find((p) => p.total_results != null);
  const textRow = db
    .query(
      `select total_results_text t from runs
       where keyword = ? and kind = 'search' and substr(created_at,1,10) = ? and total_results_text is not null
       order by page asc, created_at desc limit 1`,
    )
    .get(keyword, date) as { t: string } | null;
  const parsed = parseTotal(textRow?.t ?? null);

  db.close();
  return {
    keyword,
    totalResults: withTotal?.total_results ?? parsed.total,
    totalIsOver: !!(withTotal?.total_results_is_over) || parsed.isOver,
    currency: first.currency,
    capturedAt: `${date}T00:00:00.000Z`,
    rows,
  };
}

function listKeywords(dbPath: string): string[] {
  if (!existsSync(dbPath)) throw new Error(`No existe la base: ${dbPath}`);
  const db = new Database(dbPath, { readonly: true });
  const out = db
    .query(`select r.keyword, count(*) n from items i join runs r on r.id = i.run_id
            where r.keyword is not null and r.kind = 'search' group by r.keyword order by n desc`)
    .all() as { keyword: string; n: number }[];
  db.close();
  return out.map((r) => `${r.keyword} (${r.n})`);
}

export function runOne(input: PhraseInput, outRoot: string | null): ReturnType<typeof evaluate> {
  const ev = evaluate(input, loadCriteria());
  if (outRoot) {
    const day = input.capturedAt.slice(0, 10);
    const dir = join(outRoot, `${day}-${slug(input.keyword)}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "analisis.md"), renderAnalysis(ev, input.rows));
    writeFileSync(join(dir, "crudo.json"), JSON.stringify(input, null, 2));
    writeFileSync(join(dir, "evaluacion.json"), JSON.stringify(ev, null, 2));
  }
  return ev;
}

function printLine(ev: ReturnType<typeof evaluate>) {
  const fails = ev.gates.filter((g) => !g.pass).map((g) => g.id);
  console.log(
    `${ev.keyword.padEnd(38)} ${ev.verdict.padEnd(17)} cob ${String(ev.coverage).padEnd(4)} masa ${String(ev.mass.mid).padEnd(6)} ${fails.length ? "falla " + fails.join(",") : "pasa"}`,
  );
}

function printMd(ev: ReturnType<typeof evaluate>) {
  const fails = ev.gates.filter((g) => !g.pass).map((g) => g.id).join(", ") || "—";
  console.log(
    `| ${ev.keyword} | ${ev.verdict} | ${ev.totalResults ?? "—"} | ${ev.mass.min}–${ev.mass.max} | ${ev.coverage} | ${fails} |`,
  );
}

if (import.meta.main) {
  const dbPath = arg("db") ?? DEFAULT_DB;
  const outArg = arg("out");
  // Solo escribe con --write explícito. --json, --json-only y --md son de lectura.
  // --no-write gana si se pasan los dos, para que el modo seguro no dependa del orden.
  const write = has("write") && !has("no-write");
  const outRoot = write ? (outArg ? resolve(outArg) : DEFAULT_OUT) : null;

  if (has("list")) {
    for (const k of listKeywords(dbPath)) console.log(k);
    process.exit(0);
  }

  const fixture = arg("fixture");
  if (fixture) {
    const input = JSON.parse(readFileSync(fixture, "utf8")) as PhraseInput;
    const ev = runOne(input, outRoot);
    console.log(has("json") ? JSON.stringify(ev, null, 2) : "");
    printLine(ev);
    process.exit(0);
  }

  const keyword = arg("keyword");
  if (has("all")) {
    const kw = listKeywords(dbPath).map((s) => s.replace(/ \(\d+\)$/, ""));
    const results = [];
    for (const k of kw) {
      const input = fromDb(dbPath, k);
      if (!input) continue;
      results.push(runOne(input, outRoot));
    }
    results.sort((a, b) => b.mass.mid - a.mass.mid);
    if (has("md")) {
      console.log("| Frase | Veredicto | Resultados | Masa u/día | Cob. | Compuertas que fallan |");
      console.log("|---|---|---|---|---|---|");
      for (const ev of results) printMd(ev);
    } else {
      for (const ev of results) printLine(ev);
    }
    process.exit(0);
  }

  if (!keyword) {
    console.error('Uso: bun run apply.ts --keyword "frase" [--json] [--json-only] [--md] [--write] | --list | --all');
    process.exit(1);
  }
  const input = fromDb(dbPath, keyword);
  if (!input) {
    console.error(`Sin captura para "${keyword}" en ${dbPath}`);
    process.exit(2);
  }
  const ev = runOne(input, outRoot);
  if (has("json-only")) console.log(JSON.stringify(ev));
  else if (has("json")) console.log(JSON.stringify(ev, null, 2));
  else if (has("md")) {
    console.log("| Frase | Veredicto | Resultados | Masa u/día | Cob. | Compuertas que fallan |");
    console.log("|---|---|---|---|---|---|");
    printMd(ev);
  } else printLine(ev);
  if (outRoot) console.log(`brief: ${join(outRoot, `${input.capturedAt.slice(0, 10)}-${slug(keyword)}`, "analisis.md")}`);
}
