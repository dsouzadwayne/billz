/**
 * billz - Instamart Injected Network Interceptor
 * Runs in the page MAIN context of instamart.in to capture Instamart order API traffic.
 */

(function() {
  if (window.__BILLZ_INSTAMART_INJECTED__) return;
  window.__BILLZ_INSTAMART_INJECTED__ = true;

  console.log("%c[billz:Instamart]%c Interceptor active on instamart.in", "color: #f97316; font-weight: bold;", "color: inherit;");

  function isInstamartOrderApi(url) {
    if (!url) return false;
    const lower = url.toLowerCase();
    return (
      lower.includes("/api/instamart/orders") ||
      lower.includes("instamart/orders") ||
      lower.includes("instamart/order") ||
      lower.includes("/order/all") ||
      lower.includes("order_type=dash") ||
      lower.includes("/dapi/order/")
    );
  }

  function dispatchCapture(url, data) {
    try {
      window.postMessage({
        source: "BILLZ_INSTAMART_INTERCEPTOR",
        url: url,
        response: data,
        timestamp: new Date().toISOString()
      }, "*");
    } catch (e) {
      console.warn("[billz:Instamart] Dispatch error:", e);
    }
  }

  // Intercept window.fetch
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const input = args[0];
    const url = typeof input === "string" ? input : (input && input.url ? input.url : "");

    let response;
    try {
      response = await originalFetch.apply(this, args);
    } catch (err) {
      throw err;
    }

    try {
      if (isInstamartOrderApi(url)) {
        const clone = response.clone();
        clone.text().then(text => {
          let data = text;
          try { data = JSON.parse(text); } catch (e) {}
          dispatchCapture(url, data);
        }).catch(() => {});
      }
    } catch (e) {}

    return response;
  };

  // Intercept XMLHttpRequest
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function(method, url) {
    this._billzUrl = url;
    return origOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function() {
    this.addEventListener("load", function() {
      try {
        if (isInstamartOrderApi(this._billzUrl)) {
          let parsed = this.responseText;
          try { parsed = JSON.parse(this.responseText); } catch (e) {}
          dispatchCapture(this._billzUrl, parsed);
        }
      } catch (e) {}
    });
    return origSend.apply(this, arguments);
  };
})();
