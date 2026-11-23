import { test, expect } from "bun:test";
import { parseTotal, totalLabel } from "../total";

test("parsea total exacto en español", () => {
  expect(parseTotal('1 a 16 de 151 resultados para "x"')).toEqual({ total: 151, isOver: false });
});

test("parsea 'más de' como cota inferior", () => {
  expect(parseTotal('1 a 16 de más de 9,000 resultados para "x"')).toEqual({ total: 9000, isOver: true });
});

test("parsea total en inglés", () => {
  expect(parseTotal('1-16 of over 2,000 results for "x"')).toEqual({ total: 2000, isOver: true });
  expect(parseTotal('1-16 of 1,234 results for "x"')).toEqual({ total: 1234, isOver: false });
});

test("sin texto devuelve null y no explota", () => {
  expect(parseTotal(null)).toEqual({ total: null, isOver: false });
  expect(parseTotal("")).toEqual({ total: null, isOver: false });
});

test("etiqueta distingue cota inferior de exacto", () => {
  expect(totalLabel(151, false)).toBe("151");
  expect(totalLabel(9000, true)).toBe("> 9,000");
  expect(totalLabel(null, false)).toBe("sin dato");
});
