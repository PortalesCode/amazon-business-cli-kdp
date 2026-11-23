#!/usr/bin/env bun
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  DB_FILENAME,
  WORKSPACE_CONFIG_FILE,
  WORKSPACE_STATE_DIR,
  initWorkspace,
  loadWorkspace,
} from "./workspace";

export type CliConfig = {
  workspace: string;
  dataDir: string;
  databasePath: string;
  stateDir: string;
  toolDir: string;
  pipelineDir: string;
  initialized: boolean;
};

const SCRIPT_BY_COMMAND: Record<string, string> = {
  run: "run.ts",
  verify: "verify.ts",
  phrases: "phrases.ts",
  apply: "apply.ts",
  bsr: "bsr.ts",
  "capture-search": "capture-search.ts",
  "capture-bestsellers": "capture-bestsellers.ts",
  autocomplete: "autocomplete.ts",
  prefilter: "prefilter.ts",
  cross: "cross.ts",
  cruce: "cruce.ts",
  sweep: "sweep.ts",
};

const GLOBAL_PATH_FLAGS = new Set(["--workspace", "--tool-dir", "--pipeline-dir"]);
const PACKAGE_VERSION = (JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string }).version;

export function parseGlobalPaths(args: string[]): { paths: Record<string, string>; forwarded: string[] } {
  const paths: Record<string, string> = {};
  const forwarded: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--data-dir") {
      throw new Error("La data queda dentro de .amazon-business del workspace; --data-dir ya no se admite.");
    }
    if (!GLOBAL_PATH_FLAGS.has(arg)) {
      forwarded.push(arg);
      continue;
    }
    const value = args[++i];
    if (!value || value.startsWith("--")) throw new Error(`Falta el valor de ${arg}.`);
    paths[arg] = value;
  }

  return { paths, forwarded };
}

export function resolveConfig(paths: Record<string, string>, cwd = process.cwd()): CliConfig {
  const workspace = resolve(paths["--workspace"] ?? cwd);
  assertWorkspaceOutsideHome(workspace);
  const resolveFromWorkspace = (value: string | undefined, fallback: string) =>
    resolve(workspace, value ?? fallback);
  const stateDir = join(workspace, WORKSPACE_STATE_DIR);
  const dataDir = join(stateDir, "data");
  const workspaceConfigPath = join(stateDir, WORKSPACE_CONFIG_FILE);

  return {
    workspace,
    stateDir,
    dataDir,
    databasePath: join(dataDir, DB_FILENAME),
    toolDir: resolveFromWorkspace(
      paths["--tool-dir"] ?? process.env.EDITORIAL_TOOL_DIR,
      "Lab/Departamento-de-Investigacion/Machine/kdp-extension-chromium",
    ),
    pipelineDir: resolve(
      paths["--pipeline-dir"] ?? process.env.EDITORIAL_PIPELINE_DIR ??
        resolve(import.meta.dir, "../machine/pipeline"),
    ),
    initialized: existsSync(workspaceConfigPath),
  };
}

export function assertWorkspaceOutsideHome(workspace: string) {
  const canonicalWorkspace = existsSync(workspace) ? realpathSync(workspace) : resolve(workspace);
  const canonicalHome = existsSync(homedir()) ? realpathSync(homedir()) : resolve(homedir());
  if (canonicalWorkspace === canonicalHome) {
    throw new Error(
      `No se puede usar el home del usuario como workspace (${canonicalHome}). Entra a un proyecto y ejecuta \`abck init\` ahí.`,
    );
  }
}

function help() {
  console.log(`Amazon Business CLI — investigación KDP

Uso:
  abck init [workspace] [--json]
  abck doctor [--workspace <ruta>] [--json]
  abck machine <comando> [argumentos de la máquina] [paths]

Comandos de máquina:
  run, verify, phrases, apply, bsr, capture-search,
  capture-bestsellers, autocomplete, prefilter, cross, cruce, sweep

Paths globales:
  --workspace <ruta>    raíz del proyecto de trabajo (por defecto: cwd)
  --tool-dir <ruta>     herramienta legacy requerida solo para el dossier E5
  --pipeline-dir <ruta> override de desarrollo para comparar otro pipeline

Ejemplo (desde la raíz del proyecto):
  abck init
  abck machine run --plan 1 --seed 1 \\
    --workspace /ruta/al/proyecto

No inicialices ni ejecutes el motor desde el home del usuario.
Los datos quedan aislados en <workspace>/.amazon-business/data.
Los argumentos propios de la máquina se reenvían sin cambios.`);
}

