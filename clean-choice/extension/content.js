(() => {
  if (globalThis.__cleanChoice) return;

  const CONTROL_SELECTOR = 'button, a[href], [role="button"], input[type="submit"], input[type="button"]';
  const OFFER = /\b(upgrade|add|bundle|protect|protection|insur\w*|premium|get|boost|include)\b/i;
  const DECLINE = /\b(continue|no,? thanks|skip|decline|not now|without|keep (?:basic|standard)|i'?ll take the risk)\b/i;
  const EXPLICIT_DECLINE = /\b(without|no,? thanks|decline|skip|not now)\b/i;
  const NEVER_PAIRED = /^(back|cancel|close|previous|next page|go back)$|\b(to (?:cart|bag|basket|wishlist)|continue shopping)\b/i;
  const PRICE = /(?:[$€£]\s?\d[\d,]*(?:\.\d{1,2})?|\d[\d,]*(?:\.\d{1,2})?\s?(?:USD|EUR|GBP))/;
  const MAX_ANCESTOR_DEPTH = 4;
  const STYLE_ID = "clean-choice-style";
  const PANEL_ATTR = "data-clean-choice-panel";
  const MARK_ATTR = "data-clean-choice";

  const scanned = new Map();
  const applied = new Map();

  const collapse = (text) => (text || "").replace(/\s+/g, " ").trim();

  function accessibleName(el) {
    const label = el.getAttribute("aria-label");
    if (label) return collapse(label);
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ");
      if (collapse(text)) return collapse(text);
    }
    if (el instanceof HTMLInputElement) return collapse(el.value);
    return collapse(el.innerText || el.textContent);
  }

  function isVisible(el) {
    if (el.closest(`[${PANEL_ATTR}]`)) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.display === "none") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isDisabled(el) {
    return el.disabled === true || el.getAttribute("aria-disabled") === "true";
  }

  function classify(name) {
    if (!name || NEVER_PAIRED.test(name)) return null;
    const offer = OFFER.test(name) || PRICE.test(name);
    const decline = DECLINE.test(name);
    if (decline && (!offer || EXPLICIT_DECLINE.test(name))) return "decline";
    if (offer && !decline) return "offer";
    return null;
  }

  function ancestorDepth(el, ancestor) {
    let depth = 0;
    for (let node = el; node; node = node.parentElement, depth++) {
      if (node === ancestor) return depth;
    }
    return Infinity;
  }

  function commonAncestor(a, b) {
    for (let node = a.parentElement; node; node = node.parentElement) {
      if (node.contains(b)) return node;
    }
    return null;
  }

  function pairDistance(a, b) {
    const ancestor = commonAncestor(a, b);
    if (!ancestor) return Infinity;
    const depth = Math.max(ancestorDepth(a, ancestor), ancestorDepth(b, ancestor));
    if (depth <= MAX_ANCESTOR_DEPTH) return depth;
    const scope = a.closest("form, dialog, [role=dialog]");
    return scope && scope.contains(b) ? MAX_ANCESTOR_DEPTH + 1 : Infinity;
  }

  function findPrice(offer, decline) {
    const own = accessibleName(offer).match(PRICE);
    if (own) return collapse(own[0]);
    const shared = commonAncestor(offer, decline);
    let node = offer.parentElement;
    for (let i = 0; node && i < MAX_ANCESTOR_DEPTH; i++, node = node.parentElement) {
      const text = collapse(node.textContent).replace(accessibleName(decline), "");
      if (text.length > 400) break;
      const amounts = new Set((text.match(new RegExp(PRICE.source, "g")) || []).map((amount) => collapse(amount)));
      if (amounts.size > 1) return null;
      if (amounts.size === 1) return [...amounts][0];
      if (node === shared) break;
    }
    return null;
  }

  function parseColor(value) {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) return { r: 0, g: 0, b: 0, a: 0 };
    const [r, g, b, a = "1"] = match[1].split(/[\s,/]+/).filter(Boolean);
    return { r: +r, g: +g, b: +b, a: +a };
  }

  function effectiveBackground(el) {
    for (let node = el; node; node = node.parentElement) {
      const color = parseColor(getComputedStyle(node).backgroundColor);
      if (color.a > 0.5) return color;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }

  function luminance({ r, g, b }) {
    const channel = (v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  }

  function contrast(el) {
    const fg = parseColor(getComputedStyle(el).color);
    const bg = effectiveBackground(el);
    const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  }

  function hasFill(el) {
    const own = parseColor(getComputedStyle(el).backgroundColor);
    if (own.a <= 0.1) return false;
    const parent = el.parentElement ? effectiveBackground(el.parentElement) : null;
    return !parent || own.r !== parent.r || own.g !== parent.g || own.b !== parent.b;
  }

  function isUnderlined(el) {
    return getComputedStyle(el).textDecorationLine.includes("underline");
  }

  function isFocusable(el) {
    return el.tabIndex >= 0;
  }

  function asymmetryReasons(offer, decline) {
    const reasons = [];
    const os = getComputedStyle(offer);
    const ds = getComputedStyle(decline);
    if (hasFill(offer) && !hasFill(decline)) {
      reasons.push("The upsell has a filled background; the way to decline has none.");
    }
    if (isUnderlined(decline) && !isUnderlined(offer)) {
      reasons.push("The way to decline is styled as underlined link text.");
    }
    const oRect = offer.getBoundingClientRect();
    const dRect = decline.getBoundingClientRect();
    const areaRatio = (oRect.width * oRect.height) / Math.max(1, dRect.width * dRect.height);
    if (areaRatio >= 3) {
      reasons.push(`The upsell is ${areaRatio.toFixed(1)}× larger than the way to decline.`);
    }
    const sizeRatio = parseFloat(os.fontSize) / Math.max(1, parseFloat(ds.fontSize));
    const weightGap = Number(os.fontWeight) - Number(ds.fontWeight);
    if (sizeRatio >= 1.25 || weightGap >= 200) {
      reasons.push("The upsell uses noticeably larger or bolder text.");
    }
    const oContrast = contrast(offer);
    const dContrast = contrast(decline);
    if (dContrast < 4.5 || oContrast / dContrast >= 2) {
      reasons.push(`The way to decline has low text contrast (${dContrast.toFixed(1)}:1 vs ${oContrast.toFixed(1)}:1).`);
    }
    if (!isFocusable(decline) && isFocusable(offer)) {
      reasons.push("The way to decline cannot be reached with the keyboard.");
    }
    return reasons;
  }

  function describe(id, pair) {
    return {
      id,
      verdict: pair.reasons.length >= 2 ? "flag" : "balanced",
      offer: { name: pair.offerName, price: pair.price, disabled: isDisabled(pair.offer) },
      decline: { name: pair.declineName, disabled: isDisabled(pair.decline) },
      reasons: pair.reasons,
      applied: applied.has(id)
    };
  }

  function findPairs() {
    const controls = [...document.querySelectorAll(CONTROL_SELECTOR)].filter(isVisible);
    const offers = [];
    const declines = [];
    for (const el of controls) {
      const kind = classify(accessibleName(el));
      if (kind === "offer") offers.push(el);
      if (kind === "decline") declines.push(el);
    }
    const pairs = [];
    const usedDeclines = new Set();
    for (const offer of offers) {
      let best = null;
      let bestDistance = Infinity;
      for (const decline of declines) {
        if (usedDeclines.has(decline) || offer.contains(decline) || decline.contains(offer)) continue;
        const distance = pairDistance(offer, decline);
        if (distance < bestDistance) {
          best = decline;
          bestDistance = distance;
        }
      }
      if (!best) continue;
      usedDeclines.add(best);
      pairs.push({
        offer,
        decline: best,
        offerName: accessibleName(offer),
        declineName: accessibleName(best),
        price: findPrice(offer, best),
        reasons: asymmetryReasons(offer, best)
      });
    }
    return pairs;
  }

  function scan() {
    clearPreview();
    const live = new Map([...applied].map(([id, entry]) => [id, entry.pair]));
    scanned.clear();
    let next = 0;
    for (const [id, pair] of live) {
      scanned.set(id, pair);
      next = Math.max(next, id + 1);
    }
    for (const pair of findPairs()) {
      scanned.set(next++, pair);
    }
    return { pairs: [...scanned].map(([id, pair]) => describe(id, pair)) };
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      [${MARK_ATTR}][data-clean-choice-hidden] { display: none !important; }
      [data-clean-choice-preview] { outline: 3px dashed #b45309 !important; outline-offset: 3px !important; }
      [${PANEL_ATTR}] { all: initial; display: flex; flex-wrap: wrap; gap: 12px; margin: 12px 0;
        font: 16px/1.3 system-ui, sans-serif; }
      [${PANEL_ATTR}] button { all: initial; box-sizing: border-box; flex: 1 1 200px; min-height: 44px;
        padding: 10px 16px; border: 2px solid #1f2937; border-radius: 6px; background: #ffffff;
        color: #111827; font: 600 16px/1.3 system-ui, sans-serif; text-align: center; cursor: pointer; }
      [${PANEL_ATTR}] button:focus-visible { outline: 3px solid #2563eb; outline-offset: 2px; }
      [${PANEL_ATTR}] button:disabled { opacity: 0.5; cursor: not-allowed; }
    `;
    document.documentElement.appendChild(style);
  }

  function preview(id) {
    clearPreview();
    const pair = scanned.get(id);
    if (!pair) return false;
    pair.offer.setAttribute("data-clean-choice-preview", "");
    pair.decline.setAttribute("data-clean-choice-preview", "");
    ensureStyle();
    return true;
  }

  function clearPreview() {
    for (const el of document.querySelectorAll("[data-clean-choice-preview]")) {
      el.removeAttribute("data-clean-choice-preview");
    }
  }

  function offerLabel(pair) {
    if (!pair.price || pair.offerName.includes(pair.price)) return pair.offerName;
    return `${pair.offerName} (+${pair.price})`;
  }

  function declineLabel(pair) {
    return /\bupgrade\b/i.test(pair.offerName) ? "Continue without upgrade" : "Continue without this add-on";
  }

  function mark(pair, id) {
    for (const [el, role] of [
      [pair.offer, "offer"],
      [pair.decline, "decline"]
    ]) {
      el.setAttribute(MARK_ATTR, `${role}-${id}`);
      el.setAttribute("data-clean-choice-hidden", "");
    }
  }

  function unmark(pair) {
    for (const el of [pair.offer, pair.decline]) {
      el.removeAttribute(MARK_ATTR);
      el.removeAttribute("data-clean-choice-hidden");
    }
  }

  function syncDisabled(entry) {
    entry.offerButton.disabled = isDisabled(entry.pair.offer);
    entry.declineButton.disabled = isDisabled(entry.pair.decline);
  }

  function placePanel(entry) {
    const { offer, decline } = entry.pair;
    const first = offer.compareDocumentPosition(decline) & Node.DOCUMENT_POSITION_FOLLOWING ? offer : decline;
    first.before(entry.panel);
  }

  function apply(id) {
    const pair = scanned.get(id);
    if (!pair || applied.has(id)) return false;
    clearPreview();
    ensureStyle();

    const panel = document.createElement("div");
    panel.setAttribute(PANEL_ATTR, String(id));
    panel.setAttribute("role", "group");
    panel.setAttribute("aria-label", "Clean Choice: both options shown equally");
    const offerButton = document.createElement("button");
    const declineButton = document.createElement("button");
    offerButton.type = "button";
    declineButton.type = "button";
    offerButton.textContent = offerLabel(pair);
    declineButton.textContent = declineLabel(pair);
    declineButton.title = `Original: ${pair.declineName}`;
    panel.append(offerButton, declineButton);

    const entry = { pair, panel, offerButton, declineButton, observer: null };
    offerButton.addEventListener("click", () => entry.pair.offer.click());
    declineButton.addEventListener("click", () => entry.pair.decline.click());

    mark(pair, id);
    placePanel(entry);
    syncDisabled(entry);
    entry.observer = new MutationObserver(() => reconcile(id));
    entry.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled"]
    });
    applied.set(id, entry);
    return true;
  }

  function reconcile(id) {
    const entry = applied.get(id);
    if (!entry) return;
    const { pair } = entry;
    if (pair.offer.isConnected && pair.decline.isConnected) {
      syncDisabled(entry);
      if (!entry.panel.isConnected) placePanel(entry);
      return;
    }
    entry.observer.disconnect();
    const replacement = findPairs().find((p) => p.offerName === pair.offerName && p.declineName === pair.declineName);
    if (!replacement) {
      undo(id);
      return;
    }
    unmark(pair);
    entry.pair = replacement;
    scanned.set(id, replacement);
    mark(replacement, id);
    entry.panel.remove();
    placePanel(entry);
    syncDisabled(entry);
    entry.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled"]
    });
  }

  function undo(id) {
    const ids = id === undefined ? [...applied.keys()] : [id];
    for (const key of ids) {
      const entry = applied.get(key);
      if (!entry) continue;
      entry.observer?.disconnect();
      entry.panel.remove();
      unmark(entry.pair);
      applied.delete(key);
    }
    if (applied.size === 0) {
      clearPreview();
      document.getElementById(STYLE_ID)?.remove();
    }
    return true;
  }

  function state() {
    return { pairs: [...scanned].map(([id, pair]) => describe(id, pair)) };
  }

  globalThis.__cleanChoice = { scan, preview, clearPreview, apply, undo, state };
})();
