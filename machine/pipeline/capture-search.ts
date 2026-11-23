#!/usr/bin/env bun
/**
 * Captura de una búsqueda a la base, sin navegador.
 *
 *   bun run machine/pipeline/capture-search.ts --keyword "caregiver devotional"
 *
 * Baja la página de resultados, la extrae con `machine/extractor` e inserta un run
 * `kind='search'` con sus items. Es el reemplazo de `collect` (Playwright) para el
 * camino de la máquina.
 */
import { Database } from "bun:sqlite";
import { DB_PATH } from "./paths";
import { fetchAndExtract } from "./http";
import { parseTotal } from "./total";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const keyword = arg("keyword");
  if (!keyword) {
    console.error('Uso: capture-search.ts --keyword "frase"');
    process.exit(1);
  }

  const url = `https://www.amazon.com/s?k=${encodeURIComponent(keyword)}&i=stripbooks&page=1`;
  let data: any = null;
  let blocked: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetchAndExtract(url);
    data = res.data;
    blocked = res.blocked;
    if (!blocked && data?.items?.length) break;
    if (blocked) {
      // Amazon sirvió verificación anti-bot: esperar y reintentar.
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
    }
  }
  if (blocked) {
    console.error(`CORTADO: ${blocked}`);
    process.exit(2);
  }
  const items = data?.items ?? [];
  if (!items.length) {
    console.error("sin items: la búsqueda no devolvió resultados");
    process.exit(3);
  }

  const parsed = parseTotal(data?.totalResultsText ?? null);
  const db = new Database(DB_PATH);
  const run = db
    .query(
      `insert into runs (created_at, kind, url, keyword, marketplace, currency, location, lang, department, page, total_results_text, total_results, total_results_is_over, items_count, client)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) returning id`,
    )
    .get(
      new Date().toISOString(),
      "search",
      url,
      keyword,
      "amazon.com",
      "USD",
      "US",
      "en_US",
      "books",
      1,
      data?.totalResultsText ?? null,
      parsed.total,
      parsed.isOver ? 1 : 0,
      items.length,
      "machine-no-browser",
    ) as { id: number };

  let n = 0;
  for (const it of items) {
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
  db.close();
  console.log(`capturado: ${n} items · "${keyword}" · ${data?.totalResultsText ?? "sin total"}`);
}

await main();
