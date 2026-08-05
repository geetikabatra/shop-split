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
  // Backstop for the anti-flicker hide: always longer than
  // FETCH_TIMEOUT_MS so the fetch's own timeout/catch path (which reveals
  // the block right away) gets a chance to fire first. This only kicks in
  // for something more catastrophic than a slow network, e.g. a script
  // error breaking the promise chain -- it must never leave a block
  // hidden forever.
  var REVEAL_TIMEOUT_MS = 2500;
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
  // can attribute the eventual order back to the right variant. Called at
  // impression time (see initBlock), not on an add-to-cart signal, so it
  // covers every checkout path that actually uses this cart -- which
  // notably excludes dynamic checkout buttons (see
  // hideDynamicCheckoutButtons below).

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

  // Second, independent attribution channel for PURCHASE-goal experiments.
  // Cart attributes (above) never reach an order placed through a dynamic
  // checkout button ("Buy it now", Shop Pay) -- that flow builds a
  // standalone checkout session that doesn't read the persistent cart at
  // all (confirmed live: the cart was tagged correctly, but the resulting
  // order still had zero note attributes). Dynamic checkout buttons are
  // rendered by Shopify's own script from the *current state of the
  // product form* (variant, quantity, and any hidden `properties[...]`
  // inputs), so tagging the form itself -- not the cart -- is the one
  // channel with a real chance of surviving that path. A leading
  // underscore keeps the property hidden from the customer-facing
  // cart/checkout UI (a documented Shopify convention) while it still
  // lands in the orders/paid webhook payload's line_items[].properties.
  //
  // Not yet verified live whether the dynamic checkout button actually
  // reads a property added to the form after its own script has already
  // parsed it -- hideDynamicCheckoutButtons() below stays in place as the
  // safe default until that's confirmed on a real dev store (see the
  // "True Buy it now support" issue in GITHUB_ISSUES.md).
  var LINE_ITEM_PROPERTY_PREFIX = "_shopsplit_";
  var PRODUCT_FORM_SELECTOR = 'form[action*="/cart/add"]';

  function tagLineItemPropertiesForPurchaseAttribution(experimentId, variantId, visitorId) {
    if (window.__shopsplitPropertiesTagged) return;
    window.__shopsplitPropertiesTagged = true;

    var propertyName = "properties[" + LINE_ITEM_PROPERTY_PREFIX + experimentId + "]";
    var propertyValue = variantId + ":" + visitorId;
    var forms = document.querySelectorAll(PRODUCT_FORM_SELECTOR);

    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('input[name="' + propertyName + '"]')) continue;
      var input = document.createElement("input");
      input.type = "hidden";
      input.name = propertyName;
      input.value = propertyValue;
      forms[i].appendChild(input);
    }
  }

  // Shopify renders dynamic checkout buttons ("Buy it now", Shop Pay, etc.)
  // inside a container with this class across virtually every theme
  // (Shopify's own script populates it, not the theme). The container
  // exists in the initial HTML even before that script runs, so hiding it
  // works regardless of injection timing.
  var DYNAMIC_CHECKOUT_BUTTON_SELECTOR = ".shopify-payment-button";

  function hideDynamicCheckoutButtons() {
    var buttons = document.querySelectorAll(DYNAMIC_CHECKOUT_BUTTON_SELECTOR);
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].style.display = "none";
    }
  }

  // ---- add-to-cart detection ----
  // Only used to report ADD_TO_CART conversion events for ADD_TO_CART-goal
  // experiments -- PURCHASE-goal cart tagging no longer depends on this
  // (see tagCartForPurchaseAttribution above). Two independent detectors,
  // since themes vary in how "Add to cart" actually submits: some AJAX
  // cart drawers call fetch("/cart/add.js"), while a plain product form
  // does a full-page POST to /cart/add with no fetch involved at all. Both
  // are wired to the same listener list.

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

  function revealBlock(block) {
    block.style.visibility = "";
  }

  function initBlock(block, visitorId) {
    var targetType = block.getAttribute("data-shopsplit-target-type");
    if (!targetType) {
      revealBlock(block);
      return;
    }
    var targetResourceId = block.getAttribute("data-shopsplit-target-resource-id") || undefined;

    var revealTimeoutId = setTimeout(function () {
      revealBlock(block);
    }, REVEAL_TIMEOUT_MS);

    fetchConfig(targetType, targetResourceId).then(function (data) {
      clearTimeout(revealTimeoutId);

      var experiment = data && data.experiment;
      if (!experiment || !experiment.variants || experiment.variants.length === 0) {
        revealBlock(block);
        return;
      }

      var variant = pickVariantForVisitor(visitorId, experiment.id, experiment.variants);
      applyVariant(block, experiment.id, variant);
      revealBlock(block);

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
        // Tag the cart as soon as the visitor is bucketed, rather than
        // waiting for an add-to-cart signal, so any checkout that actually
        // uses this cart carries the attribution through. Tagging early
        // means some carts that never convert get tagged too, but that's
        // just inert metadata -- not a false event.
        tagCartForPurchaseAttribution(experiment.id, variant.id, visitorId);

        // Second channel via the product form's line-item properties (see
        // the comment above tagLineItemPropertiesForPurchaseAttribution)
        // in case this reaches a dynamic-checkout-button order the cart
        // attribute above can't.
        tagLineItemPropertiesForPurchaseAttribution(experiment.id, variant.id, visitorId);

        // Still hidden as the safe default: even with the line-item
        // property channel above, it's unconfirmed live whether a dynamic
        // checkout button actually picks up a property added after its
        // own script parsed the form. Forcing the trackable Add to cart ->
        // Checkout path is the only *guaranteed* attribution here until
        // that's verified on a real dev store.
        hideDynamicCheckoutButtons();
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
