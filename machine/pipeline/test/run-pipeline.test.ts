import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Protección contra el bug repetido: el bloque E1c de run.ts tiene que usar
 * titlesFromCapture y el contrato nuevo de measureHomogeneity.
 * Es un test de contrato sobre el código fuente: barato y atrapa el error de firma.
 */
const RUN = readFileSync(join(import.meta.dir, "..", "run.ts"), "utf8");

test("run.ts extrae títulos con titlesFromCapture", () => {
  expect(RUN).toContain("titlesFromCapture(");
});

test("run.ts no llama a measureHomogeneity con un nombre de categoría", () => {
  expect(RUN).not.toMatch(/measureHomogeneity\(\s*label/);
  expect(RUN).not.toMatch(/measureHomogeneity\(\s*nodeName/);
});

test("run.ts usa las propiedades del contrato actual", () => {
  expect(RUN).toContain("h.coverage");
  expect(RUN).toContain("h.theme");
  expect(RUN).not.toContain("h.affinity");
});

test("run.ts importa ambos módulos", () => {
  expect(RUN).toContain('from "./homogeneity"');
  expect(RUN).toContain('from "./phrases"');
});
