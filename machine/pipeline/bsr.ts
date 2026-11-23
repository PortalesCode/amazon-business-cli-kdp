#!/usr/bin/env bun
/**
 * BSR desde la ficha del libro, sin API.
 *
 *   bun run machine/pipeline/bsr.ts --asin B0GT54DP1F
 *   bun run machine/pipeline/bsr.ts --keyword "caregiver devotional"
 *   bun run machine/pipeline/bsr.ts --keyword "genealogy" --limit 20 --pause 800
 *
 * Lee el ranking que Amazon publica en la ficha ("Best Sellers Rank: #X in Books"),
 * más páginas, editorial y fecha. Con `--keyword` completa los libros de la base que
 * no tienen BSR; no se consultan proveedores externos de estimaciones.
 */
import { Database } from "bun:sqlite";
import { parseHTML } from "linkedom";
import { DB_PATH } from "./paths";
import { fetchHtml, pause } from "./http";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (n: string) => process.argv.includes(`--${n}`);

export type BookFacts = {
  asin: string;
  bsr: number | null;
  category: string | null;
  ranks: { rank: number; category: string }[];
  pages: number | null;
  publisher: string | null;
  pubDate: string | null;
};

const num = (s: string | undefined | null) => {
  if (!s) return null;
  const n = Number(s.replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function parseProduct(html: string, asin: string): BookFacts {
  const { document } = parseHTML(html) as any;
  const text = (document.body?.textContent ?? "").replace(/\s+/g, " ");

  // "Best Sellers Rank: #15,119 in Books (See Top 100...) #164 in Aging Parents"
  const ranks: { rank: number; category: string }[] = [];
  const rankBlock = text.match(/Best Sellers Rank:?(.{0,600})/i)?.[1] ?? "";
  for (const m of rankBlock.matchAll(/#([\d,]+)\s+in\s+([A-Za-z][A-Za-z &,'’\-]{1,60})/g)) {
    const rank = num(m[1]);
    const category = m[2].replace(/\s+/g, " ").trim();
    if (rank && category) ranks.push({ rank, category });
  }

  const pages = num(text.match(/Print length\s*[:\u200e\s]*([\d,]+)\s*pages/i)?.[1]);
  const pubDate = text.match(/Publication date\s*[:\u200e\s]*([A-Za-z]+ \d{1,2}, \d{4})/i)?.[1] ?? null;
  // "Publisher : Independently published" — se corta en la etiqueta siguiente.
  const publisherBlock =
    text.match(/Publisher\s*[:\u200e\s]*([A-Za-z0-9][^:]{1,60}?)(?=\s*(?:Publication date|Language|Print length|ISBN|Dimensions|Book Format|Page 1 of 1))/i)?.[1] ??
    null;
  const publisher = publisherBlock ? publisherBlock.replace(/\s+/g, " ").trim().slice(0, 60) : null;

  return {
    asin,
    bsr: ranks[0]?.rank ?? null,
    category: ranks[0]?.category ?? null,
    ranks,
    pages,
    publisher: publisher || null,
    pubDate,
  };
}

export async function fetchBook(asin: string): Promise<BookFacts | null> {
  const { html, blocked } = await fetchHtml(`https://www.amazon.com/dp/${asin}`);
  if (blocked) return null;
  return parseProduct(html, asin);
}

/** Banda de ventas: misma tabla que usa la compuerta de masa. */
function unitsBand(bsr: number | null): [number, number] | null {
  if (!bsr) return null;
  const bands: [number, number, number][] = [
    [10000, 15, 25],
    [50000, 5, 15],
    [100000, 2, 5],
    [300000, 0.5, 2],
    [1000000, 0.1, 0.5],
    [Infinity, 0, 0.1],
  ];
  for (const [up, lo, hi] of bands) if (bsr < up) return [lo, hi];
  return null;
}

async function enrichKeyword(
  keyword: string,
  limit: number,
  pauseMs: number,
  position: number | null = null,
  maxPosition: number | null = null,
) {
  const db = new Database(DB_PATH);
  const rows = db
    .query(
      `select distinct i.asin from items i join runs r on r.id = i.run_id
       where r.keyword = ? and i.bsr_overall is null and i.asin is not null
         and coalesce(i.estimate_source, '') <> 'sin-bsr'
         and (? is null or i.position >= ?)
         and (? is null or i.position <= ?)
       order by i.position desc
       limit ?`,
    )
    .all(keyword, position, position, maxPosition, maxPosition, limit) as { asin: string }[];

  if (!rows.length) {
    console.log(`sin libros pendientes para "${keyword}"`);
    db.close();
    return;
  }

  let updated = 0;
  let noRank = 0;
  let blocked: string | null = null;
  for (const r of rows) {
    const facts = await fetchBook(r.asin).catch(() => null);
    if (!facts) {
      blocked = "ficha vacía o bloqueo";
      break;
    }
    if (!facts.bsr) {
      // Amazon no muestra "Best Sellers Rank" cuando el libro todavía no vendió.
      // Se marca para no volver a pedirlo, y las compuertas lo tratan como sin dato.
      db.query(
        `update items set estimate_source = 'sin-bsr' where asin = ?
         and run_id in (select id from runs where keyword = ?)`,
      ).run(r.asin, keyword);
      noRank++;
      await pause(pauseMs);
      continue;
    }
    if (facts.bsr) {
      const band = unitsBand(facts.bsr);
      db.query(
        `update items set bsr_overall = ?, bsr_overall_category = ?, pages = coalesce(?, pages),
           publisher = coalesce(?, publisher), pub_date = coalesce(?, pub_date),
           sales_day_min = ?, sales_day_max = ?, estimate_source = 'bandas'
         where asin = ? and run_id in (select id from runs where keyword = ?)`,
      ).run(
        facts.bsr,
        facts.category,
        facts.pages,
        facts.publisher,
        facts.pubDate,
        band?.[0] ?? null,
        band?.[1] ?? null,
        r.asin,
        keyword,
      );
      updated++;
    }
    await pause(pauseMs + Math.floor(Math.random() * 300));
  }
  db.close();
  console.log(
    `actualizados: ${updated} · sin ranking: ${noRank} · de ${rows.length}${blocked ? ` · CORTADO: ${blocked}` : ""}`,
  );
}

if (import.meta.main) {
  if (has("asin")) {
    const facts = await fetchBook(arg("asin")!);
    console.log(JSON.stringify(facts, null, 2));
  } else if (arg("keyword")) {
    await enrichKeyword(
      arg("keyword")!,
      Number(arg("limit") ?? 20),
      Number(arg("pause") ?? 800),
      arg("position") ? Number(arg("position")) : null,
      arg("max-position") ? Number(arg("max-position")) : null,
    );
  } else {
    console.error(`Uso:
  --asin B0GT54DP1F
  --keyword "frase" [--limit 20] [--pause 800] [--position 51] [--max-position 10]`);
    process.exit(1);
  }
}
