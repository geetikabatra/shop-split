/**
 * Fetches the active experiment for each ShopSplit block on the page via
 * the app proxy and swaps in the assigned variant's content. Fails closed:
 * any error, timeout, or "no active experiment" response leaves the
 * server-rendered control copy in place.
 *
 * Variant selection here is a simple weighted random pick, not yet sticky
 * per-visitor bucketing (that lands with the Assignment/cookie work).
 */
(function () {
  // Multiple ShopSplit blocks on one page each include this script tag;
  // only the first inclusion should actually run.
  if (window.__shopsplitLoaderLoaded) return;
  window.__shopsplitLoaderLoaded = true;

  var ENDPOINT = "/apps/shopsplit/config";
  var FETCH_TIMEOUT_MS = 2000;

  function pickVariant(variants) {
    var total = variants.reduce(function (sum, v) {
      return sum + v.weight;
    }, 0);
    if (total <= 0) return variants[0];

    var roll = Math.random() * total;
    var cumulative = 0;
    for (var i = 0; i < variants.length; i++) {
      cumulative += variants[i].weight;
      if (roll < cumulative) return variants[i];
    }
    return variants[variants.length - 1];
  }

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

  function fetchConfig(targetType, targetResourceId) {
    var params = new URLSearchParams({ targetType: targetType });
    if (targetResourceId) params.set("targetResourceId", targetResourceId);

    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId = controller
      ? setTimeout(function () {
          controller.abort();
        }, FETCH_TIMEOUT_MS)
      : null;

    return fetch(ENDPOINT + "?" + params.toString(), {
      signal: controller ? controller.signal : undefined,
      headers: { Accept: "application/json" },
    })
      .then(function (res) {
        if (timeoutId) clearTimeout(timeoutId);
        return res.ok ? res.json() : null;
      })
      .catch(function () {
        if (timeoutId) clearTimeout(timeoutId);
        return null;
      });
  }

  function initBlock(block) {
    var targetType = block.getAttribute("data-shopsplit-target-type");
    if (!targetType) return;
    var targetResourceId = block.getAttribute("data-shopsplit-target-resource-id") || undefined;

    fetchConfig(targetType, targetResourceId).then(function (data) {
      var experiment = data && data.experiment;
      if (!experiment || !experiment.variants || experiment.variants.length === 0) {
        return;
      }
      var variant = pickVariant(experiment.variants);
      applyVariant(block, experiment.id, variant);
    });
  }

  function init() {
    var blocks = document.querySelectorAll("[data-shopsplit-block]");
    for (var i = 0; i < blocks.length; i++) {
      initBlock(blocks[i]);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
