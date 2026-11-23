/**
 * Banda BSR -> unidades/día. Tabla de Lab/Departamento-de-Investigacion/metricas.md.
 * Inferencia, no medición: se devuelve rango y punto medio.
 */
export type Band = { min: number; max: number; mid: number };

const BANDS: Array<{ upTo: number; min: number; max: number }> = [
  { upTo: 10_000, min: 15, max: 25 },
  { upTo: 50_000, min: 5, max: 15 },
  { upTo: 100_000, min: 2, max: 5 },
  { upTo: 300_000, min: 0.5, max: 2 },
  { upTo: 1_000_000, min: 0.1, max: 0.5 },
  { upTo: Infinity, min: 0, max: 0.1 },
];

export function bsrBand(bsr: number | null): Band | null {
  if (bsr == null || !Number.isFinite(bsr) || bsr <= 0) return null;
  for (const b of BANDS) {
    if (bsr < b.upTo) return { min: b.min, max: b.max, mid: round((b.min + b.max) / 2, 3) };
  }
  return null;
}

export function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
