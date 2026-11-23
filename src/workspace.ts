import { Database } from "bun:sqlite";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const WORKSPACE_STATE_DIR = ".amazon-business";
export const WORKSPACE_CONFIG_FILE = "config.json";
export const WORKSPACE_SCHEMA_VERSION = 1;
export const DB_FILENAME = "kdp-market-lab.sqlite";
export const DEFAULT_LEGACY_TOOL_DIR =
  "Lab/Departamento-de-Investigacion/Machine/kdp-extension-chromium";

export type WorkspaceConfig = {
  schemaVersion: number;
  createdAt: string;
  dataDir: string;
  database: string;
  legacyToolDir: string;
};

export type WorkspacePaths = {
  root: string;
  stateDir: string;
  configPath: string;
  dataDir: string;
  databasePath: string;
  legacyToolDir: string;
  config: WorkspaceConfig;
};

const REQUIRED_TABLES = ["items", "ranks", "runs", "suggestions"];
const SCHEMA_PATH = join(import.meta.dir, "../machine/storage/schema.sql");
const SCAFFOLD_ROOT = join(import.meta.dir, "../templates/workspace");

function installScaffoldDirectory(root: string, sourceDir: string, relativeDir = "") {
  const created: string[] = [];
  const preserved: string[] = [];

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const relativePath = join(relativeDir, entry.name);
    const sourcePath = join(sourceDir, entry.name);
    const portableRelativePath = relativePath.split(sep).join("/");
    const targetRelativePath = portableRelativePath === "confidencial/gitignore.template"
      ? join("confidencial", ".gitignore")
      : relativePath;
    const targetPath = join(root, targetRelativePath);
    assertLocalPath(root, targetPath);

    if (entry.isDirectory()) {
      mkdirSync(targetPath, { recursive: true });
      const nested = installScaffoldDirectory(root, sourcePath, relativePath);
      created.push(...nested.created);
      preserved.push(...nested.preserved);
      continue;
    }

    if (!entry.isFile()) continue;
    if (existsSync(targetPath)) {
      preserved.push(relativePath);
      continue;
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, readFileSync(sourcePath), { flag: "wx" });
    created.push(targetRelativePath);
  }

  return { created, preserved };
}

