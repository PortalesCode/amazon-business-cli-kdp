import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluate, monthsBetween } from "../gates";
import type { PhraseInput, Row } from "../types";

const CAPTURED = "2026-11-21T00:00:00.000Z";

function row(i: number, bsr: number | null, opts: Partial<Row> = {}): Row {
  return {
    asin: `A${i}`,
    position: i,
    title: `Title ${i}`,
    subtitle: null,
    bsr,
    pubDate: "2020-01-01",
    reviews: 200,
    price: 14.99,
    pages: 200,
    sponsored: false,
    ...opts,
  };
}

function input(rows: Row[], total: number, isOver = false): PhraseInput {
  return { keyword: "test", totalResults: total, totalIsOver: isOver, currency: "USD", capturedAt: CAPTURED, rows };
}

test("cuenta meses entre fechas", () => {
  const m = monthsBetween("2020-01-01", "2021-07-01");
  expect(m).toBeGreaterThan(17.9);
  expect(m).toBeLessThan(18.4);
  expect(monthsBetween("no-es-fecha", "2021-07-01")).toBeNull();
});

test("un nicho sano pasa las cuatro", () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(i + 1, 40_000));
  const ev = evaluate(input(rows, 800));
  expect(ev.gates.map((g) => g.pass)).toEqual([true, true, true, true]);
  expect(ev.verdict).toBe("pasa");
  expect(ev.mass.mid).toBe(100);
});

test("pasa C1-C2-C3 pero la masa no alcanza: mercado chico", () => {
  const rows = Array.from({ length: 5 }, (_, i) => row(i + 1, 120_000));
  const ev = evaluate(input(rows, 500));
  expect(ev.gates.find((g) => g.id === "C4")!.pass).toBe(false);
  expect(ev.verdict).toBe("mercado-chico");
});

test("demanda solo sostenida por libros nuevos: mercado comprado", () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(i + 1, 60_000, { reviews: 4, pubDate: "2026-06-01" }));
  const ev = evaluate(input(rows, 500));
  expect(ev.gates.find((g) => g.id === "C3")!.pass).toBe(false);
  expect(ev.verdict).toBe("mercado-comprado");
});

test("mucha oferta con demanda buena: saturado", () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(i + 1, 60_000));
  const ev = evaluate(input(rows, 5_000, true));
  expect(ev.verdict).toBe("saturado");
});

test("REGRESIÓN rabbit care: el caso que el score viejo aprobó", () => {
  const fixture = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures", "rabbit-care.json"), "utf8"),
  ) as PhraseInput;
  const ev = evaluate(fixture);
  expect(ev.verdict).toBe("descartar");
  expect(ev.gates.find((g) => g.id === "C1")!.pass).toBe(false);
  expect(ev.gates.find((g) => g.id === "C4")!.pass).toBe(false);
  expect(ev.totalResults).toBe(9000);
});

test("moneda no USD baja la cobertura y queda como bloqueante", () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(i + 1, 40_000));
  const ev = evaluate({ ...input(rows, 800), currency: "ARS" });
  expect(ev.coverage).toBeLessThan(10);
  expect(ev.blockers.some((b) => b.includes("ARS"))).toBe(true);
});

test("sin total de resultados C1 falla y no se inventa el dato", () => {
  const rows = Array.from({ length: 10 }, (_, i) => row(i + 1, 40_000));
  const ev = evaluate({ ...input(rows, 0), totalResults: null });
  expect(ev.gates.find((g) => g.id === "C1")!.pass).toBe(false);
  expect(ev.blockers.some((b) => b.includes("total de resultados"))).toBe(true);
});
