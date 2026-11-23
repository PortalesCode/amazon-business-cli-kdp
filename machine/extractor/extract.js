/**
 * Extraccion desde el DOM de Amazon. Solo lee lo que la pagina ya muestra.
 * No pide datos a Amazon ni navega por su cuenta.
 */
(function () {
  const P = window.KDPXParse;

  const q = (sel, root) => (root || document).querySelector(sel);
  const qa = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const text = (el) => (el ? P.clean(el.innerText || el.textContent) : "");
  const attr = (el, name) => (el ? P.clean(el.getAttribute(name) || "") : "");

  function marketplace() {
    const host = location.hostname.replace(/^www\./, "");
    return host;
  }

  function pageKind() {
    const p = location.pathname;
    if (/^\/checkpoint\//.test(p) || /^\/ap\/signin/.test(p)) return "blocked";
    if (/^\/(gp\/)?(bestsellers|zgbs)\//.test(p) || p.includes("/zgbs/")) return "bestsellers";
    if (/\/(dp|gp\/product)\//.test(p)) return "product";
    if (p === "/s" || p.startsWith("/s/")) return "search";
    return "unknown";
  }

  function parsePageNumber() {
    const m = location.search.match(/[?&]page=(\d+)/);
    return m ? Number(m[1]) : 1;
  }

  function department() {
    const sel = q("#searchDropdownBox option[selected]") || q("#searchDropdownBox");
    const fromSelect = text(sel && sel.tagName === "OPTION" ? sel : q("#searchDropdownBox option:checked"));
    if (fromSelect) return fromSelect.replace(/^Todos los departamentos$|^All Departments$/, "All");
    const m = location.search.match(/[?&]i=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function sortOrder() {
    const sel = q("#s-result-sort-select");
    if (sel && sel.value) return sel.value;
    const m = location.search.match(/[?&]s=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function baseMeta() {
    const body = document.body ? document.body.innerText : "";
    return {
      marketplace: marketplace(),
      currency: P.detectCurrency(body.slice(0, 20000)),
      location: text(q("#glow-ingress-line2")) || null,
      lang: document.documentElement.lang || null,
      department: department(),
      sort: sortOrder(),
      page: parsePageNumber(),
      url: location.href,
    };
  }

  function firstPrice(root) {
    const candidates = [
      q("#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-offscreen", root),
      q("#corePriceDisplay_desktop_feature_div .a-price .a-offscreen", root),
      q("#price", root),
      q(".a-price:not(.a-text-price) .a-offscreen", root),
      q(".a-price .a-offscreen", root),
      q("#priceblock_ourprice", root),
      q("#priceblock_dealprice", root),
    ];
    for (const el of candidates) {
      const raw = text(el);
      if (raw && /\d/.test(raw)) return { raw, el };
    }
    return { raw: "", el: null };
  }

  function firstRating(root) {
    const el = q("[data-hook='rating-out-of-text']", root) || q("#acrPopover", root) || q(".a-icon-alt", root);
    if (!el) return null;
    return P.parseRating(text(el) || attr(el, "title") || attr(el, "aria-label"));
  }

  function firstReviews(root) {
    const candidate =
      q("#acrCustomerReviewText", root) ||
      q("[data-hook='total-review-count']", root) ||
      q("a[href*='#customerReviews'] span", root) ||
      q(".s-underline-text", root);
    if (!candidate) return null;
    const count = P.parseReviewCount(text(candidate));
    if (count != null) return count;
    // Ultimo recurso: el primer texto con parentesis numerico.
    const paren = qa("span, a", root).map(text).find((t) => /\(\s*[\d.,]+\s*[km]?\s*\)/i.test(t));
    return paren ? P.parseReviewCount(paren) : null;
  }

  function detailBullets() {
    const selectors = [
      "#detailBullets_feature_div li",
      "#detailBulletsWrapper_feature_div li",
      "#productDetails_detailBullets_sections1 tr",
      "#productDetails_feature_div tr",
      "#rpi-attribute-book_details-fiona-prelaunch tr",
    ];
    const out = [];
    for (const sel of selectors) for (const el of qa(sel)) {
      const t = P.clean(el.innerText || el.textContent);
      if (t) out.push(t);
    }
    return Array.from(new Set(out));
  }

  function labelValue(bullets, labels) {
    for (const raw of bullets) {
      const t = raw.replace(/\s*:\s*/g, ": ");
      for (const label of labels) {
        const re = new RegExp("^(?:" + label + ")\\s*:\\s*(.+)$", "i");
        const m = t.match(re);
        if (m) return P.clean(m[1]).replace(/^‏\s*:\s*/, "").trim();
      }
    }
    return null;
  }

  function normalizeUrl(href) {
    if (!href) return null;
    try {
      const u = new URL(href, location.origin);
      const asin = (u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/) || [])[1];
      return asin ? `${location.origin}/dp/${asin}` : u.href;
    } catch {
      return null;
    }
  }

  function asinFromUrl(href) {
    if (!href) return null;
    const m = String(href).match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
    return m ? m[1] : null;
  }

  /** Texto de un shadow root abierto, sin estilos ni scripts. */
  function shadowText(root) {
    const parts = [];
    const walk = (node) => {
      for (const child of node.childNodes || []) {
        if (child.nodeType === 3) parts.push(child.textContent);
        else if (!/^(STYLE|SCRIPT|IMG|SVG)$/.test(child.nodeName)) walk(child);
      }
    };
    walk(root);
    return P.clean(parts.join(" "));
  }

  /**
   * Lee los datos que la extension gratuita PublishFlow dibuja sobre cada
   * resultado: BSR general, categorias, paginas, fecha y ASIN.
   * Es DOM ya visible en la pagina, no una llamada extra a Amazon.
   */
  function publishFlowIndex() {
    const map = new Map();
    const boxes = document.querySelectorAll("pf-bsr-box");
    for (const el of boxes) {
      const asin = el.getAttribute("data-pf-asin") || el.closest("[data-asin]")?.getAttribute("data-asin");
      if (!asin) continue;
      const root = el.shadowRoot;
      if (!root) continue;
      const text = shadowText(root);
      if (!text) continue;

      const parsed = P.parsePublishFlowText(text);
      const ranks = parsed.ranks;
      const overall = ranks.find((r) => P.isOverallCategory(r.category)) || ranks[0] || null;

      map.set(asin, {
        bsrOverall: overall ? overall.rank : null,
        bsrOverallCategory: overall ? overall.category : null,
        bsr: ranks.map((r) => ({ ...r, isOverall: P.isOverallCategory(r.category) })),
        pages: parsed.pages,
        pubDate: parsed.pubDate,
        price: parsed.price,
        currency: parsed.currency,
        format: parsed.format,
      });
    }
    return map;
  }

  /**
   * Lee las tarjetas de CoAuthor (requiere cuenta gratis en ese perfil):
   * ventas y regalias estimadas por dia, y BSR de la tarjeta.
   */
  function coauthorIndex() {
    const map = new Map();
    const cards = document.querySelectorAll(".coauthor-mini, .coauthor-badge.coauthor-mini, .coauthor-mini-wrap");
    for (const el of cards) {
      const asin =
        (el.querySelector(".coauthor-mini-asin-value")?.textContent || "").trim() ||
        el.closest("[data-asin]")?.getAttribute("data-asin") ||
        null;
      if (!asin || asin.length < 6) continue;
      const salesText = P.clean(el.querySelector(".coauthor-mini-sales")?.textContent || "");
      const royaltyText = P.clean(el.querySelector(".coauthor-mini-royalty")?.textContent || "");
      const bsrText = P.clean(el.querySelector(".coauthor-mini-bsr")?.textContent || "");
      const sales = salesText ? P.parseRange(salesText + " Sales/Day", "Sales\\/Day") : null;
      const royalty = royaltyText ? P.parseRange(royaltyText + " Royalty/Day", "Royalty\\/Day") : null;
      const bsr = bsrText ? P.toNumber(bsrText.replace(/[^\d.,]/g, "")) : null;
      map.set(asin, {
        salesDayMin: sales ? sales.min : null,
        salesDayMax: sales ? sales.max : null,
        royaltyDayMin: royalty ? royalty.min : null,
        royaltyDayMax: royalty ? royalty.max : null,
        bsr: bsr == null ? null : Math.round(bsr),
      });
    }
    return map;
  }

  function extractSearch() {
    const cards = qa("[data-component-type='s-search-result']");
    const items = [];
    cards.forEach((card, idx) => {
      const asin = attr(card, "data-asin") || null;
      if (!asin) return;
      const fullText = P.clean(card.innerText);
      const titleEl = q("h2 span", card) || q("h2", card) || q("[data-cy='title-recipe'] span", card);
      const title = text(titleEl);
      if (!title) return;

      const link = q("a[href*='/dp/']", card);
      const { raw: priceRaw } = firstPrice(card);
      const price = P.parsePrice(priceRaw, fullText);
      const sponsored =
        P.isSponsored(fullText) || !!q("[data-component-type='sp-sponsored-result'], .s-sponsored-label-text", card);
      const badge = text(q(".a-badge-label-inner, .a-badge-text", card)) || null;

      // La linea del autor es la unica .a-row que empieza con "por"/"by".
      const bylineText = qa(".a-row", card).map(text).find((t) => /^(por|by)\s+/i.test(t));
      let author = bylineText
        ? bylineText
            .replace(/^(por|by)\s+/i, "")
            .split("|")[0]
            .replace(/\s+(?:\d{1,2}\s+de\s+\w+|\w+\s+\d{1,2},?\s+\d{4}).*$/i, "")
            .trim()
        : "";
      if (!author) {
        const m = fullText.match(/(?:^|\s)(?:por|by)\s+([A-ZÁÉÍÓÚÑ][^|]{2,70}?)(?:\s+\d|\s*\|)/);
        author = m ? m[1].trim() : "";
      }

      items.push({
        asin,
        position: idx + 1,
        title,
        author: author || null,
        price: price.value,
        priceRaw: price.raw || priceRaw || null,
        currency: price.currency,
        rating: firstRating(card),
        reviews: firstReviews(card),
        sponsored,
        badge,
        format:
          qa(".a-row", card)
            .map(text)
            .filter((t) => /^(pasta dura|pasta blanda|tapa dura|tapa blanda|edici[oó]n kindle|kindle|audiolibro|hardcover|paperback|audiobook)$/i.test(t))
            .map((t) => P.formatFromText(t))[0] || null,
        ku: P.isKindleUnlimited(fullText),
        url: normalizeUrl(link && link.href) || `${location.origin}/dp/${asin}`,
      });
    });

    // Fusionar los datos de PublishFlow (si esta instalado) por ASIN.
    const pf = publishFlowIndex();
    for (const it of items) {
      const extra = pf.get(it.asin);
      if (!extra) continue;
      it.bsrOverall = it.bsrOverall ?? extra.bsrOverall;
      it.bsrOverallCategory = it.bsrOverallCategory ?? extra.bsrOverallCategory;
      it.bsr = it.bsr ?? extra.bsr;
      it.pages = it.pages ?? extra.pages;
      it.pubDate = it.pubDate ?? extra.pubDate;
      if (it.price == null && extra.price != null) {
        it.price = extra.price;
        it.currency = it.currency || extra.currency;
      }
      it.format = it.format || extra.format;
      it.raw = { ...(it.raw || {}), publishflow: true };
    }

    // Fusionar estimaciones de CoAuthor (si esta logueado en el perfil).
    const ca = coauthorIndex();
    for (const it of items) {
      const extra = ca.get(it.asin);
      if (!extra) continue;
      it.bsrOverall = it.bsrOverall ?? extra.bsr;
      it.salesDayMin = extra.salesDayMin;
      it.salesDayMax = extra.salesDayMax;
      it.royaltyDayMin = extra.royaltyDayMin;
      it.royaltyDayMax = extra.royaltyDayMax;
      it.estimateSource = "coauthor";
      it.raw = { ...(it.raw || {}), coauthor: true };
    }

    const infoRaw = text(q("[data-component-type='s-result-info-bar']")) || "";
    // Quedarse con la frase de resultados, antes del selector de orden.
    const info = infoRaw.split(/Ordenar por|Sort by/i)[0];
    const total = P.parseTotalResults(info);

    return {
      kind: "search",
      items,
      totalResultsText: total.text,
      totalResults: total.total,
      totalResultsIsOver: total.isOver,
      keyword: new URLSearchParams(location.search).get("k") || null,
    };
  }

  function extractReviews() {
    return qa("[data-hook='review']").slice(0, 10).map((el) => {
      const titleRaw = text(q("[data-hook='review-title']", el));
      const rating = P.parseRating(text(q(".a-icon-alt", el)));
      const date = text(q("[data-hook='review-date']", el));
      const verified = !!q("[data-hook='avp-badge']", el);
      const body = text(q("[data-hook='review-body']", el)).slice(0, 1200);
      return { title: titleRaw.slice(0, 160), rating, date, verified, body };
    }).filter((r) => r.body);
  }

  function extractProduct() {
    const asin =
      asinFromUrl(location.href) ||
      (q("#ASIN") && q("#ASIN").value) ||
      null;
    const title = text(q("#productTitle")) || null;
    const bullets = detailBullets();
    const joined = bullets.join(" | ");
    const rankList = P.parseRankList(joined);
    const { raw: priceRaw } = firstPrice(document);
    const price = P.parsePrice(priceRaw, text(q("#corePriceDisplay_desktop_feature_div")) || text(q("#buybox")));
    const formatRaw =
      text(q("#tmmSwatches .swatchElement.selected .a-button-text")) ||
      text(q("#tmmSwatches .selected")) ||
      text(q("#productSubtitle")) ||
      "";
    const format = P.formatFromText(formatRaw) || P.formatFromText(title || "") || formatRaw || null;

    const split = P.splitTitleSubtitle(title || "");
    const subtitle = text(q("#productSubtitle")) || split.subtitle || null;

    const description =
      text(q("#bookDescription_feature_div")) ||
      text(q("#productDescription")) ||
      text(q("#bookDescription_feature_div .a-expander-content")) ||
      null;

    const coverEl = q("#landingImage") || q("#imgTagWrapperId img") || q("#main-image-container img");
    const coverUrl = coverEl ? attr(coverEl, "data-old-hires") || attr(coverEl, "src") || null : null;

    const reviewSamples = extractReviews();
    const customersSay =
      text(q("[data-hook='cr-insights-widget-summary']")) ||
      text(q("#cr-product-insights-cards")) ||
      text(q("[data-hook='cr-insights-widget']")) ||
      null;

    const series = bullets.find((b) => /^(Parte de|Book \d+ of|Series:)/i.test(b)) || null;
    const aplus = !!q("#aplus");
    const editorial = text(q("#editorialReviews_feature_div")).slice(0, 3000) || null;

    const publisher = labelValue(bullets, ["Editorial", "Publisher", "Editado por", "Published by"]);
    const pubDateRaw = labelValue(bullets, ["Fecha de publicación", "Publication date", "Fecha de publicaci[oó]n"]);
    const pagesRaw = labelValue(bullets, ["Número de páginas", "Print length", "Páginas", "Pages"]);
    const isbnRaw = labelValue(bullets, ["ISBN-13", "ISBN 13"]);
    const overall = rankList.find((r) => P.isOverallCategory(r.category));

    return {
      kind: "product",
      items: [
        {
          asin,
          position: 1,
          title,
          author: text(q("#bylineInfo")).replace(/^(visitar|visit)\s+/i, "").replace(/^(la página del autor|author page)\s*/i, "") || null,
          price: price.value,
          priceRaw: price.raw || priceRaw || null,
          currency: price.currency,
          rating: firstRating(document),
          reviews: firstReviews(document),
          sponsored: false,
          badge: null,
          format,
          publisher,
          pubDate: P.parseDate(pubDateRaw || ""),
          pages: P.parsePages(pagesRaw || ""),
          isbn13: P.parseIsbn13(isbnRaw || "") || P.parseIsbn13(asin || ""),
          bsrOverall: overall ? overall.rank : null,
          bsrOverallCategory: overall ? overall.category : null,
          bsr: rankList.map((r) => ({ ...r, isOverall: P.isOverallCategory(r.category) })),
          ku: P.isKindleUnlimited(text(q("#buybox"))),
          url: `${location.origin}/dp/${asin}`,
          subtitle,
          description: description ? description.slice(0, 8000) : null,
          coverUrl,
          reviewSamples,
          dossier: {
            customersSay: customersSay ? customersSay.slice(0, 1500) : null,
            series,
            aplus,
            editorial,
          },
          raw: { bullets, reviewCount: reviewSamples.length },
        },
      ],
    };
  }

  function extractBestsellers() {
    const cells = qa("#gridItemRoot, [data-testid='grid'] > div, .zg-grid-general-faceout");
    const items = [];
    const seen = new Set();
    cells.forEach((cell, idx) => {
      const link = q("a[href*='/dp/']", cell);
      const asin = asinFromUrl(link && link.href);
      if (!asin || seen.has(asin)) return;
      seen.add(asin);
      const fullText = P.clean(cell.innerText);
      const title =
        text(q("._cDEzb_p13n-sc-css-line-clamp-3_g3dy1", cell)) ||
        text(q(".p13n-sc-truncate-desktop-type2", cell)) ||
        text(q("a span div", cell)) ||
        text(link);
      const rankRaw = text(q(".zg-bdg-text, .zg-badge-text", cell)) || fullText.slice(0, 12);
      const { raw: priceRaw } = firstPrice(cell);
      const price = P.parsePrice(priceRaw, fullText);
      const ratingEl = q(".a-icon-alt", cell);
      const reviewsEl = q("a[href*='#customerReviews'] .a-size-small, .a-size-small", cell);
      const reviewsFallback =
        (fullText.match(/\(\s*([\d.,]+\s*[km]?)\s*\)/i) || [])[1] ||
        (fullText.match(/estrellas\s+([\d.,]+\s*[km]?)/i) || [])[1] ||
        (fullText.match(/stars\s+([\d.,]+\s*[km]?)/i) || [])[1] ||
        null;

      items.push({
        asin,
        position: P.parseBestsellerRank(rankRaw) || idx + 1,
        title,
        author: null,
        price: price.value,
        priceRaw: price.raw || null,
        currency: price.currency,
        rating: P.parseRating(text(ratingEl)),
        reviews: P.parseReviewCount(text(reviewsEl)) ?? P.parseReviewCount(reviewsFallback),
        sponsored: false,
        badge: null,
        format: null,
        url: `${location.origin}/dp/${asin}`,
        raw: { text: fullText.slice(0, 500) },
      });
    });

    return {
      kind: "bestsellers",
      items,
      totalResultsText: null,
      totalResults: items.length,
      totalResultsIsOver: false,
      keyword: null,
    };
  }

  function extractSuggestions() {
    const box = q("#sac-autocomplete-results-container, .s-suggestions");
    if (!box) return [];
    const nodes = qa(".s-suggestion, .s-suggestion-container, [role='option']", box);
    const phrases = [];
    for (const n of nodes) {
      const t = text(n).replace(/^[\u2191\u2193]/, "").trim();
      if (t && !phrases.includes(t)) phrases.push(t);
    }
    return phrases;
  }

  function collect(kindOverride) {
    const kind = kindOverride || pageKind();
    const meta = baseMeta();
    if (kind === "search") return { ...meta, ...extractSearch() };
    if (kind === "product") return { ...meta, ...extractProduct() };
    if (kind === "bestsellers") return { ...meta, ...extractBestsellers() };
    return { ...meta, kind: "unknown", items: [] };
  }

  window.KDPXExtract = {
    hasPublishFlow: () => document.querySelectorAll("pf-bsr-box").length > 0,
    publishFlowCount: () => document.querySelectorAll("pf-bsr-box[data-pf-asin]").length,
    pageKind,
    baseMeta,
    extractSearch,
    extractProduct,
    extractBestsellers,
    extractSuggestions,
    collect,
    countSearchCards: () => qa("[data-component-type='s-search-result']").length,
    countBestsellerCells: () => qa("#gridItemRoot, [data-testid='grid'] > div, .zg-grid-general-faceout").length,
  };
})();
