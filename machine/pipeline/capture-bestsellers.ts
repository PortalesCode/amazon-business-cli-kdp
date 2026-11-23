#!/usr/bin/env bun
/**
 * E1 — captura del universo de demanda (bestsellers por categoría).
 *
 * Sin navegador: baja el HTML y lo extrae con el extractor de `machine/extractor`.
 *
 *   bun run machine/pipeline/capture-bestsellers.ts --tree --limit 35
 *   bun run machine/pipeline/capture-bestsellers.ts --node 283155 --pages 2 --label pets
 *   bun run machine/pipeline/capture-bestsellers.ts --import <archivo.json> --label "bs:pets"
 *   bun run machine/pipeline/capture-bestsellers.ts --summary-db "bs:pets"
 *
 * Guarda JSON en la data del usuario (`EDITORIAL_DATA_DIR`, por defecto
 * `<repo>/.editorial-program`). No escribe en la base salvo con `--import`.
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseHTML } from "linkedom";
import { AMAZON, DB_PATH } from "./paths";
import { fetchHtml, extract, fetchAndExtract, pause } from "./http";

const OUT = AMAZON;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(`--${name}`);

/** Enlaces de la nav lateral: los hijos de un nodo están un nivel más abajo. */
function readNav(html: string, childLevel: number) {
  const { document } = parseHTML(html) as any;
  const re = new RegExp(`zg_bs_nav_books_${childLevel}(?!\\d)`);
  const seen = new Set<string>();
  const children: { node: string; name: string }[] = [];
  for (const a of document.querySelectorAll("a")) {
    const h = a.getAttribute("href") ?? "";
    if (!re.test(h)) continue;
    const node = h.match(/zgbs\/books\/(\d+)/)?.[1];
    const name = (a.textContent ?? "").trim().replace(/\s+/g, " ");
    if (!node || !name || seen.has(node)) continue;
    seen.add(node);
    children.push({ node, name });
  }
  const pag = Array.from(document.querySelectorAll(".a-pagination li a")).map((a: any) =>
    (a.textContent ?? "").trim(),
  );
  const pages = Math.max(1, ...pag.filter((t: string) => /^\d+$/.test(t)).map(Number), 1);
  return { children, pages, grid: document.querySelectorAll("#gridItemRoot").length };
}

async function discover() {
  const { html, blocked } = await fetchHtml("https://www.amazon.com/gp/bestsellers/books/");
  if (blocked) throw new Error(`bloqueo: ${blocked}`);
  const { children } = readNav(html, 1);
  const links = children.map((c) => ({ ...c, url: `https://www.amazon.com/gp/bestsellers/books/${c.node}` }));
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, "categorias-books.json");
  writeFileSync(file, JSON.stringify({ capturedAt: new Date().toISOString(), links }, null, 2));
  console.log(`categorías: ${links.length} → ${file}`);
  for (const l of links.slice(0, 12)) console.log(`  ${l.node}  ${l.name}`);
}

async function captureUrl(url: string, pages: number, label: string, pauseMs = 1200) {
  const result: any = { url, label, capturedAt: new Date().toISOString(), pages: [], stopped: null };
  for (let p = 1; p <= pages; p++) {
    const target = `${url}${url.includes("?") ? "&" : "?"}pg=${p}`;
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
    if (p < pages) await pause(pauseMs + Math.floor(Math.random() * 600));
  }
  mkdirSync(OUT, { recursive: true });
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "bestsellers";
  const file = join(OUT, `${slug}.json`);
  writeFileSync(file, JSON.stringify(result, null, 2));
  const n = result.pages.reduce((a: number, p: any) => a + p.items, 0);
  console.log(`items: ${n} en ${result.pages.length} página(s) → ${file}`);
  if (result.stopped) console.log(`CORTADO: ${result.stopped.reason} en página ${result.stopped.at}`);
  return file;
}

/** Inventario del árbol: raíz -> hijos, una request por nodo. */
async function tree(limit: number, pauseMs: number) {
  const rootRes = await fetchHtml("https://www.amazon.com/gp/bestsellers/books/");
  if (rootRes.blocked) throw new Error(`bloqueo en raíz: ${rootRes.blocked}`);
  const root = readNav(rootRes.html, 1);
  if (!root.children.length) throw new Error("la raíz no devolvió categorías");

  const nodes: any[] = [];
  for (const child of root.children.slice(0, limit)) {
    const res = await fetchHtml(`https://www.amazon.com/gp/bestsellers/books/${child.node}`);
    if (res.blocked) {
      nodes.push({ ...child, error: res.blocked });
      break;
    }
    const nav = readNav(res.html, 2);
    nodes.push({ ...child, pages: nav.pages, grid: nav.grid, children: nav.children });
    await pause(pauseMs + Math.floor(Math.random() * 400));
  }

  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, "arbol-books.json");
  writeFileSync(
    file,
    JSON.stringify(
      { capturedAt: new Date().toISOString(), rootChildren: root.children.length, explored: nodes.length, nodes },
      null,
      2,
    ),
  );

  const totalKids = nodes.reduce((a, n) => a + (n.children?.length ?? 0), 0);
  console.log(`raíz: ${root.children.length} categorías · exploradas: ${nodes.length} · hijos encontrados: ${totalKids}`);
  for (const n of nodes) {
    console.log(`  ${n.node}  ${n.name} — ${n.children?.length ?? 0} hijos, ${n.pages ?? "?"} pág.${n.error ? " ERROR " + n.error : ""}`);
  }
  console.log(`archivo: ${file}`);
}

