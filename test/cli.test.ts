import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
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

test("init usa el directorio actual como workspace por defecto", async () => {
  const dir = mkdtempSync(join(tmpdir(), "amazon-business-init-cwd-"));
  const originalCwd = process.cwd();
  const originalLog = console.log;
  process.chdir(dir);
  console.log = () => {};
  try {
    expect(await main(["init"])).toBe(0);
    expect(existsSync(join(dir, ".amazon-business/config.json"))).toBe(true);
  } finally {
    console.log = originalLog;
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("rechaza el home como workspace", () => {
  expect(() => resolveConfig({ "--workspace": homedir() })).toThrow(
    "No se puede usar el home del usuario como workspace",
  );
});

test.each(["--version", "-v"])("muestra la versión del paquete con %s", async (flag) => {
  const originalLog = console.log;
  const output: unknown[][] = [];
  console.log = (...args: unknown[]) => output.push(args);
  try {
    expect(await main([flag])).toBe(0);
    expect(output).toEqual([
      [JSON.parse(await Bun.file(join(import.meta.dir, "../package.json")).text()).version],
    ]);
  } finally {
    console.log = originalLog;
  }
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
