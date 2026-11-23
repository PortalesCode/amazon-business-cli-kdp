import { test, expect } from "bun:test";
import { bookShareOf, classify, selectPhrases, titleHits } from "../classify";

const item = (author: string | null) => ({ author, title: "x" });

test("títulos que contienen la frase completa", () => {
  const titles = ["Dog Training for Beginners", "The Dog Training Manual", "Cat Care Guide"];
  expect(titleHits("dog training", titles)).toBe(2);
  expect(titleHits("dog training manual", titles)).toBe(1);
  expect(titleHits("horse riding", titles)).toBe(0);
});

test("la frase no cuenta si falta una palabra", () => {
  expect(titleHits("caregiver devotional", ["Devotional for Caregivers", "Caregiver's Guide"])).toBe(0);
});

test("proporción de resultados con autor", () => {
  expect(bookShareOf([item("Ana"), item("Beto")])).toBe(1);
  expect(bookShareOf([item("Ana"), item(null), item(null), item(null)])).toBe(0.25);
  expect(bookShareOf([])).toBe(0);
});

test("los cuatro veredictos", () => {
  expect(classify({ total: 300, maxTotal: 2000, bookShare: 0.9, titleHits: 6, sample: 16 })).toBe("candidata");
  expect(classify({ total: 5000, maxTotal: 2000, bookShare: 0.9, titleHits: 6, sample: 16 })).toBe("saturada");
  expect(classify({ total: 300, maxTotal: 2000, bookShare: 0.9, titleHits: 1, sample: 16 })).toBe("nombre-de-libro");
  expect(classify({ total: 300, maxTotal: 2000, bookShare: 0.1, titleHits: 6, sample: 16 })).toBe("no-es-libro");
});

test("pocos títulos con la frase no alcanza: hace falta 20%", () => {
  // 3 de 16 = 18,75% → nombre de libro, aunque tenga resultados bajos.
  expect(classify({ total: 300, maxTotal: 2000, bookShare: 0.9, titleHits: 3, sample: 16 })).toBe("nombre-de-libro");
  // 4 de 16 = 25% → candidata.
  expect(classify({ total: 300, maxTotal: 2000, bookShare: 0.9, titleHits: 4, sample: 16 })).toBe("candidata");
});

test("las frases con palabra de producto se descartan", () => {
  const suggestions = [
    { seed: "a", value: "solar system art decor", position: 0 },
    { seed: "a", value: "south pole jeans baggy", position: 0 },
    { seed: "a", value: "solar system for kids", position: 0 },
  ];
  const picked = selectPhrases(suggestions, { total: 5 }).map((p) => p.phrase.toLowerCase());
  expect(picked).toContain("solar system for kids");
  expect(picked.some((p) => p.includes("decor"))).toBe(false);
  expect(picked.some((p) => p.includes("jeans"))).toBe(false);
});

test("sin total no puede ser candidata", () => {
  expect(classify({ total: null, maxTotal: 2000, bookShare: 0.9, titleHits: 6, sample: 16 })).toBe("saturada");
});

test("la selección descarta años, best sellers y frases de una palabra", () => {
  const suggestions = [
    { seed: "a", value: "dog training", position: 0 },
    { seed: "a", value: "dog training 2026", position: 1 },
    { seed: "a", value: "dog training best sellers", position: 2 },
    { seed: "a", value: "dogs", position: 3 },
    { seed: "a", value: "dog training for puppies", position: 4 },
  ];
  const picked = selectPhrases(suggestions, { total: 10 });
  const phrases = picked.map((p) => p.phrase.toLowerCase());
  expect(phrases).toContain("dog training");
  expect(phrases).toContain("dog training for puppies");
  expect(phrases.some((p) => p.includes("2026"))).toBe(false);
  expect(phrases.some((p) => p.includes("best sellers"))).toBe(false);
  expect(phrases).not.toContain("dogs");
});

test("la selección mezcla amplias y específicas sin repetir", () => {
  const suggestions = [
    { seed: "a", value: "dog training", position: 0 },
    { seed: "b", value: "dog training", position: 0 },
    { seed: "c", value: "dog training", position: 0 },
    { seed: "a", value: "dog training senior dogs", position: 0 },
    { seed: "a", value: "dog training puppies home", position: 0 },
  ];
  const picked = selectPhrases(suggestions, { total: 4 });
  const keys = picked.map((p) => p.phrase.toLowerCase());
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys).toContain("dog training");
  expect(keys.some((k) => k.split(" ").length >= 4)).toBe(true);
});
