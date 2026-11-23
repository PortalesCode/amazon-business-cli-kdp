import type { Evaluation, GateResult, GateThresholds, PhraseInput, Row, Verdict } from "./types";
import { bsrBand, round } from "./units";
import { totalLabel } from "./total";

/** Workspace defaults; users can override them in .amazon-business/criteria.json. */
export const DEFAULT_THRESHOLDS: GateThresholds = {
  maxResults: 2_000,
  minAmplitude: 2,
  amplitudeBsr: 150_000,
  minOrganic: 3,
  organicBsr: 300_000,
  organicMinMonths: 18,
  organicMinReviews: 25,
  minMass: 30,
};

export function monthsBetween(fromIso: string, toIso: string): number | null {
  const a = new Date(fromIso);
  const b = new Date(toIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const ms = b.getTime() - a.getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.44);
}

function top(rows: Row[], n: number): Row[] {
  return [...rows]
    .filter((r) => r.position != null)
    .sort((a, b) => (a.position as number) - (b.position as number))
    .slice(0, n);
}

export function evaluate(
  input: PhraseInput,
  t: GateThresholds = DEFAULT_THRESHOLDS,
): Evaluation {
  const rows = input.rows;
  const sample16 = top(rows, 16);

  // C1 — saturación
  const c1Pass = input.totalResults != null && input.totalResults < t.maxResults;
  const c1: GateResult = {
    id: "C1",
    name: "Saturación",
    pass: c1Pass,
    value: totalLabel(input.totalResults, input.totalIsOver),
    threshold: `< ${t.maxResults.toLocaleString("en-US")}`,
    detail: input.totalResults == null ? "sin dato de resultados" : "resultados en Books",
  };

  // C2 — amplitud
  const amp = sample16.filter((r) => r.bsr != null && r.bsr < t.amplitudeBsr);
  const c2: GateResult = {
    id: "C2",
    name: "Amplitud",
    pass: amp.length >= t.minAmplitude,
    value: `${amp.length} de ${sample16.length}`,
    threshold: `≥ ${t.minAmplitude} con BSR < ${t.amplitudeBsr.toLocaleString("en-US")}`,
    detail: "más de un ganador en el top 16",
  };

  // C3 — demanda orgánica
  const organic = sample16.filter((r) => {
    if (r.bsr == null || r.bsr >= t.organicBsr) return false;
    if (r.reviews == null || r.reviews < t.organicMinReviews) return false;
    if (!r.pubDate) return false;
    const months = monthsBetween(r.pubDate, input.capturedAt);
    return months != null && months >= t.organicMinMonths;
  });
  const c3: GateResult = {
    id: "C3",
    name: "Demanda orgánica",
    pass: organic.length >= t.minOrganic,
    value: `${organic.length} de ${sample16.length}`,
    threshold: `≥ ${t.minOrganic} con BSR < ${t.organicBsr.toLocaleString("en-US")}, > ${t.organicMinMonths} meses, ≥ ${t.organicMinReviews} reseñas`,
    detail: organic.map((r) => r.asin ?? r.title?.slice(0, 24) ?? "?").join(", ") || "ninguno",
  };

  // C4 — masa
  const ten = top(rows, 10);
  let min = 0;
  let max = 0;
  let mid = 0;
  let measured = 0;
  for (const r of ten) {
    const band = bsrBand(r.bsr);
    if (!band) continue;
    measured++;
    min += band.min;
    max += band.max;
    mid += band.mid;
  }
  const c4: GateResult = {
    id: "C4",
    name: "Masa",
    pass: mid >= t.minMass,
    value: `${round(min)}–${round(max)} (medio ${round(mid)}) u/día`,
    threshold: `≥ ${t.minMass} u/día en el top 10`,
    detail: `${measured} de ${ten.length} títulos con BSR`,
  };

  const gates = [c1, c2, c3, c4];
  const [p1, p2, p3, p4] = gates.map((g) => g.pass);

  let verdict: Verdict;
  if (p1 && p2 && p3 && p4) verdict = "pasa";
  else if (p1 && p2 && !p3 && p4) verdict = "mercado-comprado";
  else if (p1 && p2 && p3 && !p4) verdict = "mercado-chico";
  else if (!p1 && p2 && p3 && p4) verdict = "saturado";
  else verdict = "descartar";

  // Cobertura de evidencia: qué proporción de la muestra tiene los datos que exige cada compuerta.
  const withBsr = ten.filter((r) => r.bsr != null).length;
  const withDate = sample16.filter((r) => r.pubDate).length;
  const blockers: string[] = [];
  let coverage = 10;
  if (input.totalResults == null) {
    coverage -= 3;
    blockers.push("Sin total de resultados: C1 no se puede aplicar.");
  }
  if (withBsr < 10) {
    coverage -= Math.min(4, (10 - withBsr) * 0.6);
    blockers.push(`Solo ${withBsr} de 10 con BSR: C4 subestimada.`);
  }
  if (withDate < 10) {
    coverage -= Math.min(3, (10 - withDate) * 0.4);
    blockers.push(`Solo ${withDate} de 16 con fecha: C3 subestimada.`);
  }
  if (input.currency && input.currency.toUpperCase() !== "USD") {
    coverage -= 2;
    blockers.push(`Moneda ${input.currency}: precios no comparables.`);
  }
  coverage = Math.max(0, Math.round(coverage * 10) / 10);

  return {
    keyword: input.keyword,
    capturedAt: input.capturedAt,
    currency: input.currency,
    sample: rows.length,
    totalResults: input.totalResults,
    totalIsOver: input.totalIsOver,
    gates,
    verdict,
    mass: { min: round(min), max: round(max), mid: round(mid), crosses: min < t.minMass && max >= t.minMass },
    coverage,
    blockers,
    criteria: { ...t },
  };
}
