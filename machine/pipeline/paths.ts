/**
 * Rutas de la máquina.
 *
 * El motor vive en cli-amazon-business; la data y la base viven fuera del paquete.
 *
 *   EDITORIAL_DATA_DIR   carpeta de data del workspace (.amazon-business/data)
 *   EDITORIAL_TOOL_DIR   herramienta legacy requerida solo para el dossier E5
 */
import { join, resolve } from "node:path";

export const DATA_ROOT = process.env.EDITORIAL_DATA_DIR
  ? resolve(process.env.EDITORIAL_DATA_DIR)
  : resolve(process.cwd(), ".amazon-business", "data");

/** Capturas de Amazon: árbol, nodos, frases, cruces, planes. */
export const AMAZON = join(DATA_ROOT, "amazon");
/** Búsquedas reales capturadas del autocompletar. */
export const AUTOCOMPLETE = join(DATA_ROOT, "autocomplete");
/** Resúmenes y briefs por corrida. */
export const CORRIDAS = join(DATA_ROOT, "corridas");
/** Herramienta legacy invocada por E5; el motor CLI no guarda su DB acá. */
export const TOOL = process.env.EDITORIAL_TOOL_DIR
  ? resolve(process.env.EDITORIAL_TOOL_DIR)
  : resolve(process.cwd(), "Lab/Departamento-de-Investigacion/Machine/kdp-extension-chromium");
/** Base aislada del workspace. */
export const DB_PATH = join(DATA_ROOT, "kdp-market-lab.sqlite");
