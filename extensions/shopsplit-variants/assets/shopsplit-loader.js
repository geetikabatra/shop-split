/**
 * Fetches the active experiment for each ShopSplit block on the page,
 * deterministically buckets the visitor into a variant, applies its
 * content, and reports impression/add-to-cart events. Fails closed: any
 * error, timeout, or "no active experiment" response leaves the
 * server-rendered control copy in place and skips event reporting.
 */
(function () {
  // Multiple ShopSplit blocks on one page each include this script tag;
  // only the first inclusion should actually run.
  if (window.__shopsplitLoaderLoaded) return;
  window.__shopsplitLoaderLoaded = true;

  var CONFIG_ENDPOINT = "/apps/shopsplit/config";
  var EVENT_ENDPOINT = "/apps/shopsplit/event";
  var FETCH_TIMEOUT_MS = 2000;
  var VISITOR_COOKIE = "shopsplit_vid";
  var VISITOR_COOKIE_DAYS = 365;

  // ---- visitor id (first-party cookie) ----

  function getCookie(name) {
    var match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
    return match ? decodeURIComponent(match[1]) : null;
  }

  function setCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie =
      name + "=" + encodeURIComponent(value) + "; expires=" + expires + "; path=/; SameSite=Lax";
  }

  function randomId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx".replace(/x/g, function () {
      return Math.floor(Math.random() * 16).toString(16);
    });
  }

  function getVisitorId() {
    var id = getCookie(VISITOR_COOKIE);
    if (!id) {
      id = randomId();
      setCookie(VISITOR_COOKIE, id, VISITOR_COOKIE_DAYS);
    }
    return id;
  }

  // ---- deterministic bucketing ----
  // Same visitorId + experimentId always picks the same variant, as long as
  // the variant list/weights don't change -- which they can't once an
  // experiment is RUNNING (variants lock server-side at that point). No
  // server round trip is needed to make bucketing sticky.

  function hashString(str) {
    // FNV-1a, 32-bit.
    var hash = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  function pickVariantForVisitor(visitorId, experimentId, variants) {
    var total = variants.reduce(function (sum, v) {
      return sum + v.weight;
    }, 0);
    if (total <= 0) return variants[0];

    var bucket = hashString(visitorId + ":" + experimentId) % total;
    var cumulative = 0;
    for (var i = 0; i < variants.length; i++) {
      cumulative += variants[i].weight;
      if (bucket < cumulative) return variants[i];
    }
    return variants[variants.length - 1];
  }

  // ---- networking ----

  function fetchWithTimeout(url, options) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId = controller
      ? setTimeout(function () {
          controller.abort();
        }, FETCH_TIMEOUT_MS)
      : null;

    return fetch(
      url,
      Object.assign({}, options, { signal: controller ? controller.signal : undefined }),
    ).then(
      function (res) {
        if (timeoutId) clearTimeout(timeoutId);
        return res;
      },
      function (err) {
        if (timeoutId) clearTimeout(timeoutId);
        throw err;
      },
    );
  }

  function fetchConfig(targetType, targetResourceId) {
    var params = new URLSearchParams({ targetType: targetType });
    if (targetResourceId) params.set("targetResourceId", targetResourceId);

    return fetchWithTimeout(CONFIG_ENDPOINT + "?" + params.toString(), {
      headers: { Accept: "application/json" },
    })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        return null;
      });
  }

  function postEvent(payload) {
    fetchWithTimeout(EVENT_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(function () {
      // Best-effort: a dropped event doesn't affect what the visitor sees.
    });
  }

  // ---- cart attribution (for purchase tracking) ----
  // Tags the cart with this visitor's assignment so the orders/paid webhook
  // can attribute the eventual order back to the right variant.

  function tagCartForPurchaseAttribution(experimentId, variantId, visitorId) {
    var attributes = {};
    attributes["shopsplit_" + experimentId] = variantId + ":" + visitorId;

    fetchWithTimeout("/cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attributes: attributes }),
      keepalive: true,
    }).catch(function () {});
  }

  // ---- add-to-cart detection ----
  // Two independent detectors, since themes vary in how "Add to cart"
  // actually submits: some AJAX cart drawers call fetch("/cart/add.js"),
  // while a plain product form does a full-page POST to /cart/add with no
  // fetch involved at all. Both are wired to the same listener list.

  var addToCartListeners = [];

  function onAddToCart(fn) {
    addToCartListeners.push(fn);
  }

  function notifyAddToCart() {
    addToCartListeners.forEach(function (fn) {
      try {
        fn();
      } catch (err) {
        // Never let a tracking error break the add-to-cart flow.
      }
    });
  }

  function installFetchAddToCartDetector() {
    if (window.__shopsplitFetchPatched || typeof window.fetch !== "function") return;
    window.__shopsplitFetchPatched = true;

    var originalFetch = window.fetch;
    window.fetch = function (input) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var isCartAdd = /\/cart\/add(\.js)?(\?|$)/.test(url);

      return originalFetch.apply(this, arguments).then(function (response) {
        if (isCartAdd && response.ok) {
          notifyAddToCart();
        }
        return response;
      });
    };
  }

  // Fallback for themes/sections that submit the product form directly
  // (no JS interception) rather than via fetch. The listeners we notify
  // use fetch(..., {keepalive: true}), which is specifically designed to
  // survive the page navigation that follows a non-AJAX form submit.
  function installFormAddToCartDetector() {
    if (window.__shopsplitFormPatched) return;
    window.__shopsplitFormPatched = true;

    document.addEventListener(
      "submit",
      function (event) {
        var form = event.target;
        if (!form || form.tagName !== "FORM") return;
        var action = form.getAttribute("action") || "";
        if (!/\/cart\/add(\.js)?(\?|$)/.test(action)) return;
        notifyAddToCart();
      },
      true,
    );
  }

  // ---- block init ----

  function applyVariant(block, experimentId, variant) {
    var contentEl = block.querySelector("[data-shopsplit-content]");
    if (contentEl) {
      try {
        var payload = JSON.parse(variant.content);
        if (payload && typeof payload.text === "string" && payload.text.length > 0) {
          contentEl.textContent = payload.text;
        }
      } catch (err) {
        // Malformed content payload: leave the control copy rendered by Liquid.
      }
    }
    block.setAttribute("data-shopsplit-experiment-id", experimentId);
    block.setAttribute("data-shopsplit-variant-id", variant.id);
  }

  function initBlock(block, visitorId) {
    var targetType = block.getAttribute("data-shopsplit-target-type");
    if (!targetType) return;
    var targetResourceId = block.getAttribute("data-shopsplit-target-resource-id") || undefined;

    fetchConfig(targetType, targetResourceId).then(function (data) {
      var experiment = data && data.experiment;
      if (!experiment || !experiment.variants || experiment.variants.length === 0) {
        return;
      }

      var variant = pickVariantForVisitor(visitorId, experiment.id, experiment.variants);
      applyVariant(block, experiment.id, variant);

      postEvent({
        experimentId: experiment.id,
        variantId: variant.id,
        visitorId: visitorId,
        type: "IMPRESSION",
      });

      if (experiment.goal === "ADD_TO_CART") {
        onAddToCart(function () {
          postEvent({
            experimentId: experiment.id,
            variantId: variant.id,
            visitorId: visitorId,
            type: "ADD_TO_CART",
          });
        });
      } else if (experiment.goal === "PURCHASE") {
        onAddToCart(function () {
          tagCartForPurchaseAttribution(experiment.id, variant.id, visitorId);
        });
      }
    });
  }

  function init() {
    var blocks = document.querySelectorAll("[data-shopsplit-block]");
    if (blocks.length === 0) return;

    installFetchAddToCartDetector();
    installFormAddToCartDetector();
    var visitorId = getVisitorId();
    for (var i = 0; i < blocks.length; i++) {
      initBlock(blocks[i], visitorId);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
