/**
 * Parsers puros: no tocan el DOM. Se pueden probar desde Bun/Node.
 * Todo lo que entra es texto tal como aparece en Amazon, en español o en inglés.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.KDPXParse = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function clean(s) {
    if (s == null) return "";
    return String(s)
      .replace(/[\u200b-\u200f\u202a-\u202e]/g, "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  const CURRENCY_SYMBOLS = [
    ["ARS", /ARS\s?/i],
    ["USD", /US\$\s?/i],
    ["CAD", /CDN\$\s?|CA\$\s?/i],
    ["GBP", /£\s?/],
    ["EUR", /€\s?/],
    ["JPY", /¥\s?/],
    ["BRL", /R\$\s?/],
    ["MXN", /MX\$\s?/],
    ["AUD", /AU\$\s?/],
  ];

  function detectCurrency(text) {
    const t = clean(text);
    for (const [code, re] of CURRENCY_SYMBOLS) if (re.test(t)) return code;
    if (/\$\s?\d/.test(t)) return "USD";
    return null;
  }

  /** Normaliza "1.234,56" / "1,234.56" / "1 234,56" a numero. */
  function toNumber(raw) {
    if (raw == null) return null;
    let s = clean(String(raw)).replace(/[^\d.,-]/g, "");
    if (!s) return null;
    const lastDot = s.lastIndexOf(".");
    const lastComma = s.lastIndexOf(",");
    if (lastDot >= 0 && lastComma >= 0) {
      // El separador que aparece ultimo es el decimal.
      if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
      else s = s.replace(/,/g, "");
    } else if (lastComma >= 0) {
      const after = s.length - lastComma - 1;
      s = after === 3 && s.length > 4 ? s.replace(/,/g, "") : s.replace(",", ".");
    } else if (lastDot >= 0) {
      const after = s.length - lastDot - 1;
      if (after === 3 && s.length > 4) s = s.replace(/\./g, "");
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Precio: soporta "US$16.99", "ARS 26.372,93", "16,99 €", rangos,
   * y la trampa de Kindle: "Gratis con Kindle+ ... O US$0.99 para comprar".
   */
  function parsePrice(raw, contextText) {
    const rawText = clean(raw);
    const ctx = clean(contextText || "");
    const joined = clean(rawText + " " + ctx);

    // Preferir el precio de compra explicito frente al "Gratis con suscripcion".
    const buyMatch = joined.match(/(?:O|or)\s*((?:US\$|ARS|CDN\$|CA\$|MX\$|AU\$|R\$|£|€|¥|\$)\s?[\d.,]+)\s*(?:para comprar|to buy)/i);
    if (/gratis con|free with|incluido con|included with/i.test(joined) && buyMatch) {
      const value = toNumber(buyMatch[1]);
      return {
        value: value,
        currency: detectCurrency(buyMatch[1]),
        raw: buyMatch[1],
        fromSubscription: true,
        isRange: false,
      };
    }

    const priceRe = /(?:US\$|ARS|CDN\$|CA\$|MX\$|AU\$|R\$|£|€|¥|\$)\s?[\d][\d.,]*|[\d][\d.,]*\s?(?:€|£|¥)/g;
    const matches = joined.match(priceRe);
    if (!matches || !matches.length) return { value: null, currency: detectCurrency(joined), raw: rawText || null, fromSubscription: false, isRange: false };

    const first = matches[0];
    const isRange = matches.length > 1 && /(?:-|–|to|a)\s*(?:US\$|ARS|CDN\$|CA\$|MX\$|AU\$|R\$|£|€|¥|\$)/.test(joined);
    return {
      value: toNumber(first),
      currency: detectCurrency(first),
      raw: first,
      fromSubscription: false,
      isRange: isRange,
    };
  }

  function parseReviewCount(raw) {
    const t = clean(raw);
    if (!t) return null;
    if (/s[eé] el primero|be the first|sin opiniones|no reviews|todav[ií]a no hay/i.test(t)) return 0;
    // Preferir el grupo entre parentesis: "(1.2 K)" o "(118)".
    const paren = t.match(/\(([^)]+)\)/);
    const source = paren ? paren[1] : t;
    const m = source.match(/([\d.,]+)\s*(mil|mill[oó]n|millon|k|m|b)?/i);
    if (!m) return null;
    let n = toNumber(m[1]);
    if (n == null) return null;
    const suffix = (m[2] || "").toLowerCase();
    if (suffix === "k" || suffix === "mil") n *= 1000;
    else if (suffix === "m" || suffix.startsWith("mill")) n *= 1000000;
    return Math.round(n);
  }

  function parseRating(raw) {
    const t = clean(raw);
    if (!t) return null;
    const m = t.match(/([0-5](?:[.,]\d)?)\s*(?:de\s*5|out of 5|\/\s*5|estrellas|stars)?/i);
    if (!m) return null;
    const n = toNumber(m[1].replace(",", "."));
    return n != null && n >= 0 && n <= 5 ? n : null;
  }

  /** Lista de rankings: "#12,345 in Books" / "nº12.345 en Libros". */
  function parseRankList(text) {
    const t = clean(text);
    const out = [];
    const re = /(?:#|n[º°]\s?|rank\s?)([\d.,]+)\s*(?:en|in)\s+(.+?)(?=\s*(?:#|n[º°])\s?[\d.,]|$)/gi;
    let m;
    const seen = new Set();
    while ((m = re.exec(t))) {
      const rank = toNumber(m[1]);
      let category = clean(m[2])
        .split("|")[0]
        .replace(/\s*\(ver el top[^)]*\)?.*$/i, "")
        .replace(/\s*\(see top[^)]*\)?.*$/i, "")
        .replace(/\s*(opiniones de clientes|customer reviews|rating|estrellas).*$/i, "")
        .replace(/[.,;:|\s]+$/, "")
        .replace(/\s+/g, " ")
        .trim();
      if (rank == null || !category || category.length < 2) continue;
      if (category.length > 70) continue;
      const key = `${Math.round(rank)}|${category.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ rank: Math.round(rank), category });
    }
    return out;
  }

  function isOverallCategory(category) {
    return /^(books?|libros?|kindle store|tienda kindle|all departments|todas las categor[ií]as)$/i.test(clean(category));
  }

  const MONTHS = {
    enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
    septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
    september: 9, october: 10, november: 11, december: 12,
    jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  };

  function parseDate(raw) {
    const t = clean(raw).toLowerCase();
    if (!t) return null;
    let m = t.match(/(\d{1,2})\s*(?:de\s*)?([a-záéíóúñ]+)\s*(?:de\s*|,\s*)?(\d{4})/);
    if (m && MONTHS[m[2]]) {
      return `${m[3]}-${String(MONTHS[m[2]]).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
    }
    m = t.match(/([a-záéíóúñ]+)\s+(\d{1,2}),?\s+(\d{4})/);
    if (m && MONTHS[m[1]]) {
      return `${m[3]}-${String(MONTHS[m[1]]).padStart(2, "0")}-${String(Number(m[2])).padStart(2, "0")}`;
    }
    m = t.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    return null;
  }

  function parseTotalResults(text) {
    const t = clean(text);
    if (!t) return { text: null, total: null, isOver: false };
    const over = /m[aá]s de|over|more than/i.test(t);
    const m = t.match(/(?:m[aá]s de|over|more than)?\s*([\d.,]{3,})/);
    const total = m ? toNumber(m[1]) : null;
    return { text: t, total: total == null ? null : Math.round(total), isOver: over };
  }

  function parsePages(raw) {
    const m = clean(raw).match(/([\d.,]+)\s*(?:p[aá]ginas|pages)/i);
    if (!m) return null;
    const n = toNumber(m[1]);
    return n == null ? null : Math.round(n);
  }

  function parseIsbn13(raw) {
    const m = clean(raw).match(/(97[89][\d-]{10,17})/);
    return m ? m[1].replace(/-/g, "") : null;
  }

  function isSponsored(text) {
    return /(^|\s)(patrocinado|sponsored)(\s|$)/i.test(clean(text));
  }

  function isKindleUnlimited(text) {
    return /kindle unlimited|kindle\+|gratis con la membres[ií]a|free with kindle|incluido con/i.test(clean(text));
  }

  function formatFromText(text) {
    const t = clean(text);
    const map = [
      ["Kindle", /edici[oó]n kindle|kindle edition|formato kindle|e-?book/i],
      ["Paperback", /tapa blanda|pasta blanda|paperback/i],
      ["Hardcover", /tapa dura|pasta dura|hardcover/i],
      ["Audiobook", /audiolibro|audiobook|audible/i],
      ["Spiral", /espiral|spiral/i],
    ];
    for (const [name, re] of map) if (re.test(t)) return name;
    return null;
  }

  function parseBestsellerRank(raw) {
    const m = clean(raw).match(/(?:#|n[º°])\s*([\d.,]+)/);
    if (!m) return null;
    const n = toNumber(m[1]);
    return n == null ? null : Math.round(n);
  }

  function daysSince(iso, refISO) {
    if (!iso) return null;
    const a = Date.parse(iso);
    const b = refISO ? Date.parse(refISO) : Date.now();
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.round((b - a) / 86400000);
  }

  /**
   * Texto que PublishFlow dibuja sobre cada resultado, sin estilos:
   * "Libros #10 Pasta blanda US$5.35 Libros para Colorear para Adultos#1 ... Extensión96 páginas
   *  Fecha de publicación2024-12-03 ASINB0DJ27336M"
   */
  function parsePublishFlowText(rawText) {
    const text = clean(rawText);
    const ranks = [];
    const re = /([A-Za-zÁÉÍÓÚÑÜáéíóúñü][A-Za-zÁÉÍÓÚÑÜáéíóúñü\s()\/&.,'’-]*?)\s*#([\d.,]+)/g;
    let m;
    while ((m = re.exec(text))) {
      let category = m[1].split(/US\$\s?[\d.,]+/).pop() || "";
      category = category
        .replace(/^(pasta blanda|pasta dura|tapa blanda|tapa dura|paperback|hardcover|kindle|edici[oó]n kindle)\s*/i, "")
        .replace(/[.,;:|\s]+$/, "")
        .trim();
      const rank = toNumber(m[2]);
      if (rank == null || !category) continue;
      if (category.length > 60) continue;
      if (ranks.some((r) => r.rank === Math.round(rank) && r.category === category)) continue;
      ranks.push({ rank: Math.round(rank), category });
    }

    const pagesMatch = text.match(/(?:Extensión|Print length)\s*([\d.,]+)\s*(?:páginas|pages)/i);
    const pages = pagesMatch ? toNumber(pagesMatch[1]) : null;
    const dateMatch = text.match(/(?:Fecha de publicación|Publication date)\s*([\d-]{8,10})/i);
    const priceMatch = text.match(/(?:US\$|ARS|CDN\$|CA\$|MX\$|AU\$|R\$|£|€|¥)\s?[\d][\d.,]*/);
    const price = priceMatch ? parsePrice(priceMatch[0]) : { value: null, currency: null };

    return {
      ranks,
      pages: pages == null ? null : Math.round(pages),
      pubDate: dateMatch ? parseDate(dateMatch[1]) : null,
      price: price.value,
      currency: price.currency,
      format: formatFromText(text),
    };
  }

  /** "1.0k" -> 1000, "2,351" -> 2351 */
  function parseCompactNumber(raw) {
    const t = clean(raw).toLowerCase();
    const m = t.match(/([\d.,]+)\s*(k|m|mil|mill[oó]n)?/);
    if (!m) return null;
    let n = toNumber(m[1]);
    if (n == null) return null;
    const suf = m[2] || "";
    if (suf === "k" || suf === "mil") n *= 1000;
    else if (suf === "m" || suf.startsWith("mill")) n *= 1000000;
    return Math.round(n);
  }

  /** "767-1280 Sales/Day" o "$613-$1.0k Royalty/Day" -> {min,max} */
  function parseRange(text, unit) {
    const t = clean(text);
    const re = new RegExp(`\\$?([\\d.,]+\\s*[km]?)\\s*[-–]\\s*\\$?([\\d.,]+\\s*[km]?)\\s*${unit}`, "i");
    const m = t.match(re);
    if (m) {
      const min = parseCompactNumber(m[1]);
      const max = parseCompactNumber(m[2]);
      return min == null || max == null ? null : { min, max };
    }
    const single = new RegExp(`\\$?([\\d.,]+\\s*[km]?)\\s*${unit}`, "i").exec(t);
    if (single) {
      const v = parseCompactNumber(single[1]);
      return v == null ? null : { min: v, max: v };
    }
    return null;
  }

  /** "Titulo: subtitulo largo" -> {title, subtitle} */
  function splitTitleSubtitle(full) {
    const t = clean(full);
    const i = t.indexOf(": ");
    if (i > 10 && i < t.length - 3) return { title: t.slice(0, i).trim(), subtitle: t.slice(i + 1).trim() };
    return { title: t, subtitle: null };
  }

  return {
    clean,
    toNumber,
    splitTitleSubtitle,
    parseCompactNumber,
    parseRange,
    parsePublishFlowText,
    detectCurrency,
    parsePrice,
    parseReviewCount,
    parseRating,
    parseRankList,
    isOverallCategory,
    parseDate,
    parseTotalResults,
    parsePages,
    parseIsbn13,
    isSponsored,
    isKindleUnlimited,
    formatFromText,
    parseBestsellerRank,
    daysSince,
  };
});
