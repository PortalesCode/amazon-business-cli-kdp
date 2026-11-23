import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main, parseGlobalPaths, resolveConfig } from "../src/cli";

test("extrae paths globales y conserva argumentos del script", () => {
  const parsed = parseGlobalPaths([
    "--plan", "1",
    "--workspace", "/tmp/workspace",
    "--seed", "7",
    "--tool-dir", "/tmp/tool",
  ]);

  expect(parsed.paths).toEqual({
    "--workspace": "/tmp/workspace",
    "--tool-dir": "/tmp/tool",
  });
  expect(parsed.forwarded).toEqual(["--plan", "1", "--seed", "7"]);
});

test("rechaza un directorio global de datos", () => {
  expect(() => parseGlobalPaths(["--data-dir", "/tmp/shared"])).toThrow(
    "La data queda dentro de .amazon-business del workspace; --data-dir ya no se admite.",
  );
});

test("rechaza paths globales sin valor", () => {
  expect(() => parseGlobalPaths(["--workspace"])).toThrow("Falta el valor de --workspace.");
});

test("init exige un workspace explícito para no inicializar el directorio equivocado", async () => {
  await expect(main(["init"])).rejects.toThrow("Uso: amazon-business init <workspace> [--json]");
});

test("resuelve almacenamiento aislado bajo el workspace", () => {
  const dir = mkdtempSync(join(tmpdir(), "amazon-business-cli-"));
  try {
    const config = resolveConfig({ "--workspace": dir }, dir);
    expect(config.workspace).toBe(dir);
    expect(config.dataDir).toBe(join(dir, ".amazon-business/data"));
    expect(config.databasePath).toBe(join(dir, ".amazon-business/data/kdp-market-lab.sqlite"));
    expect(config.initialized).toBe(false);
    expect(config.toolDir).toBe(join(dir, "Lab/Departamento-de-Investigacion/Machine/kdp-extension-chromium"));
    expect(config.pipelineDir).toBe(join(import.meta.dir, "../machine/pipeline"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
