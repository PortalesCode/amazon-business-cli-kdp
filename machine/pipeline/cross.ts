#!/usr/bin/env bun
/**
 * Cruce automático: lo que la gente escribe × lo que hay en el catálogo.
 *
 *   bun run machine/pipeline/cross.ts --plan <plan.json> --verify 60
 *   bun run machine/pipeline/cross.ts --seeds-file seeds.txt --verify 30
 *
 * Toma semillas (nombres de nodos del plan + frases de sus capturas), pregunta el
 * autocompletar de Amazon, selecciona frases y verifica cada una con una búsqueda.
 * Escribe un resumen con el embudo y la lista corta. Sin API, sin navegador.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AMAZON, AUTOCOMPLETE, CORRIDAS } from "./paths";
import { fetchSuggestions } from "./autocomplete";
import { fetchAndExtract, pause } from "./http";
import { parseTotal } from "./total";
import { bookShareOf, classify, selectPhrases, titleHits } from "./classify";
import { buildPhrases } from "./phrases";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (n: string) => process.argv.includes(`--${n}`);
const slug = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

type PlanNode = { node: string; name: string; parent: string };

function planNodes(): PlanNode[] {
  const file = arg("plan");
  if (file) {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return (data.nodes ?? []).map((n: any) => ({ node: n.node, name: n.name, parent: n.parent }));
  }
  const tree = join(AMAZON, "arbol-books.json");
  if (!existsSync(tree)) return [];
  const data = JSON.parse(readFileSync(tree, "utf8"));
  const out: PlanNode[] = [];
  for (const root of data.nodes ?? []) {
    for (const child of root.children ?? []) out.push({ node: child.node, name: child.name, parent: root.name });
  }
  return out;
}

/** Semillas: el nombre del estante y las frases más frecuentes de sus títulos. */
function seedsFromPlan(
  nodes: PlanNode[],
  perNode = 5,
  withShelves = false,
): { seeds: string[]; origin: Record<string, string> } {
  const seeds: string[] = [];
  const origin: Record<string, string> = {};
  const seen = new Set<string>();
  const push = (s: string, from: string) => {
    const clean = s.replace(/\s+/g, " ").trim();
    const k = clean.toLowerCase();
    if (!clean || seen.has(k) || clean.length < 4) return;
    seen.add(k);
    seeds.push(clean);
    origin[clean] = from;
  };

  for (const n of nodes) {
    // El nombre del estante, aunque sea una consulta simple, devuelve productos
    // ("solar system" → "solar system underwear 3t"). Por eso no se usa por defecto.
    if (withShelves) push(n.name, `estante:${n.parent}`);
    const file = join(AMAZON, `${slug(`${n.parent}-${n.name}`)}.json`);
    if (!existsSync(file)) continue;
    try {
      const { phrases } = buildPhrases(JSON.parse(readFileSync(file, "utf8")), { limit: perNode });
      for (const p of phrases) push(p.phrase, `título:${n.name}`);
    } catch {}
  }
  return { seeds, origin };
}