function doctor(config: CliConfig, json: boolean) {
  let databaseReady = false;
  let workspaceError: string | null = null;
  if (config.initialized) {
    try {
      loadWorkspace(config.workspace);
      databaseReady = true;
    } catch (error: any) {
      workspaceError = String(error?.message ?? error);
    }
  }
  const checks = [
    { name: "workspace", path: config.workspace, exists: existsSync(config.workspace) },
    { name: "pipeline", path: config.pipelineDir, exists: existsSync(config.pipelineDir) },
    { name: "workspace-config", path: join(config.stateDir, WORKSPACE_CONFIG_FILE), exists: config.initialized },
    { name: "workspace-database", path: config.databasePath, exists: databaseReady },
    { name: "legacy-E5-tool (optional)", path: config.toolDir, exists: existsSync(config.toolDir) },
  ];

  if (json) console.log(JSON.stringify({ config, checks, workspaceError }, null, 2));
  else {
    console.log("Amazon Business CLI — diagnóstico (solo lectura; datos por workspace)");
    for (const check of checks) {
      console.log(`${check.exists ? "✓" : "·"} ${check.name}: ${check.path}${check.exists ? "" : " (todavía no existe)"}`);
    }
    if (workspaceError) console.log(`  detalle: ${workspaceError}`);
  }
  const requiredChecks = checks.filter((check) =>
    ["workspace", "pipeline", "workspace-config", "workspace-database"].includes(check.name),
  );
  return requiredChecks.every((check) => check.exists) ? 0 : 1;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && (argv[0] === "--version" || argv[0] === "-v")) {
    console.log(PACKAGE_VERSION);
    return 0;
  }

  if (argv.includes("--help") || argv.includes("-h") || argv.length === 0) {
    help();
    return argv.length === 0 ? 1 : 0;
  }

  const command = argv[0];
  const { paths, forwarded } = parseGlobalPaths(argv.slice(1));
  const config = resolveConfig(paths);

  if (command === "init") {
    const json = forwarded.includes("--json");
    const initArgs = forwarded.filter((arg) => arg !== "--json");
    if (initArgs.length > 1) {
      throw new Error("Uso: abck init [workspace] [--json]");
    }
    const target = initArgs[0] ?? paths["--workspace"] ?? process.cwd();
    const initialized = initWorkspace(target);
    const result = {
      workspace: initialized.root,
      stateDir: initialized.stateDir,
      dataDir: initialized.dataDir,
      database: initialized.databasePath,
      configCreated: initialized.configCreated,
      databaseCreated: initialized.databaseCreated,
      scaffoldCreated: initialized.scaffold.created,
      scaffoldPreserved: initialized.scaffold.preserved,
    };
    if (json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`${initialized.configCreated ? "Inicializado" : "Ya inicializado"}: ${initialized.root}`);
      console.log(`  data: ${initialized.dataDir}`);
      console.log(`  db:   ${initialized.databasePath}${initialized.databaseCreated ? " (nueva)" : " (preservada)"}`);
      console.log(`  estructura del proyecto: Lab/, sitio/, confidencial/, .opencode/`);
      if (initialized.scaffold.created.length) {
        console.log(`  recursos OpenCode nuevos: ${initialized.scaffold.created.length}`);
      }
      if (initialized.scaffold.preserved.length) {
        console.log(`  archivos existentes preservados: ${initialized.scaffold.preserved.length}`);
      }
    }
    return 0;
  }

  if (command === "doctor") {
    return doctor(config, forwarded.includes("--json"));
  }

  if (command !== "machine") throw new Error(`Comando desconocido: ${command}`);
  const [machineCommand, ...machineArgs] = forwarded;
  if (!machineCommand) throw new Error("Falta el comando de máquina. Usa `abck --help`.");
  const workspace = loadWorkspace(config.workspace);

  const script = SCRIPT_BY_COMMAND[machineCommand];
  if (!script) throw new Error(`Comando de máquina desconocido: ${machineCommand}`);
  const scriptPath = resolve(config.pipelineDir, script);
  if (!existsSync(scriptPath)) throw new Error(`No existe el script del pipeline: ${scriptPath}`);

  const child = Bun.spawn([process.execPath, "run", scriptPath, ...machineArgs], {
    cwd: config.workspace,
    env: {
      ...process.env,
      EDITORIAL_DATA_DIR: workspace.dataDir,
      EDITORIAL_CRITERIA_FILE: join(workspace.stateDir, "criteria.json"),
      EDITORIAL_TOOL_DIR: resolve(
        config.workspace,
        paths["--tool-dir"] ?? process.env.EDITORIAL_TOOL_DIR ?? workspace.legacyToolDir,
      ),
    },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}

if (import.meta.main) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(`abck: ${String(error?.message ?? error)}`);
      process.exitCode = 1;
    },
  );
}
