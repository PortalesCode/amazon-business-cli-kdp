import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { titlesFromCapture, buildPhrases } from "../phrases";
import { measureHomogeneity } from "../homogeneity";

const CRUDO = join(import.meta.dir, "fixtures", "captures");

/**
 * Regresión del bug de la corrida 2026-11-21: run.ts llamaba a measureHomogeneity
 * con títulos mal extraídos. Los tests unitarios no lo detectaban porque recibían
 * el array armado a mano.
 */
for (const file of [
  "science-math-astronomy-space-science",
  "computers-technology-mobile-phones-tablets-e-readers",
  "parenting-relationships-marriage",
  "travel-polar-regions",
]) {
  test(`captura real → títulos → homogeneidad (${file})`, () => {
    const data = JSON.parse(readFileSync(join(CRUDO, `${file}.json`), "utf8"));
    const titles = titlesFromCapture(data);
    expect(Array.isArray(titles)).toBe(true);
    expect(titles.length).toBeGreaterThan(50);
    expect(titles.every((t) => typeof t === "string")).toBe(true);

    const h = measureHomogeneity(titles);
    expect(h.total).toBe(50);
    expect(h.theme.length).toBeGreaterThan(0);
    expect(h.coverage).toBeGreaterThan(0);
  });
}

test("captura real → frases, sin duplicados exactos", () => {
  const data = JSON.parse(readFileSync(join(CRUDO, "parenting-relationships-marriage.json"), "utf8"));
  const { titles, phrases } = buildPhrases(data, { limit: 20 });
  expect(titles.length).toBeGreaterThan(50);
  expect(phrases.length).toBeGreaterThan(0);
  expect(phrases.length).toBeLessThanOrEqual(20);
  const keys = phrases.map((p) => p.phrase);
  expect(new Set(keys).size).toBe(keys.length);
});

test("señal léxica no descarta nombres propios y entrega títulos fuente", () => {
  const capture = {
    pages: [{
      itemsData: [
        { title: "Van Gogh: The Complete Paintings" },
        { title: "Van Gogh and His Art" },
        { title: "Van Gogh: A Life in Art" },
      ],
    }],
  };
  const { phrases } = buildPhrases(capture, { minBooks: 2, limit: 60 });
  const candidate = phrases.find((p) => p.phrase === "van gogh");
  expect(candidate).toBeDefined();
  expect(candidate?.evidenceTitles?.length).toBe(3);
  expect(candidate?.unusualWords).toContain("gogh");
});
