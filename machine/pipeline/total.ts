/**
 * Parseo del texto de total de resultados que devuelve Amazon.
 * Formas reales capturadas:
 *   "1 a 16 de 151 resultados para \"x\""
 *   "1 a 16 de más de 9,000 resultados para \"x\""
 *   "1-16 of over 2,000 results for \"x\""
 */
export function parseTotal(text: string | null | undefined): {
  total: number | null;
  isOver: boolean;
} {
  if (!text) return { total: null, isOver: false };
  const isOver = /m[áa]s de|over/i.test(text);
  const m = text.match(/([\d.,]{1,15})\s*(resultado|result)/i);
  if (!m) return { total: null, isOver };
  const digits = m[1].replace(/[.,]/g, "");
  const n = Number(digits);
  return { total: Number.isFinite(n) ? n : null, isOver };
}

/** "más de 9,000" no es 9.000 exactos: el valor real puede ser mayor. */
export function totalLabel(total: number | null, isOver: boolean): string {
  if (total == null) return "sin dato";
  return isOver ? `> ${total.toLocaleString("en-US")}` : total.toLocaleString("en-US");
}