async function main() {
  const nodes = planNodes();
  if (!nodes.length) {
    console.error("No hay nodos. Pasá --plan <plan.json> o generá el árbol con --tree.");
    process.exit(1);
  }

  const seedsFile = arg("seeds-file");
  const { seeds: autoSeeds, origin } = seedsFromPlan(
    nodes,
    Number(arg("per-node") ?? 5),
    has("with-shelves"),
  );
  const fileSeeds = seedsFile ? readFileSync(seedsFile, "utf8").split("\n").map((s) => s.trim()).filter(Boolean) : [];
  const seeds = [...new Set([...autoSeeds, ...fileSeeds])].slice(0, Number(arg("seeds-limit") ?? 600));

  const expandTop = Number(arg("expand-top") ?? 0);
  const verifyN = Number(arg("verify") ?? 60);
  const maxTotal = Number(arg("max") ?? 2000);
  const pauseMs = Number(arg("pause") ?? 900);

  console.log(`semillas: ${seeds.length} · a expandir por alfabeto: ${expandTop} · a verificar: ${verifyN}`);

  // 1. Autocompletar
  const suggestions: { seed: string; value: string; position: number }[] = [];
  for (const seed of seeds) {
    const values = await fetchSuggestions(seed);
    values.forEach((value, position) => suggestions.push({ seed, value, position }));
    await pause(90);
  }
  // Solo se expande por alfabeto un tema específico (3+ palabras). Expandir
  // "solar system" letra por letra devuelve modelo orbital, inverter y ropa interior.
  const expandable = seeds.filter(
    (s) => (origin[s] ?? "").startsWith("título:") && s.trim().split(/\s+/).length >= 3,
  );
  console.log(`semillas ampliables (vienen de títulos): ${expandable.length}`);
  for (const seed of expandable.slice(0, expandTop)) {
    for (const letter of "abcdefghijklmnopqrstuvwxyz") {
      const values = await fetchSuggestions(`${seed} ${letter}`);
      values.forEach((value, position) => suggestions.push({ seed, value, position }));
      await pause(70);
    }
  }
  // Un nombre de categoría no es una búsqueda: si la sugerencia es igual al nombre
  // del estante, se descarta.
  const nodeNames = new Set(nodes.map((n) => n.name.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim()));
  for (let i = suggestions.length - 1; i >= 0; i--) {
    const k = suggestions[i].value.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    if (nodeNames.has(k) || /&/.test(suggestions[i].value)) suggestions.splice(i, 1);
  }

  const unique = new Set(suggestions.map((s) => s.value.toLowerCase()));
  console.log(`sugerencias: ${suggestions.length} · únicas: ${unique.size}`);

  // 2. Selección y verificación
  const picked = selectPhrases(suggestions, { total: verifyN, maxTotal });
  console.log(`seleccionadas: ${picked.length}\n`);

  const rows: any[] = [];
  let stopped: string | null = null;

  for (const c of picked) {
    const url = `https://www.amazon.com/s?k=${encodeURIComponent(c.phrase)}&i=stripbooks`;
    const { data, blocked } = await fetchAndExtract(url);
    if (blocked) {
      stopped = blocked;
      break;
    }
    const parsed = parseTotal(data?.totalResultsText ?? null);
    const items = (data?.items ?? []).slice(0, 16);
    const titles = items.map((i: any) => String(i.title ?? ""));
    const share = bookShareOf(items);
    const hits = titleHits(c.phrase, titles);
    const verdict = classify({ total: parsed.total, maxTotal, bookShare: share, titleHits: hits, sample: titles.length });
    rows.push({
      phrase: c.phrase,
      agreement: c.agreement,
      words: c.words,
      total: parsed.total,
      isOver: parsed.isOver,
      bookShare: share,
      titleHits: hits,
      sample: titles.length,
      verdict,
      from: origin[c.phrase] ?? "autocompletar",
    });
    console.log(`${verdict.padEnd(15)} ${String(parsed.total ?? "?").padStart(7)} res · ${String(hits).padStart(2)}/16 títulos · libros ${Math.round(share * 100)}%  ${c.phrase}`);
    await pause(pauseMs + Math.floor(Math.random() * 400));
  }

  // 3. Orden y resumen
  const rank: Record<string, number> = { candidata: 0, "nombre-de-libro": 1, "no-es-libro": 2, saturada: 3 };
  rows.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (a.total ?? 1e9) - (b.total ?? 1e9) || b.agreement - a.agreement);

  const stamp = new Date().toISOString().slice(0, 10);
  let dir = join(CORRIDAS, `${stamp}-cross`);
  for (let n = 2; existsSync(dir); n++) dir = join(CORRIDAS, `${stamp}-cross-${n}`);
  mkdirSync(dir, { recursive: true });

  const count = (v: string) => rows.filter((r) => r.verdict === v).length;
  const funnel = {
    nodos: nodes.length,
    semillas: seeds.length,
    sugerencias: suggestions.length,
    unicas: unique.size,
    seleccionadas: picked.length,
    verificadas: rows.length,
    candidatas: count("candidata"),
    nombres: count("nombre-de-libro"),
    noLibros: count("no-es-libro"),
    saturadas: count("saturada"),
    stopped,
  };

  writeFileSync(join(dir, "cruce.json"), JSON.stringify({ createdAt: new Date().toISOString(), funnel, rows }, null, 2));

  const md = [
    `# Cruce — ${new Date().toISOString()}`,
    "",
    "| Etapa | Cantidad |",
    "|---|---|",
    `| Nodos | ${funnel.nodos} |`,
    `| Semillas | ${funnel.semillas} |`,
    `| Sugerencias | ${funnel.sugerencias} |`,
    `| Únicas | ${funnel.unicas} |`,
    `| Verificadas | ${funnel.verificadas} |`,
    `| Candidatas | **${funnel.candidatas}** |`,
    `| Nombres de libro | ${funnel.nombres} |`,
    `| No son libros | ${funnel.noLibros} |`,
    `| Saturadas | ${funnel.saturadas} |`,
    "",
    "## Candidatas",
    "",
    "| Frase | Resultados | Títulos | Libros | Acuerdo | Origen |",
    "|---|---|---|---|---|---|",
    ...rows.filter((r) => r.verdict === "candidata").map(
      (r) => `| \`${r.phrase}\` | ${r.total} | ${r.titleHits}/16 | ${Math.round(r.bookShare * 100)}% | ${r.agreement} | ${r.from} |`,
    ),
    "",
    "## Todas",
    "",
    "| Frase | Veredicto | Resultados | Títulos | Libros |",
    "|---|---|---|---|---|",
    ...rows.map((r) => `| \`${r.phrase}\` | ${r.verdict} | ${r.total ?? "—"} | ${r.titleHits}/16 | ${Math.round(r.bookShare * 100)}% |`),
    "",
    stopped ? `**CORTADO:** ${stopped}` : "_Corrida completa._",
    "",
  ].join("\n");
  writeFileSync(join(dir, "resumen.md"), md);

  console.log(
    `\nembudo: ${funnel.semillas} semillas → ${funnel.unicas} únicas → ${funnel.seleccionadas} seleccionadas → ${funnel.verificadas} verificadas`,
  );
  console.log(`  candidatas ${funnel.candidatas} · nombres ${funnel.nombres} · no-libros ${funnel.noLibros} · saturadas ${funnel.saturadas}`);
  console.log(`\n=== candidatas: ${funnel.candidatas} de ${rows.length} ===`);
  for (const r of rows.filter((x) => x.verdict === "candidata").slice(0, 20)) {
    console.log(`  ${String(r.total).padStart(5)} res · ${r.titleHits}/16 títulos · ${r.phrase}`);
  }
  if (stopped) console.log(`CORTADO: ${stopped}`);
  console.log(`resumen: ${join(dir, "resumen.md")}`);
}

await main();
