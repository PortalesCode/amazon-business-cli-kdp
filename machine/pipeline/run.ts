#!/usr/bin/env bun
/**
 * Orquestador del departamento: E1 → E5 en un solo comando.
 *
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/run.ts --node 5043 --verify 2
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/run.ts --plan 25 --seed 7
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/run.ts --run-plan Lab/Departamento-de-Investigacion/Data/amazon/planes/plan-2026-11-22-7.json --verify 3
 *   bun run Lab/Departamento-de-Investigacion/Machine/pipeline/run.ts --node 5043 --dry
 *
 * Reglas:
 *  - se detiene ante checkpoint o bloqueo, sin evadir;
 *  - enriquece BSR directamente desde fichas públicas con pausas y corte ante bloqueos;
 *  - levanta el servidor local si hace falta;
 *  - escribe un resumen por corrida en Lab/Departamento-de-Investigacion/Data/corridas/<fecha>-<label>/resumen.md
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { PhraseLedger } from "./dedupe";
import { measureHomogeneity } from "./homogeneity";
import { titlesFromCapture } from "./phrases";
import { AMAZON, CORRIDAS as CORRIDAS_ROOT, DB_PATH, TOOL } from "./paths";
import { dirname, join, resolve } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = process.cwd();
const LAB = TOOL;
const PIPELINE = HERE;
const CRUDO = AMAZON;
const CORRIDAS = CORRIDAS_ROOT;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (n: string) => process.argv.includes(`--${n}`);
const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type Step = { name: string; ok: boolean; ms: number; note?: string };
const steps: Step[] = [];
/** Dedupe global de la corrida: una frase repetida en dos nodos se verifica una vez. */
const ledger = new PhraseLedger();

