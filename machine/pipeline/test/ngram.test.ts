import { test, expect } from "bun:test";
import { extractNgrams, extractNgramsAudit, singularize, tokenize } from "../ngram";

test("singulariza sin romper palabras cortas", () => {
  expect(singularize("dogs")).toBe("dog");
  expect(singularize("puppies")).toBe("puppy");
  expect(singularize("care")).toBe("care");
  expect(singularize("glass")).toBe("glass");
});

test("tokeniza sin acentos ni puntuación", () => {
  expect(tokenize("Guía: Cuidado de Perros").map((t) => t.lit)).toEqual(["guia", "cuidado", "de", "perros"]);
});

test("une la misma frase escrita en plural y singular", () => {
  const out = extractNgrams(["Dog Training Basics", "dog trainings basics"]);
  const hit = out.find((n) => n.key === "dog training basic");
  expect(hit).toBeDefined();
  expect(hit!.books).toBe(2);
});

test("conserva la stopword interna y no abre ni cierra con ella", () => {
  const out = extractNgrams([
    "Mental Exercises for Dogs: 60 Brain Games",
    "Mental Exercises for Dogs Made Easy",
    "Brain Games for Dogs",
  ]);
  const phrases = out.map((n) => n.phrase);
  expect(phrases).toContain("mental exercises for dogs");
  expect(phrases.some((p) => p.startsWith("for ") || p.endsWith(" for"))).toBe(false);
  expect(phrases).not.toContain("exercises for dogs"); // redundante con la de 4 palabras
});

test("las palabras de formato no generan n-gramas", () => {
  const out = extractNgrams(["The Complete Guide to Beekeeping", "A Complete Guide to Beekeeping"]);
  expect(out.map((n) => n.phrase)).not.toContain("complete guide");
  expect(out.map((n) => n.phrase)).not.toContain("guide to beekeeping");
});

test("descarta n-gramas con números sueltos", () => {
  const out = extractNgrams(["101 Hidden Tips for Rabbits", "101 Hidden Secrets for Rabbits"]);
  expect(out.some((n) => n.phrase.includes("101"))).toBe(false);
});

test("un n-grama visto en un solo libro no aparece con minBooks=2", () => {
  const out = extractNgrams(["Unique Phrase About Llamas", "Other Title Entirely"]);
  expect(out.find((n) => n.key === "unique phrase")).toBeUndefined();
});

test("los productos de temporada y bajo contenido no pasan como nicho", () => {
  const out = extractNgrams([
    "Dog Page a Day Calendar",
    "Cat Wall Calendar 2027",
    "Paint by Sticker Cats",
    "Adult Coloring Book Cats",
    "Brain Games for Dogs",
    "Brain Games for Cats",
  ]);
  const phrases = out.map((n) => n.phrase);
  expect(phrases.some((p) => p.includes("calendar"))).toBe(false);
  expect(phrases.some((p) => p.includes("sticker"))).toBe(false);
  expect(phrases.some((p) => p.includes("coloring"))).toBe(false);
  expect(phrases).toContain("brain games");
});

test("auditoría conserva con motivos los n-gramas que la regla ocultaría", () => {
  const audit = extractNgramsAudit([
    "Rabbit care guide for beginners",
    "Rabbit care guide for beginners",
  ]);
  const excluded = audit.excluded.find((item) => item.phrase === "care guide");
  expect(excluded).toBeDefined();
  expect(excluded?.books).toBe(2);
  expect(excluded?.exclusionReasons).toContain("format_boundary");
  expect(audit.accepted.some((item) => item.phrase === "rabbit care")).toBe(true);
});
