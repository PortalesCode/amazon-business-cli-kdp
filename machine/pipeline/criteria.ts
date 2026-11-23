import { existsSync, readFileSync } from "node:fs";
import type { GateThresholds } from "./types";
import { DEFAULT_THRESHOLDS } from "./gates";

const KEYS = Object.keys(DEFAULT_THRESHOLDS) as (keyof GateThresholds)[];

export function loadCriteria(path = process.env.EDITORIAL_CRITERIA_FILE): GateThresholds {
  if (!path || !existsSync(path)) return { ...DEFAULT_THRESHOLDS };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`Criterios inválidos o ilegibles: ${path}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Los criterios deben ser un objeto JSON: ${path}`);
  }
  const input = parsed as Record<string, unknown>;
  const unknown = Object.keys(input).filter((key) => !KEYS.includes(key as keyof GateThresholds));
  if (unknown.length) throw new Error(`Criterios desconocidos: ${unknown.join(", ")}`);

  const result = { ...DEFAULT_THRESHOLDS };
  for (const key of KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`El criterio ${key} debe ser un número finito no negativo.`);
    }
    result[key] = value;
  }
  for (const key of ["minAmplitude", "minOrganic"] as const) {
    if (!Number.isInteger(result[key])) throw new Error(`El criterio ${key} debe ser un entero.`);
  }
  return result;
}