/** Guarda una captura como run de la base, para enriquecer el BSR por lote. */
function saveDb(file: string, keyword: string) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const db = new Database(DB_PATH);
  let n = 0;
  for (const p of data.pages) {
    const run = db
      .query(
        `insert into runs (created_at, kind, url, keyword, marketplace, currency, location, lang, department, page, items_count, client)
         values (?,?,?,?,?,?,?,?,?,?,?,?) returning id`,
      )
      .get(
        new Date().toISOString(),
        "bestsellers",
        p.url ?? null,
        keyword,
        "amazon.com",
        data.pages[0]?.itemsData?.[0]?.currency ?? "USD",
        "US",
        "en_US",
        "books",
        p.page ?? 1,
        p.itemsData?.length ?? 0,
        "department-e1",
      ) as { id: number };
    for (const it of p.itemsData ?? []) {
      db.query(
        `insert into items (run_id, asin, position, title, author, price, price_raw, currency, rating, reviews, sponsored, badge, format, url)
         values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        run.id,
        it.asin ?? null,
        it.position ?? null,
        it.title ?? null,
        it.author ?? null,
        it.price ?? null,
        it.priceRaw ?? null,
        it.currency ?? null,
        it.rating ?? null,
        it.reviews ?? null,
        it.sponsored ? 1 : 0,
        it.badge ?? null,
        it.format ?? null,
        it.url ?? null,
      );
      n++;
    }
  }
  db.close();
  console.log(`guardado en db: ${n} items con keyword "${keyword}"`);
}

/** Compuerta de categoría: BSR del puesto #50, leído de la base ya enriquecida. */
function summaryDb(keyword: string, min = 300000) {
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db
    .query(
      `select i.position p, i.asin, i.bsr_overall bsr, i.reviews rv
       from items i join runs r on r.id = i.run_id
       where r.keyword = ? order by i.position asc`,
    )
    .all(keyword) as { p: number; asin: string; bsr: number | null; rv: number | null }[];
  db.close();
  const withBsr = rows.filter((r) => r.bsr != null);
  console.log(`items: ${rows.length} · con BSR: ${withBsr.length}`);
  if (!withBsr.length) {
    console.log(`Sin BSR todavía: correr \`bun run enrich -- "${keyword}"\``);
    return;
  }
  // El fondo de la lista no tiene ranking: son libros sin ventas. La compuerta mira
  // el top 10 —cuántos venden— en vez del puesto 50.
  const top10 = withBsr.filter((r) => (r.p ?? 99) <= 10);
  const selling = top10.filter((r) => r.bsr! < min);
  const pass = selling.length >= 3;
  console.log(
    `top 10: ${selling.length} venden (BSR < ${min}) → ${pass ? "PASA" : "NO PASA"}${top10.length ? ` · mejor #${top10[0].p} BSR ${top10[0].bsr}` : ""}`,
  );
  if (!pass) console.log("Menos de 3 del top 10 venden: no se mina.");
}

function summary(file: string) {
  const data = JSON.parse(readFileSync(file, "utf8"));
  const items = data.pages.flatMap((p: any) => p.itemsData ?? []);
  const withBsr = items.filter((i: any) => i.bsrOverall != null);
  console.log(`items: ${items.length} · con BSR: ${withBsr.length}`);
  if (!withBsr.length) {
    console.log("Sin BSR en la captura: la ficha no lo trae. Se completa con enrich.");
    console.log("ASIN disponibles:", items.filter((i: any) => i.asin).length);
    return;
  }
  const at50 = withBsr[Math.min(49, withBsr.length - 1)];
  console.log(`#50 BSR: ${at50.bsrOverall} → ${at50.bsrOverall < 300000 ? "pasa" : "no pasa"}`);
}

if (import.meta.main) {
  if (has("summary")) {
    summary(arg("summary")!);
  } else if (has("discover")) {
    await discover();
  } else if (arg("url")) {
    await captureUrl(arg("url")!, Number(arg("pages") ?? 2), arg("label") ?? "bestsellers");
  } else if (has("tree")) {
    await tree(Number(arg("limit") ?? 35), Number(arg("pause") ?? 1200));
  } else if (arg("import")) {
    saveDb(arg("import")!, arg("label") ?? `bestsellers:${Date.now()}`);
  } else if (has("summary-db")) {
    summaryDb(arg("summary-db")!, Number(arg("min") ?? 300000));
  } else if (arg("node")) {
    const url = `https://www.amazon.com/gp/bestsellers/books/${arg("node")}`;
    await captureUrl(url, Number(arg("pages") ?? 2), arg("label") ?? `node-${arg("node")}`);
  } else {
    console.error(`Uso:
  --tree [--limit 35] [--pause 1200]     inventario raíz -> hijos
  --discover
  --url "<url de bestsellers>" [--pages 2] [--label nombre]
  --node 283155 [--pages 2]
  --summary <archivo.json>
  --import <archivo.json> --label <keyword>
  --summary-db <keyword> [--min 300000]`);
    process.exit(1);
  }
}
