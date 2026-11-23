import { test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromDb } from "../apply";

/**
 * Regresión: `competitors` guarda runs de tipo 'product' con el mismo keyword que la
 * búsqueda. Si fromDb no filtra por kind, la evaluación lee 1 ficha y devuelve un brief
 * vacío con cobertura 10. Pasó en vivo con genealogy el 2026-11-21.
 */
function makeDb() {
  const dir = mkdtempSync(join(tmpdir(), "kdp-apply-"));
  const path = join(dir, "t.sqlite");
  const db = new Database(path);
  db.run(`CREATE TABLE runs (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT, kind TEXT, url TEXT,
    keyword TEXT, marketplace TEXT, currency TEXT, page INTEGER, total_results_text TEXT,
    total_results INTEGER, total_results_is_over INTEGER)`);
  db.run(`CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id INTEGER, asin TEXT, position INTEGER,
    title TEXT, subtitle TEXT, bsr_overall INTEGER, estimate_source TEXT, pub_date TEXT, reviews INTEGER, price REAL,
    pages INTEGER, sponsored INTEGER DEFAULT 0)`);

  const search = db
    .query(`insert into runs (created_at,kind,keyword,currency,page,total_results_text,total_results,total_results_is_over)
            values (?,?,?,?,?,?,?,?) returning id`)
    .get("2026-11-19T05:37:45.471Z", "search", "genealogy", "USD", 1, '1 a 16 de 343 resultados para "genealogy"', 343, 0) as { id: number };

  for (let i = 1; i <= 3; i++) {
    db.query(
      `insert into items (run_id,asin,position,title,bsr_overall,pub_date,reviews,price,pages)
       values (?,?,?,?,?,?,?,?,?)`,
    ).run(search.id, `S${i}`, i, `S book ${i}`, 40000 + i, "2019-01-01", 100, 14.99, 200);
  }

  // Run de ficha (competidores), posterior y con 1 solo item.
  const product = db
    .query(`insert into runs (created_at,kind,keyword,currency,page,total_results_text,total_results,total_results_is_over)
            values (?,?,?,?,?,?,?,?) returning id`)
    .get("2026-11-21T08:45:15.146Z", "product", "genealogy", "USD", 1, null, null, 0) as { id: number };
  db.query(`insert into items (run_id,asin,position,title,bsr_overall) values (?,?,?,?,?)`).run(
    product.id,
    "P1",
    1,
    "Product page",
    1234,
  );

  db.close();
  return { path, dir };
}

test("fromDb ignora los runs de ficha y lee la búsqueda", () => {
  const { path, dir } = makeDb();
  try {
    const input = fromDb(path, "genealogy")!;
    expect(input).not.toBeNull();
    expect(input.totalResults).toBe(343);
    expect(input.currency).toBe("USD");
    expect(input.rows.length).toBe(3);
    expect(input.rows.every((r) => r.asin?.startsWith("S"))).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("fromDb devuelve null si el keyword no tiene búsqueda", () => {
  const { path, dir } = makeDb();
  try {
    expect(fromDb(path, "inexistente")).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
