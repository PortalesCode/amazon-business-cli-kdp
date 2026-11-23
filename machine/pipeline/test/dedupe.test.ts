import { test, expect } from "bun:test";
import { PhraseLedger, phraseKey } from "../dedupe";

test("la clave normaliza mayúsculas, acentos y plural", () => {
  expect(phraseKey("Brain Games")).toBe(phraseKey("brain game"));
  expect(phraseKey("Guía de Perros")).toBe(phraseKey("guia de perro"));
  expect(phraseKey("  dog   training  ")).toBe("dog training");
});

test("una frase repetida entre nodos se verifica una sola vez", () => {
  const ledger = new PhraseLedger();
  const a = ledger.add(
    [
      { phrase: "brain games", books: 5 },
      { phrase: "dog training", books: 3 },
    ],
    "pets",
  );
  const b = ledger.add(
    [
      { phrase: "Brain Game", books: 4 },
      { phrase: "off grid", books: 3 },
    ],
    "crafts",
  );

  expect(a.map((h) => h.phrase)).toEqual(["brain games", "dog training"]);
  expect(b.map((h) => h.phrase)).toEqual(["off grid"]);
  expect(ledger.generated).toBe(4);
  expect(ledger.repeated).toBe(1);
  expect(ledger.unique).toBe(3);
});

test("conserva todos los nodos que originaron la frase", () => {
  const ledger = new PhraseLedger();
  ledger.add([{ phrase: "brain games", books: 5 }], "pets");
  ledger.add([{ phrase: "brain games", books: 4 }], "crafts");
  ledger.add([{ phrase: "brain games", books: 2 }], "health");

  const entry = ledger.toJSON().phrases.find((p) => p.phrase === "brain games")!;
  expect(entry.origins).toEqual(["pets", "crafts", "health"]);
});

test("no duplica el origen si el mismo nodo repite la frase", () => {
  const ledger = new PhraseLedger();
  ledger.add([{ phrase: "brain games", books: 5 }], "pets");
  ledger.add([{ phrase: "brain games", books: 3 }], "pets");
  const entry = ledger.toJSON().phrases.find((p) => p.phrase === "brain games")!;
  expect(entry.origins).toEqual(["pets"]);
  expect(ledger.repeated).toBe(1);
});

test("marca verificadas y cuenta solo las que llegaron", () => {
  const ledger = new PhraseLedger();
  ledger.add(
    [
      { phrase: "brain games", books: 5 },
      { phrase: "off grid", books: 3 },
    ],
    "pets",
  );
  ledger.markVerified("brain games");
  const json = ledger.toJSON();
  expect(json.verified).toBe(1);
  expect(json.phrases.find((p) => p.phrase === "brain games")!.verified).toBe(true);
  expect(json.phrases.find((p) => p.phrase === "off grid")!.verified).toBe(false);
});
