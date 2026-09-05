/**
 * billz - Swiggy & Instamart Content Script
 * In-page UI, crawler, and data sync for swiggy.com.
 */

(function() {
  if (window.__BILLZ_SWIGGY_CONTENT_LOADED__) return;
  window.__BILLZ_SWIGGY_CONTENT_LOADED__ = true;

  const Schema = window.BillzSchema;
  const SwiggyParser = window.SwiggyParser;
  const InstamartParser = window.InstamartParser;

  let swiggyOrders = new Map(); // orderNumber -> order
  let isFetchingAll = false;
  let isAutoClicking = false;
  let autoClickTimer = null;

  function isContextValid() {
    return typeof chrome !== "undefined" && chrome.runtime && !!chrome.runtime.id;
  }

  // Load existing orders from chrome.storage
  if (isContextValid() && chrome.storage && chrome.storage.local) {
    try {
      chrome.storage.local.get(["billz_all_orders"], (res) => {
        if (res && Array.isArray(res.billz_all_orders)) {
          res.billz_all_orders.forEach(o => {
            if ((o.platform === "swiggy" || o.platform === "instamart") && !Schema.isCancelledOrder(o)) {
              swiggyOrders.set(o.orderNumber, o);
            }
          });
        }
        updateUI();
      });
    } catch (e) {
      updateUI();
    }
  }

  function saveOrdersToStorage() {
    if (!isContextValid() || !chrome.storage || !chrome.storage.local) return;
    chrome.storage.local.get(["billz_all_orders"], (res) => {
      const existing = (res && Array.isArray(res.billz_all_orders)) ? res.billz_all_orders : [];
      const orderMap = new Map();
      existing.forEach(o => {
        if (o && o.orderNumber) orderMap.set(o.orderNumber, o);
      });
      swiggyOrders.forEach((newOrder, key) => {
        const oldOrder = orderMap.get(key);
        if (oldOrder) {
          if ((!newOrder.items || newOrder.items.length === 0) && (oldOrder.items && oldOrder.items.length > 0)) {
            newOrder.items = oldOrder.items;
            newOrder.itemsCount = oldOrder.itemsCount;
          }
        }
        orderMap.set(key, newOrder);
      });
      chrome.storage.local.set({ billz_all_orders: Array.from(orderMap.values()) });
    });
  }

  function ingestData(data) {
    let count = 0;
    if (SwiggyParser) {
      const foodOrders = SwiggyParser.parseOrderListingResponse(data);
      if (foodOrders && foodOrders.length > 0) {
        foodOrders.forEach(o => {
          swiggyOrders.set(o.orderNumber, o);
          count++;
        });
      }
    }
    if (InstamartParser) {
      const imOrders = InstamartParser.parseOrderListingResponse(data);
      if (imOrders && imOrders.length > 0) {
        imOrders.forEach(o => {
          swiggyOrders.set(o.orderNumber, o);
          count++;
        });
      }
    }

    if (count > 0) {
      saveOrdersToStorage();
      updateUI();
      showToast(`Captured ${count} orders! (Total tracked: ${swiggyOrders.size})`);
    }
  }

  /**
   * Find Swiggy "Show More Orders" button on the live page
   * Uses exact selector: div._2uho9 or text match
   */
  function findSwiggyShowMoreButton() {
    // 1. Direct class matcher from live site
    const direct = document.querySelector("div._2uho9");
    if (direct && direct.offsetParent !== null) return direct;

    // 2. Generic fallback by text content
    const elements = Array.from(document.querySelectorAll("div, button, a, span"));
    return elements.find(el => {
      const txt = (el.textContent || "").trim();
      return (
        txt === "Show More Orders" ||
        txt === "Show More Orders..." ||
        txt === "View More Orders" ||
        txt === "Show more orders"
      ) && el.offsetParent !== null && !el.closest("#swiggy-widget-root");
    }) || null;
  }

  function toggleAutoClick() {
    if (isAutoClicking) {
      stopAutoClick();
    } else {
      startAutoClick();
    }
  }

  function stopAutoClick() {
    isAutoClicking = false;
    clearTimeout(autoClickTimer);
    const btn = document.getElementById("swiggy-crawl-btn");
    if (btn) {
      btn.innerHTML = `<span>⚡</span><span>Auto-Click "Show More Orders"</span>`;
      btn.style.background = "";
    }
    showToast("Swiggy auto-clicker paused");
  }

  function startAutoClick() {
    isAutoClicking = true;
    const btn = document.getElementById("swiggy-crawl-btn");
    if (btn) {
      btn.innerHTML = `<span>⏹️</span><span>Stop Auto-Clicking (${swiggyOrders.size} Orders)</span>`;
      btn.style.background = "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)";
    }
    showToast("Starting Auto-Clicker on 'Show More Orders'...");
    clickNextShowMore();
  }

  function clickNextShowMore() {
    if (!isAutoClicking) return;

    const btn = findSwiggyShowMoreButton();
    if (btn) {
      btn.scrollIntoView({ behavior: "smooth", block: "center" });

      setTimeout(() => {
        if (!isAutoClicking) return;
        btn.click();
        const crawlBtn = document.getElementById("swiggy-crawl-btn");
        if (crawlBtn) {
          crawlBtn.innerHTML = `<span>⏹️</span><span>Stop Auto-Clicking (${swiggyOrders.size} Orders)</span>`;
        }
        autoClickTimer = setTimeout(clickNextShowMore, 2200);
      }, 400);
    } else {
      window.scrollBy({ top: 500, behavior: "smooth" });

      setTimeout(() => {
        if (!isAutoClicking) return;
        const retry = findSwiggyShowMoreButton();
        if (retry) {
          clickNextShowMore();
        } else {
          stopAutoClick();
          showToast(`🎉 All Swiggy orders loaded! Total ${swiggyOrders.size} orders captured.`);
        }
      }, 1500);
    }
  }

  /**
   * Direct API Cursor Paginator fallback for Swiggy Orders API
   */
  async function fetchAllSwiggyOrders() {
    if (isFetchingAll) return;
    isFetchingAll = true;

    const btn = document.getElementById("swiggy-sync-btn");
    if (btn) {
      btn.innerHTML = `<span>⏳</span><span>Syncing API...</span>`;
      btn.style.opacity = "0.7";
    }

    showToast("Calling Swiggy API /dapi/order/all...");

    let lastOrderId = "";
    let pageCount = 0;
    const maxPages = 100;

    try {
      while (isFetchingAll && pageCount < maxPages) {
        pageCount++;
        const url = lastOrderId
          ? `/dapi/order/all?order_id=${encodeURIComponent(lastOrderId)}`
          : `/dapi/order/all`;

        const resp = await fetch(url, {
          headers: { "Accept": "application/json" },
          credentials: "include"
        });

        if (!resp.ok) {
          console.warn("[billz:Swiggy] Request returned status:", resp.status);
          break;
        }

        const data = await resp.json();
        const rawOrders = (data.data && Array.isArray(data.data.orders))
          ? data.data.orders
          : (Array.isArray(data.orders) ? data.orders : []);

        if (rawOrders.length === 0) {
          break;
        }

        ingestData(data);

        // Update cursor to the last order ID
        const lastOrder = rawOrders[rawOrders.length - 1];
        const nextId = String(lastOrder.order_id || lastOrder.id || "");
        if (!nextId || nextId === lastOrderId) {
          break;
        }
        lastOrderId = nextId;

        await new Promise(r => setTimeout(r, 1200));
      }

      showToast(`🎉 Direct API sync complete! Total ${swiggyOrders.size} orders.`);
    } catch (err) {
      console.error("[billz:Swiggy] Error syncing orders:", err);
      showToast("Order sync finished or paused.");
    } finally {
      isFetchingAll = false;
      if (btn) {
        btn.innerHTML = `<span>🔄</span><span>Direct API Fetch</span>`;
        btn.style.opacity = "1";
      }
    }
  }

  function showToast(msg, duration = 3000) {
    const existing = document.querySelector(".swiggy-toast");
    if (existing) existing.remove();
    const t = document.createElement("div");
    t.className = "swiggy-toast";
    t.innerHTML = `<span>🍔</span><span>${msg}</span>`;
    document.body.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  function updateUI() {
    const orders = Array.from(swiggyOrders.values());
    const foodCount = orders.filter(o => o.platform === "swiggy").length;
    const instaCount = orders.filter(o => o.platform === "instamart").length;

    const badge = document.querySelector(".swiggy-pill-badge");
    if (badge) badge.textContent = `${orders.length} Orders`;

    const countEl = document.getElementById("swiggy-stat-orders");
    const spentEl = document.getElementById("swiggy-stat-spent");
    let total = 0;
    orders.forEach(o => total += (o.amount || 0));

    if (countEl) countEl.textContent = `${foodCount} Food • ${instaCount} Insta`;
    if (spentEl) spentEl.textContent = `₹${Math.round(total).toLocaleString("en-IN")}`;
  }

  // Interceptor listener
  window.addEventListener("message", (e) => {
    if (!e.data || e.data.source !== "BILLZ_SWIGGY_INTERCEPTOR") return;
    ingestData(e.data.response);
  });

  function renderWidget() {
    if (document.getElementById("swiggy-widget-root")) return;
    const root = document.createElement("div");
    root.id = "swiggy-widget-root";
    root.innerHTML = `
      <div class="swiggy-panel" id="swiggy-panel">
        <div class="swiggy-header">
          <div class="swiggy-title">
            <span>🍔</span>
            <span>billz • Swiggy & Instamart</span>
          </div>
          <button class="swiggy-close-btn" id="swiggy-close-btn">✕</button>
        </div>
        <div class="swiggy-body">
          <button class="swiggy-btn-hero" id="swiggy-open-dash-btn">
            <span>📊</span>
            <span>Open Multi-App Bills Dashboard</span>
          </button>
          <div class="swiggy-kpi-bar">
            <div class="kpi"><span class="num" id="swiggy-stat-orders">0</span><span class="lbl">Tracked</span></div>
            <div class="kpi"><span class="num" id="swiggy-stat-spent">₹0</span><span class="lbl">Total Spent</span></div>
          </div>
          <button class="swiggy-btn-sync" id="swiggy-crawl-btn">
            <span>⚡</span>
            <span>Auto-Click "Show More Orders"</span>
          </button>
          <button id="swiggy-sync-btn" style="background:#334155; color:#f8fafc; border:1px solid #475569; border-radius:8px; padding:8px; font-size:11px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
            <span>🔄</span>
            <span>Direct API Fetch</span>
          </button>
        </div>
      </div>
      <div class="swiggy-pill" id="swiggy-pill">
        <span>🍔</span>
        <span style="font-weight: 700;">billz</span>
        <span class="swiggy-pill-badge">0 Orders</span>
      </div>
    `;
    document.body.appendChild(root);

    const pill = document.getElementById("swiggy-pill");
    const panel = document.getElementById("swiggy-panel");
    const closeBtn = document.getElementById("swiggy-close-btn");
    const crawlBtn = document.getElementById("swiggy-crawl-btn");
    const syncBtn = document.getElementById("swiggy-sync-btn");
    const dashBtn = document.getElementById("swiggy-open-dash-btn");

    pill.addEventListener("click", () => panel.classList.toggle("active"));
    closeBtn.addEventListener("click", () => panel.classList.remove("active"));
    crawlBtn.addEventListener("click", toggleAutoClick);
    syncBtn.addEventListener("click", fetchAllSwiggyOrders);
    dashBtn.addEventListener("click", () => {
      if (isContextValid()) {
        chrome.runtime.sendMessage({ type: "OPEN_DASHBOARD" }, () => {
          if (chrome.runtime.lastError) window.open(chrome.runtime.getURL("dashboard.html"), "_blank");
        });
      }
    });

    updateUI();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderWidget);
  } else {
    renderWidget();
  }
})();
