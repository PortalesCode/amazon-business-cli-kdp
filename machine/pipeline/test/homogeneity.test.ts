import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { measureHomogeneity } from "../homogeneity";

const CRUDO = join(import.meta.dir, "fixtures", "captures");

function titles(file: string): string[] {
  const data = JSON.parse(readFileSync(join(CRUDO, `${file}.json`), "utf8"));
  const out: string[] = [];
  for (const p of data.pages ?? []) for (const it of p.itemsData ?? []) if (it.title) out.push(it.title);
  return out;
}

// ─── sintéticos ──────────────────────────────────────────────────────────────

test("un estante con tema repetido tiene cobertura alta", () => {
  const h = measureHomogeneity(
    [
      "Dog Training for Beginners",
      "Dog Training Basics",
      "Advanced Dog Training",
      "Dog Training and Behavior",
      "The Dog Training Manual",
      "Dog Training in 21 Days",
    ],
    { minDocs: 2 },
  );
  expect(h.coverage).toBe(1);
  expect(h.theme).toContain("dog");
  expect(h.theme).toContain("training");
});

test("un estante sin tema común tiene cobertura baja", () => {
  const h = measureHomogeneity(
    [
      "Holy Bible Giant Print",
      "KJV Large Print Bible",
      "Christmas Coloring Book",
      "Stories for Seniors",
      "Sudoku Challenge",
      "Antarctic Wildlife",
    ],
    { minDocs: 2 },
  );
  expect(h.coverage).toBeLessThan(0.5);
});

test("las palabras de formato no se convierten en tema", () => {
  const h = measureHomogeneity(
    [
      "Large Print Crossword Book",
      "Large Print Word Search",
      "Large Print Sudoku Book",
      "Large Print Puzzle Book",
      "Large Print Activity Book",
    ],
    { minDocs: 2 },
  );
  expect(h.theme).not.toContain("large");
  expect(h.theme).not.toContain("print");
  expect(h.theme).not.toContain("puzzle");
});

test("los años no son tema", () => {
  const h = measureHomogeneity(
    ["Wall Calendar 2026", "Desk Calendar 2026", "Pocket Calendar 2026", "Calendar 2026 Daily"],
    { minDocs: 2 },
  );
  expect(h.theme).not.toContain("2026");
});

test("sin títulos no habilita nada", () => {
  const h = measureHomogeneity([]);
  expect(h.total).toBe(0);
  expect(h.pass).toBe(false);
});

// ─── regresión con datos reales ──────────────────────────────────────────────

/**
 * Estos cinco nodos determinan si el filtro sirve. No es un test de "pasa/no pasa":
 * fija los valores medidos para que un cambio de método se detecte.
 */
test("DATOS REALES: cobertura medida en cinco nodos", () => {
  const cases: Array<[string, number]> = [
    ["travel-polar-regions", 0.66],
    ["parenting-relationships-aging-parents", 0.52],
    ["science-math-astronomy-space-science", 0.42],
    ["crafts", 0.36],
    ["parenting-relationships-marriage", 0.78],
  ];
  for (const [file, expected] of cases) {
    const h = measureHomogeneity(titles(file));
    expect({ file, coverage: h.coverage }).toEqual({ file, coverage: expected });
  }
});

test("DATOS REALES: el tema reportado coincide con el estante", () => {
  const polar = measureHomogeneity(titles("travel-polar-regions"));
  expect(polar.theme).toContain("antarctica");
  expect(polar.theme).toContain("arctic");

  const aging = measureHomogeneity(titles("parenting-relationships-aging-parents"));
  expect(aging.theme).toContain("dementia");
});

test("DATOS REALES: por defecto no bloquea ningún nodo", () => {
  for (const file of [
    "travel-polar-regions",
    "parenting-relationships-aging-parents",
    "science-math-astronomy-space-science",
    "crafts",
  ]) {
    expect(measureHomogeneity(titles(file)).pass).toBe(true);
  }
});

test("un umbral explícito sí bloquea, y es el que decide", () => {
  const low = measureHomogeneity(titles("crafts"), { threshold: 0.5 });
  expect(low.pass).toBe(false);
  const high = measureHomogeneity(titles("travel-polar-regions"), { threshold: 0.5 });
  expect(high.pass).toBe(true);
});
