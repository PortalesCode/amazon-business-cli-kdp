import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace, loadWorkspace } from "../src/workspace";

function tempWorkspace() {
  return mkdtempSync(join(tmpdir(), "amazon-business-workspace-"));
}

test("init creates a clean, workspace-local database and directories", () => {
  const root = tempWorkspace();
  try {
    const initialized = initWorkspace(root);
    expect(initialized.configCreated).toBe(true);
    expect(initialized.databaseCreated).toBe(true);
    expect(initialized.dataDir).toBe(join(root, ".amazon-business/data"));
    expect(existsSync(join(initialized.dataDir, "amazon"))).toBe(true);
    expect(existsSync(join(initialized.dataDir, "autocomplete"))).toBe(true);
    expect(existsSync(join(initialized.dataDir, "corridas"))).toBe(true);

    const db = new Database(initialized.databasePath, { readonly: true });
    try {
      expect((db.query("PRAGMA user_version").get() as any).user_version).toBe(1);
      expect((db.query("SELECT COUNT(*) AS n FROM runs").get() as any).n).toBe(0);
      expect((db.query("SELECT COUNT(*) AS n FROM items").get() as any).n).toBe(0);
    } finally {
      db.close();
    }
    expect(loadWorkspace(root).databasePath).toBe(initialized.databasePath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("init is idempotent and never clears existing workspace rows", () => {
  const root = tempWorkspace();
  try {
    const first = initWorkspace(root);
    const db = new Database(first.databasePath);
    db.query("INSERT INTO runs (created_at, kind, keyword) VALUES (?, ?, ?)").run(
      new Date().toISOString(),
      "search",
      "test marker",
    );
    db.close();

    const second = initWorkspace(root);
    expect(second.configCreated).toBe(false);
    expect(second.databaseCreated).toBe(false);

    const verify = new Database(second.databasePath, { readonly: true });
    try {
      expect((verify.query("SELECT COUNT(*) AS n FROM runs WHERE keyword = ?").get("test marker") as any).n).toBe(1);
    } finally {
      verify.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("init refuses to overwrite a non-CLI database", () => {
  const root = tempWorkspace();
  const dbDir = join(root, ".amazon-business/data");
  const dbPath = join(dbDir, "kdp-market-lab.sqlite");
  try {
    mkdirSync(dbDir, { recursive: true });
    const db = new Database(dbPath);
    db.run("CREATE TABLE user_data (value TEXT)");
    db.run("INSERT INTO user_data VALUES ('keep')");
    db.close();

    expect(() => initWorkspace(root)).toThrow("La base existe pero no tiene el esquema CLI esperado");
    const verify = new Database(dbPath, { readonly: true });
    try {
      expect((verify.query("SELECT value FROM user_data").get() as any).value).toBe("keep");
    } finally {
      verify.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("config refuses data paths that escape the workspace", () => {
  const root = tempWorkspace();
  try {
    const initialized = initWorkspace(root);
    const config = JSON.parse(readFileSync(initialized.configPath, "utf8"));
    config.dataDir = "../../shared-data";
    writeFileSync(initialized.configPath, JSON.stringify(config));
    expect(() => loadWorkspace(root)).toThrow("La config intenta guardar datos fuera de .amazon-business.");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