function isInside(root: string, path: string) {
  const relativePath = relative(root, path);
  return relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function assertLocalPath(root: string, path: string) {
  if (!isInside(root, path)) {
    throw new Error(`La ruta de datos escapa del workspace: ${path}`);
  }
  const canonicalRoot = realpathSync(root);
  let current = path;
  while (isInside(root, current)) {
    if (existsSync(current)) {
      if (lstatSync(current).isSymbolicLink()) {
        throw new Error(`La ruta de datos no puede ser un symlink: ${current}`);
      }
      if (!isInside(canonicalRoot, realpathSync(current))) {
        throw new Error(`La ruta de datos escapa del workspace: ${current}`);
      }
    }
    if (current === root) break;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function pathsFor(root: string, config: WorkspaceConfig): WorkspacePaths {
  const stateDir = join(root, WORKSPACE_STATE_DIR);
  const dataDir = resolve(root, config.dataDir);
  const databasePath = resolve(dataDir, config.database);
  const legacyToolDir = resolve(root, config.legacyToolDir);

  if (!isInside(stateDir, dataDir) || !isInside(dataDir, databasePath)) {
    throw new Error("La config intenta guardar datos fuera de .amazon-business.");
  }

  return {
    root,
    stateDir,
    configPath: join(stateDir, WORKSPACE_CONFIG_FILE),
    dataDir,
    databasePath,
    legacyToolDir,
    config,
  };
}

function parseConfig(file: string): WorkspaceConfig {
  let parsed: any;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(`Config inválida o ilegible: ${file}`);
  }
  if (
    parsed?.schemaVersion !== WORKSPACE_SCHEMA_VERSION ||
    typeof parsed.legacyToolDir !== "string"
  ) {
    throw new Error(`Versión o campos de config no compatibles: ${file}`);
  }
  if (parsed.dataDir !== join(WORKSPACE_STATE_DIR, "data")) {
    throw new Error("La config intenta guardar datos fuera de .amazon-business.");
  }
  if (parsed.database !== DB_FILENAME) {
    throw new Error("La config intenta redirigir la base fuera del workspace.");
  }
  return parsed as WorkspaceConfig;
}

function validateDatabase(dbPath: string) {
  if (!existsSync(dbPath)) return false;
  if (statSync(dbPath).size === 0) return false;

  let db: Database | undefined;
  try {
    db = new Database(dbPath, { readonly: true });
    const version = db.query("PRAGMA user_version").get() as { user_version: number };
    const tables = new Set(
      (db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
        .map((row) => row.name),
    );
    const valid = version.user_version === WORKSPACE_SCHEMA_VERSION &&
      REQUIRED_TABLES.every((table) => tables.has(table));
    if (!valid) {
      throw new Error(
        `La base existe pero no tiene el esquema CLI esperado (user_version=${version.user_version}). No la modifiqué.`,
      );
    }
    return true;
  } finally {
    db?.close();
  }
}

function initializeDatabase(dbPath: string) {
  const existed = validateDatabase(dbPath);
  if (existed) return false;

  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const db = new Database(dbPath);
  try {
    const existingTables = db.query(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    ).all();
    if (existingTables.length) {
      throw new Error("La base tiene tablas no reconocidas; no la modifiqué.");
    }
    db.exec(schema);
    validateDatabase(dbPath);
  } finally {
    db.close();
  }
  return true;
}

export function loadWorkspace(rootPath: string): WorkspacePaths {
  const root = resolve(rootPath);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`No existe el directorio de trabajo: ${root}`);
  }
  const configPath = join(root, WORKSPACE_STATE_DIR, WORKSPACE_CONFIG_FILE);
  assertLocalPath(root, join(root, WORKSPACE_STATE_DIR));
  assertLocalPath(root, configPath);
  if (!existsSync(configPath)) {
    throw new Error(`Workspace sin inicializar: ejecuta \`abck init ${root}\`.`);
  }
  const config = parseConfig(configPath);
  const paths = pathsFor(root, config);
  assertLocalPath(root, paths.dataDir);
  assertLocalPath(root, paths.databasePath);
  if (!validateDatabase(paths.databasePath)) {
    throw new Error(`Falta la base inicializada: ${paths.databasePath}. Ejecuta init para repararla.`);
  }
  return paths;
}

export function initWorkspace(rootPath: string) {
  const root = resolve(rootPath);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new Error(`El directorio de trabajo debe existir: ${root}`);
  }

  const stateDir = join(root, WORKSPACE_STATE_DIR);
  const configPath = join(stateDir, WORKSPACE_CONFIG_FILE);
  assertLocalPath(root, stateDir);
  assertLocalPath(root, configPath);
  const existingConfig = existsSync(configPath) ? parseConfig(configPath) : null;
  const config: WorkspaceConfig = existingConfig ?? {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    dataDir: join(WORKSPACE_STATE_DIR, "data"),
    database: DB_FILENAME,
    legacyToolDir: DEFAULT_LEGACY_TOOL_DIR,
  };
  const paths = pathsFor(root, config);
  assertLocalPath(root, stateDir);
  assertLocalPath(root, paths.dataDir);
  assertLocalPath(root, paths.databasePath);

  mkdirSync(stateDir, { recursive: true });
  mkdirSync(paths.dataDir, { recursive: true });
  for (const directory of ["amazon", "autocomplete", "corridas"]) {
    const outputDir = join(paths.dataDir, directory);
    assertLocalPath(root, outputDir);
    mkdirSync(outputDir, { recursive: true });
  }
  for (const directory of ["Lab", "sitio", "confidencial"]) {
    const projectDir = join(root, directory);
    assertLocalPath(root, projectDir);
    mkdirSync(projectDir, { recursive: true });
  }

  const databaseCreated = initializeDatabase(paths.databasePath);
  const scaffold = installScaffoldDirectory(root, SCAFFOLD_ROOT);
  const configCreated = !existingConfig;
  if (configCreated) {
    const temporary = `${configPath}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", { flag: "wx" });
    renameSync(temporary, configPath);
  }

  return { ...paths, databaseCreated, configCreated, scaffold };
}
