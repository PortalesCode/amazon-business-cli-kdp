#!/usr/bin/env bun
/**
 * Barrido completo del catálogo: una foto de todos los nodos útiles.
 *
 *   bun run machine/pipeline/sweep.ts --pages 2 --pause 700
 *   bun run machine/pipeline/sweep.ts --from 0 --to 50        primera tanda
 *   bun run machine/pipeline/sweep.ts --force                  vuelve a capturar todo
 *
 * Salta los nodos que ya tienen captura (se puede cortar y retomar).
 * Sin navegador y sin API.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AMAZON } from "./paths";
import { fetchAndExtract, pause } from "./http";

const EXCLUDED_ROOTS = new Set([
  "Literature & Fiction",
  "Mystery, Thriller & Suspense",
  "Romance",
  "Science Fiction & Fantasy",
  "Comics & Graphic Novels",
  "Children's Books",
  "Teens",
  "Calendars",
  "Books on CD",
  "New, Used & Rental Textbooks",
  "Libros en español",
]);

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (n: string) => process.argv.includes(`--${n}`);
const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type Node = { node: string; name: string; parent: string };

function nodes(): Node[] {
  const tree = join(AMAZON, "arbol-books.json");
  if (!existsSync(tree)) throw new Error("falta arbol-books.json; correr capture-bestsellers --tree");
  const data = JSON.parse(readFileSync(tree, "utf8"));
  const out: Node[] = [];
  for (const root of data.nodes ?? []) {
    if (EXCLUDED_ROOTS.has(root.name)) continue;
    for (const child of root.children ?? []) {
      if (child.node && child.name) out.push({ node: child.node, name: child.name, parent: root.name });
    }
  }
  return out;
}

async function captureNode(n: Node, pages: number, pauseMs: number) {
  const label = slug(`${n.parent}-${n.name}`);
  const file = join(AMAZON, `${label}.json`);
  const url = `https://www.amazon.com/gp/bestsellers/books/${n.node}`;
  const result: any = { url, label, capturedAt: new Date().toISOString(), pages: [], stopped: null };

  for (let p = 1; p <= pages; p++) {
    const target = `${url}?pg=${p}`;
    const { data, blocked } = await fetchAndExtract(target);
    if (blocked) {
      result.stopped = { at: p, reason: blocked };
      break;
    }
    result.pages.push({
      page: p,
      url: target,
      kind: data?.kind,
      items: data?.items?.length ?? 0,
      total: data?.totalResultsText ?? null,
      itemsData: data?.items ?? [],
    });
    if (p < pages) await pause(pauseMs);
  }

  writeFileSync(file, JSON.stringify(result, null, 2));
  const books = result.pages.reduce((a: number, p: any) => a + (p.items ?? 0), 0);
  return { label, books, stopped: result.stopped };
}

async function main() {
  const all = nodes();
  const from = Number(arg("from") ?? 0);
  const to = Number(arg("to") ?? all.length);
  const pages = Number(arg("pages") ?? 2);
  const pauseMs = Number(arg("pause") ?? 700);
  const force = has("force");
  const slice = all.slice(from, to);

  console.log(`nodos útiles: ${all.length} · tanda: ${from}–${Math.min(to, all.length)} (${slice.length})`);

  let done = 0;
  let skipped = 0;
  let books = 0;
  let stopped: any = null;
  const failed: string[] = [];
  const t0 = Date.now();

  for (const n of slice) {
    const label = slug(`${n.parent}-${n.name}`);
    if (!force && existsSync(join(AMAZON, `${label}.json`))) {
      skipped++;
      continue;
    }
    try {
      const r = await captureNode(n, pages, pauseMs);
      if (r.stopped) {
        stopped = { node: n.name, ...r.stopped };
        break;
      }
      books += r.books;
      done++;
    } catch (e) {
      failed.push(`${n.name}: ${String(e).slice(0, 60)}`);
    }
    if (done % 10 === 0 && done) {
      const min = ((Date.now() - t0) / 60000).toFixed(1);
      console.log(`  ${done} nodos · ${books} libros · ${min} min`);
    }
    await pause(pauseMs);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const out = join(AMAZON, `sweep-${stamp}.json`);
  writeFileSync(
    out,
    JSON.stringify(
      {
        finishedAt: new Date().toISOString(),
        nodes: slice.length,
        captured: done,
        skipped,
        books,
        minutes: Math.round(((Date.now() - t0) / 60000) * 10) / 10,
        stopped,
        failed,
      },
      null,
      2,
    ),
  );
  console.log(
    `\ncapturados ${done} · saltados ${skipped} · libros ${books} · ${((Date.now() - t0) / 60000).toFixed(1)} min`,
  );
  if (stopped) console.log(`CORTADO en ${stopped.node}: ${stopped.reason}`);
  if (failed.length) console.log(`fallidos: ${failed.length}`);
  console.log(`resumen: ${out}`);
}

await main();