async function sh(cmd: string[], cwd: string, env?: Record<string, string>) {
  const p = Bun.spawn(cmd, {
    cwd,
    env: { ...process.env, ...(env ?? {}) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(p.stdout).text();
  const err = await new Response(p.stderr).text();
  const code = await p.exited;
  return { code, out: out + err };
}

/** Enriquecimiento exclusivamente desde fichas públicas de Amazon. */
async function enrichBsr(args: string[]) {
  return sh(["bun", "run", join(PIPELINE, "bsr.ts"), ...args.slice(1)], ROOT);
}

async function timed<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  const t0 = Date.now();
  process.stdout.write(`\n▶ ${name}\n`);
  try {
    const r = await fn();
    steps.push({ name, ok: true, ms: Date.now() - t0 });
    return r;
  } catch (e: any) {
    const msg = String(e?.message ?? e).slice(0, 300);
    steps.push({ name, ok: false, ms: Date.now() - t0, note: msg });
    console.log(`  ✗ ${msg}`);
    return null;
  }
}

function isBlocked(text: string): string | null {
  if (/CORTADO:\s*([^\n]+)/.test(text)) return text.match(/CORTADO:\s*([^\n]+)/)![1];
  if (/actividad inusual|unusual activity|captcha|validateCaptcha/i.test(text)) return "captcha o actividad inusual";
  if (/\/ap\/signin/.test(text)) return "login requerido";
  return null;
}

// ─── plan ────────────────────────────────────────────────────────────────────
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type TreeNode = { node: string; name: string; children?: { node: string; name: string }[] };

/**
 * Raíces fuera del negocio: ficción, bajo contenido y formatos que no son libros.
 * Regla de contenido del departamento (alto contenido, no ficción práctica).
 * Se documenta en Lab/Departamento-de-Investigacion/protocolo.md, no se cambia por corrida.
 */
const EXCLUDED_ROOTS = new Set([
  "Literature & Fiction",
  "Mystery, Thriller & Suspense",
  "Romance",
  "Science Fiction & Fantasy",
  "Comics & Graphic Novels",
  "Children's Books",
  "Teens",
  "Calendars",
  "Books on CD",
  "New, Used & Rental Textbooks",
  "Libros en español",
]);

function loadTree(): TreeNode[] {
  const f = join(CRUDO, "arbol-books.json");
  if (!existsSync(f)) throw new Error(`falta el inventario del árbol: ${f}. Correr --tree primero.`);
  const data = JSON.parse(readFileSync(f, "utf8"));
  return data.nodes ?? [];
}

function previousNodes(skip?: string): Set<string> {
  const dir = join(CRUDO, "planes");
  const used = new Set<string>();
  if (!existsSync(dir)) return used;
  for (const f of Array.from(new Bun.Glob("plan-*.json").scanSync({ cwd: dir }))) {
    if (f === skip) continue; // reescribir el plan de hoy no quema sus nodos
    try {
      const d = JSON.parse(readFileSync(join(dir, f), "utf8"));
      for (const n of d.nodes ?? []) used.add(n.node);
    } catch {}
  }
  return used;
}

function makePlan(size: number, seed: number) {
  const tree = loadTree();
  const fileName = `plan-${new Date().toISOString().slice(0, 10)}-${seed}.json`;
  const used = previousNodes(fileName);
  const all: { node: string; name: string; parent: string }[] = [];
  for (const t of tree) {
    if (EXCLUDED_ROOTS.has(t.name)) continue;
    for (const c of t.children ?? []) {
      if (!c.node || used.has(c.node)) continue;
      all.push({ ...c, parent: t.name });
    }
  }
  if (!all.length) throw new Error("no quedan nodos sin usar: reiniciar la rotación borrando corridas/_crudo/planes");

  const rnd = mulberry32(seed);
  const pool = [...all];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const picked = pool.slice(0, Math.min(size, pool.length));

  const dir = join(CRUDO, "planes");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, fileName);
  writeFileSync(
    file,
    JSON.stringify({ createdAt: new Date().toISOString(), seed, size: picked.length, pool: all.length, nodes: picked }, null, 2),
  );
  console.log(`plan: ${picked.length} de ${all.length} nodos libres (${used.size} ya usados) → ${file}`);
  for (const n of picked) console.log(`  ${n.node}  ${n.parent} › ${n.name}`);
  return file;
}

// ─── etapas ──────────────────────────────────────────────────────────────────
type Ctx = { verify: number; pages: number; dry: boolean; e5: boolean; noGate: boolean; minCoverage: number; pause: number; autoVerify: boolean };

async function runNode(node: string, label: string, ctx: Ctx, out: string[]) {
  // E1 — capturar el nodo
  const capFile = await timed(`E1 captura ${label}`, async () => {
    if (ctx.dry) return join(CRUDO, `${label}.json`);
    const r = await sh(
      ["bun", "run", join(PIPELINE, "capture-bestsellers.ts"), "--node", node, "--pages", String(ctx.pages), "--label", label],
      ROOT,
    );
    const blocked = isBlocked(r.out);
    if (blocked) throw new Error(`bloqueo: ${blocked}`);
    if (r.code !== 0) throw new Error(`capture salió con ${r.code}`);
    console.log("  " + r.out.trim().split("\n").slice(-1)[0]);
    return join(CRUDO, `${label}.json`);
  });
  if (!capFile) return;

  // E1b — compuerta de categoría: ¿el puesto #50 todavía vende?
  const gate = await timed(`E1b compuerta ${label}`, async () => {
    if (ctx.dry) return { pass: true, line: "dry" };
    // Con --no-gate se recorre el nodo sin BSR: sirve para medir captura y frases
    // con cupo cero. No permite veredicto comercial.
    if (ctx.noGate) return { pass: true, line: "compuerta omitida (--no-gate): sin BSR" };
    const dbLabel = `bs:${label}`;
    const imp = await sh(
      ["bun", "run", join(PIPELINE, "capture-bestsellers.ts"), "--import", capFile, "--label", dbLabel],
      ROOT,
    );
    if (imp.code !== 0) throw new Error("import a la base falló");
    // El fondo de la lista no tiene ranking (son libros que no venden), así que la
    // compuerta mira el top 10: 10 fichas en vez de 60.
    const en = await enrichBsr(
      ["bsr.ts", "--keyword", dbLabel, "--max-position", "3", "--limit", "3", "--pause", "8000"],
      ctx,
    );
    if (en.code !== 0) throw new Error("enriquecimiento del nodo falló");
    console.log("  " + en.out.trim().split("\n").filter(Boolean).pop());
    const s = await sh(["bun", "run", join(PIPELINE, "capture-bestsellers.ts"), "--summary-db", dbLabel], ROOT);
    const line = s.out.trim().split("\n").filter(Boolean).pop() ?? "";
    console.log("  " + line);
    const pass = /PASA/.test(line) && !/NO PASA/.test(line);
    return { pass, line };
  });
  if (!gate) return;
  out.push(`**Compuerta de categoría:** ${gate.line}`);
  if (!gate.pass && ctx.autoVerify) {
    out.push("");
    out.push(`_Nodo sin compradores hasta la mitad: no se mina._`);
    out.push("");
    return;
  }
  if (!gate.pass) {
    out.push("_La compuerta numérica no pasó; se conserva E2 para que el agente inspeccione la evidencia antes de descartar._");
  }
  out.push("");

  // E1c — homogeneidad del estante. Mide; solo bloquea si se pide --min-coverage.
  const homo = await timed(`E1c homogeneidad ${label}`, async () => {
    if (ctx.dry) return { pass: true, coverage: 0, matches: 0, total: 0, theme: [] as string[] };
    const titles = titlesFromCapture(JSON.parse(readFileSync(capFile, "utf8")));
    const h = measureHomogeneity(titles, { threshold: ctx.minCoverage });
    console.log(
      `  cobertura ${h.coverage} (${h.matches}/${h.total}) · tema: ${h.theme.join(", ") || "—"} → ${h.pass ? "se mina" : "NO SE MINA"}`,
    );
    return h;
  });
  if (!homo) return;
  out.push(
    `**Estante:** cobertura ${homo.coverage} (${homo.matches}/${homo.total}) · tema: ${homo.theme.join(", ") || "—"}${ctx.minCoverage > 0 ? ` → ${homo.pass ? "se mina" : "**no se mina**"}` : ""}`,
  );
  out.push("");
  if (!homo.pass) {
    out.push(`_Cobertura ${homo.coverage} por debajo de --min-coverage ${ctx.minCoverage}. No se generan frases._`);
    out.push("");
    return;
  }

  // E2 — frases
  const phrases = await timed("E2 frases", async () => {
    if (ctx.dry) return [] as { phrase: string; books: number }[];
    const verbose = arg("verbose") ?? null;
    const extra = verbose ? [] : [];
    const r = await sh(["bun", "run", join(PIPELINE, "phrases.ts"), capFile, "--limit", "20", "--label", label, ...extra], ROOT);
    if (r.code !== 0) throw new Error("phrases falló");
    // stdout es parte de la evidencia que necesita el agente para decidir.
    process.stdout.write(r.out);
    const f = join(CRUDO, `phrases-${label}.json`);
    return JSON.parse(readFileSync(f, "utf8")).phrases as {
      phrase: string; books: number; lexicalSignal?: string;
      unusualWords?: string[]; evidenceTitles?: string[];
    }[];
  });
  if (!phrases) return;

  const novel = ledger.add(phrases as any, label);
  const repeatedHere = (phrases as any[]).length - novel.length;
  out.push(`## ${label} (nodo ${node})`);
  out.push("");
  out.push(
    `Capturado: ${existsSync(capFile) ? "sí" : "no"} · frases: ${(phrases as any[]).length} · nuevas: ${novel.length} · repetidas: ${repeatedHere}`,
  );
  if (novel.length) out.push(`Top: ${novel.slice(0, 5).map((p: any) => `\`${p.phrase}\` (${p.books})`).join(" · ")}`);
  out.push("");

  if (!ctx.autoVerify) {
    out.push("**Pausa de criterio:** E2 está completa. Revisar frases, señal léxica y títulos fuente; elegir cuáles merecen búsqueda. No se ejecutaron búsquedas E3 ni se aplicó clasificación temática automática.");
    out.push(`Evidencia completa: \`${join(CRUDO, `phrases-${label}.json`)}\` y \`${capFile}\`.`);
    out.push("");
    console.log("⏸ E2: entrega de evidencia al agente; E3 requiere decisión explícita (o --auto-verify).");
    return;
  }

  // E3/E4 — verificar y decidir
  const toVerify = novel.slice(0, ctx.verify);
  for (const p of toVerify) {
    const ok = await timed(`E3 ${p.phrase}`, async () => {
      if (ctx.dry) return true;
      const col = await sh(["bun", "run", join(PIPELINE, "capture-search.ts"), "--keyword", p.phrase], ROOT);
      const blocked = isBlocked(col.out);
      if (blocked) throw new Error(`bloqueo: ${blocked}`);
      if (col.code !== 0) throw new Error(`captura salió con ${col.code}`);
      // Pausa para no disparar el anti-bot de Amazon.
      await new Promise((r) => setTimeout(r, ctx.pause));
      const en = await enrichBsr(["bsr.ts", "--keyword", p.phrase, "--limit", "16", "--pause", "5000"]);
      if (en.code !== 0) throw new Error("enriquecimiento falló");
      return true;
    });
    if (!ok) {
      out.push(`- \`${p.phrase}\`: error en la verificación`);
      continue;
    }
    ledger.markVerified(p.phrase);

    const ev = await timed(`E4 ${p.phrase}`, async () => {
      const r = await sh(["bun", "run", join(PIPELINE, "apply.ts"), "--keyword", p.phrase, "--json-only", "--write"], ROOT);
      if (r.code === 2) throw new Error("sin captura para aplicar");
      const line = r.out.trim().split("\n").filter((l) => l.startsWith("{")).pop();
      if (!line) throw new Error("apply no devolvió JSON");
      const parsed = JSON.parse(line) as { verdict: string; coverage: number; mass: { mid: number }; gates: { id: string; pass: boolean }[]; keyword: string };
      // Señales descriptivas para revisión; no deciden por sí mismas.
      const metrics = await sh(["bun", "-e", `
        const {Database}=require("bun:sqlite");
        const db=new Database(${JSON.stringify(DB_PATH)},{readonly:true});
        const rows=db.query("select title, author, publisher, reviews, pub_date, sponsored from items i join runs r on r.id=i.run_id where r.kind='search' and r.keyword=? order by i.position limit 16").all(${JSON.stringify(p.phrase)});
        const n=${JSON.stringify(p.phrase)}.toLowerCase().split(" ").filter(Boolean);
        let hits=0; for(const r of rows){const t=" "+(r.title||"").toLowerCase().replace(/[^a-z0-9 ]/g," ")+" "; if(n.every(w=>t.includes(" "+w+" "))) hits++;}
        const authorCoverage = rows.length ? Math.round(rows.filter(r=>r.author && String(r.author).trim().length>2).length/rows.length*100)/100 : 0;
        const top10 = rows.slice(0,10);
        const averageReviewsTop10 = top10.length ? Math.round(top10.reduce((s,r)=>s+(r.reviews||0),0)/top10.length) : 0;
        const independentlyPublishedTop10 = top10.filter(r=>/independently published/i.test(r.publisher||"")).length;
        const sponsoredTop10 = top10.filter(r=>!!r.sponsored).length;
        const authorCounts = {};
        for(const r of top10){if(r.author){const a=String(r.author).trim(); authorCounts[a]=(authorCounts[a]||0)+1;}}
        const maxBooksBySameAuthor = Math.max(0,...Object.values(authorCounts));
        const distinctAuthorsTop10 = Object.keys(authorCounts).length;
        console.log(JSON.stringify({titleHits: hits, authorCoverage, averageReviewsTop10, independentlyPublishedTop10, sponsoredTop10, distinctAuthorsTop10, maxBooksBySameAuthor, authorsTop10: authorCounts}));
        db.close();
      `], ROOT);
      const diagnosticsLine = metrics.out.trim().split("\n").find((line) => line.startsWith("{"));
      parsed.diagnostics = diagnosticsLine ? JSON.parse(diagnosticsLine) : { unavailable: metrics.out.trim() };
      return parsed;
    });
    if (!ev) continue;
    const fails = ev.gates.filter((g) => !g.pass).map((g) => g.id).join(",") || "pasa";
    const m = (ev as any).diagnostics ?? {};
    const extra = m.titleHits != null ? ` · señales ${JSON.stringify(m)}` : "";
    out.push(`- \`${p.phrase}\`: **${ev.verdict}** · cob ${ev.coverage} · masa ${ev.mass.mid} · ${fails}${extra}`);

    // E5 — dossier solo si pasó
    if (ctx.e5 && ev.verdict === "pasa") {
      await timed(`E5 dossier ${p.phrase}`, async () => {
        if (ctx.dry) return true;
        const r = await sh(["bun", "run", "competitors", "--", p.phrase, "--top", "3"], LAB);
        if (isBlocked(r.out)) throw new Error("bloqueo en dossier");
        if (r.code !== 0) throw new Error(`dossier salió con ${r.code}: ${r.out.slice(-500)}`);
        process.stdout.write(r.out);
        return true;
      });
      out.push("  → dossier generado");
    }
  }
  out.push("");
}

