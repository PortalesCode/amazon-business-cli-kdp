import { test, expect } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPhrases } from "../verify";

test("verify.ts acepta strings y selección con motivo, ignora entradas inválidas", () => {
  const dir = mkdtempSync(join(tmpdir(), "kdp-verify-"));
  try {
    const file = join(dir, "selected.json");
    writeFileSync(file, JSON.stringify({
      phrases: [
        " rabbit care ",
        { phrase: "dementia caregiver", reason: "tema y lector concretos" },
        null,
        { phrase: "   " },
        7,
      ],
    }));
    expect(loadPhrases(file)).toEqual([
      { phrase: "rabbit care" },
      { phrase: "dementia caregiver", reason: "tema y lector concretos" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("verify.ts rechaza JSON sin campo phrases", () => {
  const dir = mkdtempSync(join(tmpdir(), "kdp-verify-"));
  try {
    const file = join(dir, "bad.json");
    writeFileSync(file, JSON.stringify({ keywords: ["rabbit care"] }));
    expect(() => loadPhrases(file)).toThrow("El JSON debe ser un array o tener `phrases`.");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
