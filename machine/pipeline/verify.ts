#!/usr/bin/env bun
/**
 * E3/E4 para frases seleccionadas por el agente tras revisar la salida E2.
 *
 * Input: JSON array ["rabbit care"] o objeto { phrases: [{ phrase, reason? }] }.
 * Captura Books, enriquece BSR y emite evidencia estructurada a stdout.
 * No clasifica por nombres propios/titleHits: esos datos son contexto para el agente.
 */
import { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DB_PATH } from "./paths";
import { fromDb } from "./apply";
import { evaluate } from "./gates";
import { loadCriteria } from "./criteria";
import { titleHits, bookShareOf } from "./classify";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

type Selected = { phrase: string; reason?: string };

export function loadPhrases(file: string): Selected[] {
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  const values = Array.isArray(parsed) ? parsed : parsed.phrases;
  if (!Array.isArray(values)) throw new Error("El JSON debe ser un array o tener `phrases`.");
  return values.flatMap((value: unknown) => {
    const item = typeof value === "string" ? { phrase: value } : value;
    if (!item || typeof item !== "object" || !("phrase" in item)) return [];
    const selected = item as Selected;
    return typeof selected.phrase === "string" && selected.phrase.trim()
      ? [{ ...selected, phrase: selected.phrase.trim() }]
      : [];
  });
}

function searchItems(keyword: string) {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.query(`
    select i.title, i.author, i.publisher, i.position, i.bsr_overall as bsr,
           i.reviews, i.rating, i.pub_date as pubDate, i.price, i.sponsored, i.badge,
           i.estimate_source as estimateSource
    from items i join runs r on r.id=i.run_id
    where r.kind='search' and r.keyword=?
      and i.run_id=(select id from runs where kind='search' and keyword=? order by created_at desc, id desc limit 1)
    order by i.position limit 16
  `).all(keyword, keyword) as any[];
  db.close();
  return rows;
}

async function sh(args: string[]) {
  const proc = Bun.spawn(args, {
    cwd: process.cwd(),
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, output: stdout + stderr };
}

async function main() {
  const file = arg("phrases-file");
  if (!file) throw new Error('Uso: verify.ts --phrases-file seleccionadas.json [--pause 5000]');
  const pauseMs = Number(arg("pause") ?? 5000);
  const phrases = loadPhrases(file);
  if (!phrases.length) throw new Error("No hay frases seleccionadas.");

  const results: any[] = [];
  for (const selected of phrases) {
    const phrase = selected.phrase.trim();
    console.log(`\n=== E3 ${phrase} ===`);
    if (selected.reason) console.log(`Motivo de selección del agente: ${selected.reason}`);

    const captured = await sh(["bun", "run", join(import.meta.dir, "capture-search.ts"), "--keyword", phrase]);
    console.log(captured.output.trim());
    if (captured.code !== 0) {
      results.push({ phrase, status: "capture-failed", output: captured.output.trim() });
      continue;
    }

    const enriched = await sh([
      "bun", "run", join(import.meta.dir, "bsr.ts"),
      "--keyword", phrase, "--limit", "16", "--pause", String(pauseMs),
    ]);
    console.log(enriched.output.trim());
    if (enriched.code !== 0 || /CORTADO:|bloqueo/i.test(enriched.output)) {
      results.push({ phrase, status: "enrichment-incomplete", output: enriched.output.trim() });
      continue;
    }

    const input = fromDb(DB_PATH, phrase);
    if (!input) {
      results.push({ phrase, status: "missing-db-capture" });
      continue;
    }
    const evaluation = evaluate(input, loadCriteria());
    const rows = searchItems(phrase);
    const top10 = rows.slice(0, 10);
    const authorCounts: Record<string, number> = {};
    for (const row of top10) {
      if (row.author) authorCounts[row.author] = (authorCounts[row.author] ?? 0) + 1;
    }
    const diagnostics = {
      titleHits: titleHits(phrase, rows.map((row) => row.title ?? "")),
      resultsWithAuthor: bookShareOf(rows),
      distinctAuthorsTop10: Object.keys(authorCounts).length,
      authorsTop10: authorCounts,
      maxBooksBySameAuthor: Math.max(0, ...Object.values(authorCounts)),
      independentlyPublishedTop10: top10.filter((row) => /independently published/i.test(row.publisher ?? "")).length,
      sponsoredTop10: top10.filter((row) => !!row.sponsored).length,
      sampleRows: rows.map((row) => ({
        position: row.position,
        title: row.title,
        author: row.author,
        publisher: row.publisher,
        bsr: row.bsr,
        reviews: row.reviews,
        rating: row.rating,
        pubDate: row.pubDate,
        price: row.price,
        sponsored: !!row.sponsored,
        badge: row.badge,
        estimateSource: row.estimateSource,
      })),
    };
    const result = {
      phrase,
      agentSelectionReason: selected.reason ?? null,
      status: "measured",
      evaluation,
      diagnostics,
    };
    results.push(result);
    // Entregar tabla y compuertas en la misma salida que consume el agente.
    console.log(JSON.stringify(result, null, 2));
  }

  console.log("\n=== E3/E4 salida estructurada ===");
  console.log(JSON.stringify({ source: file, results }, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`verify: ${String(error?.message ?? error)}`);
    process.exitCode = 1;
  });
}