// ─── main ────────────────────────────────────────────────────────────────────
if (import.meta.main) {
  const ctx: Ctx = {
    verify: Number(arg("verify") ?? 2),
    pages: Number(arg("pages") ?? 2),
    dry: has("dry"),
    // E5 aún usa el dossier legacy fuera del workspace; queda apagado salvo opt-in explícito.
    e5: has("legacy-e5"),
    noGate: has("no-gate"),
    minCoverage: Number(arg("min-coverage") ?? 0),
    pause: Number(arg("pause") ?? 5000),
    autoVerify: has("auto-verify"),
  };

  if (arg("plan")) {
    makePlan(Number(arg("plan")), Number(arg("seed") ?? 1));
    process.exit(0);
  }

  const planFile = arg("run-plan");
  const node = arg("node");
  const evalOnlyGuard = arg("eval-only");
  void evalOnlyGuard;
  if (!planFile && !node && !evalOnlyGuard) {
    console.error(`Uso:
  run.ts --node <id> [--pages 2] [--dry] [--legacy-e5] [--no-gate]
  run.ts --plan 25 [--seed 7]
  run.ts --run-plan <plan.json> [--auto-verify --verify 2]

Por defecto se detiene en E2 y entrega evidencia para el agente.
--auto-verify activa E3/E4 en lote sin selección previa del agente.`);
    process.exit(1);
  }

  const out: string[] = [];
  const startedAt = new Date().toISOString();
  if (ctx.e5) {
    console.warn("⚠ --legacy-e5 puede leer/escribir fuera de .amazon-business; verificar --tool-dir antes de continuar.");
  }

  const evalOnly = arg("eval-only");
  if (evalOnly) {
    const r = await sh(["bun", "run", join(PIPELINE, "apply.ts"), "--keyword", evalOnly, "--json-only", "--no-write"], ROOT);
    if (r.code !== 0) {
      console.error(`apply falló para "${evalOnly}"`);
      process.exit(2);
    }
    const ev = JSON.parse(r.out.trim().split("\n").filter((l) => l.startsWith("{")).pop()!);
    const fails = ev.gates.filter((g: any) => !g.pass).map((g: any) => g.id).join(",") || "pasa";
    console.log(`${ev.keyword} → ${ev.verdict} · cob ${ev.coverage} · masa ${ev.mass.mid} · ${fails}`);
    if (ctx.e5 && ev.verdict === "pasa") {
      await timed(`E5 dossier ${evalOnly}`, async () => {
        const c = await sh(["bun", "run", "competitors", "--", evalOnly, "--top", "3"], LAB);
        if (isBlocked(c.out)) throw new Error("bloqueo en dossier");
        if (c.code !== 0) throw new Error(`dossier salió con ${c.code}: ${c.out.slice(-500)}`);
        process.stdout.write(c.out);
        return true;
      });
    }
    process.exit(steps.some((s) => !s.ok) ? 1 : 0);
  }

  if (planFile) {
    const plan = JSON.parse(readFileSync(planFile, "utf8"));
    for (const n of plan.nodes ?? []) {
      await runNode(n.node, slug(`${n.parent}-${n.name}`), ctx, out);
    }
  } else if (node) {
    await runNode(node, arg("label") ?? `node-${node}`, ctx, out);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  // Varias corridas el mismo día no pueden compartir carpeta: la segunda borraría el
  // resumen de la primera. Se usa el primer nombre libre.
  let dir = join(CORRIDAS, `${stamp}-corrida`);
  for (let n = 2; existsSync(dir); n++) dir = join(CORRIDAS, `${stamp}-corrida-${n}`);
  const md = [
    `# Resumen de corrida — ${startedAt}`,
    "",
    "Enriquecimiento BSR: fichas de Amazon; sin proveedor externo.",
    "",
    `Frases: ${ledger.generated} generadas · ${ledger.repeated} repetidas entre nodos · ${ledger.unique} únicas · ${ledger.verified} verificadas`,
    "",
    "| Etapa | Estado | Tiempo |",
    "|---|---|---|",
    ...steps.map((s) => `| ${s.name} | ${s.ok ? "ok" : "**falló**"} | ${(s.ms / 1000).toFixed(1)} s |`),
    "",
    ...out,
  ].join("\n");
  if (ctx.dry) {
    console.log("\n(dry: no se escriben archivos de corrida)");
  } else {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "resumen.md"), md);
    writeFileSync(join(dir, "frases.json"), JSON.stringify(ledger.toJSON(), null, 2));
  }

  console.log(`\n═══ resumen ═══`);
  if (out.length) console.log(out.join("\n"));
  for (const s of steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.name} (${(s.ms / 1000).toFixed(1)}s)${s.note ? " — " + s.note : ""}`);
  if (!ctx.dry) console.log(`  ${join(dir, "resumen.md")}`);
  process.exit(steps.some((s) => !s.ok) ? 1 : 0);
}
