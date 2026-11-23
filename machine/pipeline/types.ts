export type Row = {
  asin: string | null;
  position: number | null;
  title: string | null;
  subtitle: string | null;
  bsr: number | null;
  pubDate: string | null;
  reviews: number | null;
  price: number | null;
  pages: number | null;
  sponsored: boolean;
};

export type PhraseInput = {
  keyword: string;
  totalResults: number | null;
  totalIsOver: boolean;
  currency: string | null;
  capturedAt: string;
  rows: Row[];
};

export type GateThresholds = {
  maxResults: number;
  minAmplitude: number;
  amplitudeBsr: number;
  minOrganic: number;
  organicBsr: number;
  organicMinMonths: number;
  organicMinReviews: number;
  minMass: number;
};

export type GateResult = {
  id: "C1" | "C2" | "C3" | "C4";
  name: string;
  pass: boolean;
  value: string;
  threshold: string;
  detail: string;
};

export type Verdict =
  | "pasa"
  | "mercado-comprado"
  | "mercado-chico"
  | "saturado"
  | "descartar";

export type Evaluation = {
  keyword: string;
  capturedAt: string;
  currency: string | null;
  sample: number;
  totalResults: number | null;
  totalIsOver: boolean;
  gates: GateResult[];
  verdict: Verdict;
  mass: { min: number; max: number; mid: number; crosses: boolean };
  /** Cobertura de evidencia (no es probabilidad de éxito). */
  coverage: number;
  blockers: string[];
};
