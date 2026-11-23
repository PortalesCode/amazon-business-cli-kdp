/**
 * Transporte HTTP de la máquina. Sin navegador.
 *
 * Amazon sirve el HTML completo: resultados, bestsellers y ficha. Se baja con headers
 * de navegador real y se extrae con el mismo extractor de siempre (DOM puro).
 *
 * Medido el 2026-11-22: 30 de 30 pedidos sin bloqueo a 0,9 s de distancia, ~1,1 s por
 * página contra ~50 s con Playwright.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseHTML } from "linkedom";

const require = createRequire(import.meta.url);

const EXTRACTOR_DIR = resolve(import.meta.dir, "../extractor");
const P = require(join(EXTRACTOR_DIR, "parse.js"));
const EXTRACT_JS = readFileSync(join(EXTRACTOR_DIR, "extract.js"), "utf8");

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * Headers mínimos, medidos: agregar `sec-fetch-*` y `upgrade-insecure-requests`
 * hace que Amazon devuelva un interstitial de "continue shopping" de 3,7 KB.
 * Con este set la página completa llega (1,8 MB).
 */
const HEADERS = {
  "user-agent": UA,
  "accept": "text/html,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  // Mercado en inglés y USD. Sin esto Amazon sirve /-/es/ y precios en ARS.
  "cookie": "lc-main=en_US; i18n-prefs=USD",
};

export type FetchResult = { status: number; html: string; blocked: string | null };

/**
 * Un interstitial no es un bloqueo definitivo: se espera y se reintenta una vez.
 * Si vuelve a aparecer, se trata como bloqueo y el llamador corta.
 */
export async function fetchHtml(url: string, timeoutMs = 30_000, attempt = 0): Promise<FetchResult> {
  const res = await fetch(url, {
    headers: HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const html = await res.text();
  // Señales específicas: un título de "Robot Check", el formulario de captcha o la URL
  // de validación. Buscar "unusual traffic" en todo el HTML da falsos positivos: esa
  // frase aparece en scripts de páginas normales.
  const title = (html.match(/<title>([^<]{0,120})/i)?.[1] ?? "").trim();
  const blocked =
    /errors\/validateCaptcha|\/ap\/signin|robot check/i.test(res.url) ||
    /robot check|sorry, we just need to make sure/i.test(title) ||
    /Enter the characters you see below/i.test(html)
      ? "captcha o bloqueo"
      : // Interstitial de "continuar comprando": página mínima sin el contenido.
        html.length < 12_000 && /continue shopping/i.test(html)
        ? "interstitial de Amazon"
        : res.status === 503
          ? "503 de Amazon"
          : null;
  if (blocked === "interstitial de Amazon" && attempt < 4) {
    await pause(8000 * (attempt + 1));
    return fetchHtml(url, timeoutMs, attempt + 1);
  }
  return { status: res.status, html, blocked };
}

/** Corre el extractor de la extensión sobre el HTML, sin navegador. */
export function extract(html: string, url: string): any {
  const { document } = parseHTML(html);
  const proto = Object.getPrototypeOf(document.body);
  if (proto && !("innerText" in proto)) {
    Object.defineProperty(proto, "innerText", {
      get() {
        return (this as any).textContent;
      },
      configurable: true,
    });
  }
  const u = new URL(url);
  const location = {
    href: url,
    pathname: u.pathname,
    search: u.search,
    host: u.host,
    hostname: u.hostname,
    protocol: u.protocol,
  };
  const navigator = { userAgent: UA };
  const sandbox: any = { document, navigator, location, KDPXParse: P };
  sandbox.window = sandbox;
  new Function("window", "document", "location", "navigator", EXTRACT_JS)(
    sandbox,
    document,
    location,
    navigator,
  );
  return sandbox.KDPXExtract.collect();
}

/**
 * Baja y extrae en un solo paso, con un reintento.
 * Amazon a veces sirve una variante de la página sin el texto de total: sin reintento
 * una frase se descartaría por un fallo transitorio.
 */
export async function fetchAndExtract(
  url: string,
  attempts = 2,
): Promise<{ data: any; blocked: string | null; status: number }> {
  let last: { data: any; blocked: string | null; status: number } = { data: null, blocked: null, status: 0 };
  for (let i = 0; i < attempts; i++) {
    const { html, blocked, status } = await fetchHtml(url);
    if (blocked) return { data: null, blocked, status };
    const data = extract(html, url);
    last = { data, blocked: null, status };
    if (data && (data.totalResultsText || (data.items?.length ?? 0) > 0)) return last;
    if (i < attempts - 1) await pause(700 + i * 500);
  }
  return last;
}

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
