/**
 * Deduplicación de frases dentro de una corrida (no entre corridas, no en la base).
 *
 * Problema: cada nodo produce sus propios n-gramas. Dos nodos distintos pueden generar
 * la misma frase ("brain games" aparece en Pets y en Crafts) y el pipeline la verificaría
 * dos veces y duplicando las consultas a Amazon.
 *
 * Reglas:
 *  - la clave normaliza mayúsculas, acentos, puntuación y singular/plural;
 *  - no altera la extracción original: recibe las frases ya extraídas por `ngram.ts`;
 *  - conserva el origen: cada frase acumula todos los nodos que la produjeron;
 *  - solo deduplica dentro de la corrida en curso.
 */
import { tokenize } from "./ngram";

export type PhraseHit = { phrase: string; books: number };

export function phraseKey(phrase: string): string {
  return tokenize(phrase).map((t) => t.norm).join(" ");
}

export class PhraseLedger {
  private seen = new Map<string, { phrase: string; origins: string[]; verified: boolean }>();
  generated = 0;
  repeated = 0;
  verified = 0;

  /**
   * Registra las frases de un nodo y devuelve solo las que no se habían visto.
   * El orden de las novelas se conserva.
   */
  add(hits: PhraseHit[], origin: string): PhraseHit[] {
    this.generated += hits.length;
    const novel: PhraseHit[] = [];
    for (const hit of hits) {
      const key = phraseKey(hit.phrase);
      const prev = this.seen.get(key);
      if (prev) {
        this.repeated++;
        if (!prev.origins.includes(origin)) prev.origins.push(origin);
        continue;
      }
      this.seen.set(key, { phrase: hit.phrase, origins: [origin], verified: false });
      novel.push(hit);
    }
    return novel;
  }

  markVerified(phrase: string): void {
    const entry = this.seen.get(phraseKey(phrase));
    if (entry) entry.verified = true;
    this.verified++;
  }

  get unique(): number {
    return this.seen.size;
  }

  /** Trazabilidad: qué frase salió de qué nodos y si llegó a verificarse. */
  toJSON() {
    return {
      generated: this.generated,
      repeated: this.repeated,
      unique: this.unique,
      verified: this.verified,
      phrases: [...this.seen.values()].map((v) => ({
        phrase: v.phrase,
        origins: v.origins,
        verified: v.verified,
      })),
    };
  }
}
