import type { Evaluation, Row } from "./types";
import { bsrBand, round } from "./units";
import { totalLabel } from "./total";

const VERDICT_LABEL: Record<Evaluation["verdict"], string> = {
  pasa: "PASA — hueco",
  "mercado-comprado": "MERCADO COMPRADO — hay demanda, se paga con ads",
  "mercado-chico": "MERCADO CHICO — no llega a 1–2 ventas/día",
  saturado: "SATURADO — solo con ángulo de segmento",
  descartar: "DESCARTAR",
};

function money(n: number | null, currency: string | null): string {
  if (n == null) return "—";
  return `${currency ?? ""} ${n.toFixed(2)}`.trim();
}

function pct(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo];
  return s[lo] + (s[hi] - s[lo]) * (idx - lo);
}

export function renderAnalysis(ev: Evaluation, rows: Row[]): string {
  const prices = rows.map((r) => r.price).filter((p): p is number => p != null && p > 0);
  const reviews = rows.map((r) => r.reviews).filter((p): p is number => p != null);
  const bsrs = rows.map((r) => r.bsr).filter((p): p is number => p != null);

  const lines: string[] = [];
  lines.push(`# Brief de nicho — \`${ev.keyword}\``);
  lines.push("");
  lines.push(`**Captura:** ${ev.capturedAt}`);
  lines.push(`**Mercado:** Books · ${ev.currency ?? "moneda sin dato"}`);
  lines.push(`**Veredicto:** **${VERDICT_LABEL[ev.verdict]}**`);
  lines.push(`**Cobertura de evidencia:** ${ev.coverage}/10`);
  lines.push("");

  lines.push("## Compuertas");
  lines.push("");
  lines.push("| # | Compuerta | Umbral | Medido | Resultado |");
  lines.push("|---|---|---|---|---|");
  for (const g of ev.gates) {
    lines.push(`| ${g.id} | ${g.name} | ${g.threshold} | ${g.value} | ${g.pass ? "pasa" : "**falla**"} |`);
  }
  if (ev.mass.crosses) {
    lines.push("");
    lines.push(
      `> C4 está en el borde: el rango (${ev.mass.min}–${ev.mass.max}) cruza el umbral de 30. Se marca **observar**, no descartar por esto solo.`,
    );
  }
  lines.push("");

  lines.push("## Números");
  lines.push("");
  lines.push("| Métrica | Valor | Etiqueta |");
  lines.push("|---|---|---|");
  lines.push(`| Resultados en Books | ${totalLabel(ev.totalResults, ev.totalIsOver)} | observación |`);
  lines.push(`| Filas capturadas | ${ev.sample} | observación |`);
  lines.push(`| Mediana de BSR | ${pct(bsrs, 0.5) ?? "—"} | observación |`);
  lines.push(`| Mediana de reseñas | ${pct(reviews, 0.5) ?? "—"} | observación |`);
  lines.push(`| Precio p25 / mediana / p75 | ${pct(prices, 0.25) ?? "—"} / ${pct(prices, 0.5) ?? "—"} / ${pct(prices, 0.75) ?? "—"} | observación |`);
  lines.push(`| Masa del top 10 | ${ev.mass.min}–${ev.mass.max} u/día (medio ${ev.mass.mid}) | inferencia |`);
  lines.push("");

  lines.push("## Top 16");
  lines.push("");
  lines.push("| # | ASIN | Título | Fecha | Precio | Reseñas | BSR | u/día |");
  lines.push("|---|---|---|---|---|---|---|---|");
  const sixteen = [...rows]
    .filter((r) => r.position != null)
    .sort((a, b) => (a.position as number) - (b.position as number))
    .slice(0, 16);
  for (const r of sixteen) {
    const band = bsrBand(r.bsr);
    const units = band ? `${round(band.min)}–${round(band.max)}` : "—";
    const title = (r.title ?? "—").replace(/[|\n]/g, " ").slice(0, 60);
    lines.push(
      `| ${r.position} | ${r.asin ?? "—"} | ${title} | ${r.pubDate ?? "—"} | ${money(r.price, ev.currency)} | ${r.reviews ?? "—"} | ${r.bsr ?? "—"} | ${units} |`,
    );
  }
  lines.push("");

  lines.push("## Qué falta");
  lines.push("");
  if (ev.blockers.length) {
    for (const b of ev.blockers) lines.push(`- ${b}`);
  } else {
    lines.push("- Nada bloqueante en la muestra.");
  }
  lines.push("");
  lines.push("## Qué cambiaría el veredicto");
  lines.push("");
  lines.push(changeLine(ev));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("_Generado por `Lab/Departamento-de-Investigacion/Machine/pipeline/apply.ts`. Las cifras de BSR son inferencia, no ventas._");
  lines.push("");
  return lines.join("\n");
}

function changeLine(ev: Evaluation): string {
  const failed = ev.gates.filter((g) => !g.pass);
  if (!failed.length) {
    return "- Si el dossier muestra que los tres libros orgánicos son el mismo autor o el mismo sello, el nicho es un duopolio y se descarta.";
  }
  return failed
    .map((g) => {
      switch (g.id) {
        case "C1":
          return `- C1: haría falta un subnicho real (no una frase más larga) que baje de ${g.threshold.replace("< ", "")} resultados manteniendo la demanda.`;
        case "C2":
          return "- C2: haría falta un segundo ganador. Uno solo puede ser marca o tráfico externo.";
        case "C3":
          return `- C3: haría falta un libro viejo que siga vendiendo. Hoy hay ${g.value}: demanda comprada, no estructural.`;
        case "C4":
          return `- C4: haría falta más masa (${g.value}). Con este mercado, un libro nuevo no llega a 1–2/día.`;
        default:
          return "- —";
      }
    })
    .join("\n");
}
