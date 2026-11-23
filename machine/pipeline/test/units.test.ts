import { test, expect } from "bun:test";
import { bsrBand } from "../units";

test("bandas de la tabla de métricas", () => {
  expect(bsrBand(5_000)).toEqual({ min: 15, max: 25, mid: 20 });
  expect(bsrBand(30_000)).toEqual({ min: 5, max: 15, mid: 10 });
  expect(bsrBand(86_964)).toEqual({ min: 2, max: 5, mid: 3.5 });
  expect(bsrBand(243_573)).toEqual({ min: 0.5, max: 2, mid: 1.25 });
  expect(bsrBand(544_401)).toEqual({ min: 0.1, max: 0.5, mid: 0.3 });
  expect(bsrBand(2_000_000)).toEqual({ min: 0, max: 0.1, mid: 0.05 });
});

test("BSR inválido no produce banda", () => {
  expect(bsrBand(null)).toBeNull();
  expect(bsrBand(0)).toBeNull();
  expect(bsrBand(-5)).toBeNull();
  expect(bsrBand(Number.NaN)).toBeNull();
});
