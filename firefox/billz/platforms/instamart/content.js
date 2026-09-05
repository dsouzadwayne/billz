/**
 * billz - Instamart Content Script
 * In-page UI, crawler, and data sync for instamart.in.
 */

(function() {
  if (window.__BILLZ_IM_CONTENT_LOADED__) return;
  window.__BILLZ_IM_CONTENT_LOADED__ = true;

  const Schema = window.BillzSchema;
  const Parser = window.InstamartParser;

  let imOrders = new Map(); // orderNumber -> order
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
            if (o.platform === "instamart" && !Schema.isCancelledOrder(o)) {
              imOrders.set(o.orderNumber, o);
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
      imOrders.forEach((newOrder, key) => {
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
    if (!Parser) return;
    const parsed = Parser.parseOrderListingResponse(data);
    if (parsed && parsed.length > 0) {
      parsed.forEach(o => imOrders.set(o.orderNumber, o));
      saveOrdersToStorage();
      updateUI();
      showToast(`Captured ${parsed.length} Instamart orders! (Total: ${imOrders.size})`);
    }
  }

  /**
   * Find Instamart "View More Orders" button on the live page
   * Uses exact selector: div._30qKR, div.eVnGNF or text match
   */
  function findInstamartShowMoreButton() {
    // 1. Direct class matcher from live site
    const direct = document.querySelector("div._30qKR, div.eVnGNF, div[class*='_30qKR']");
    if (direct && direct.offsetParent !== null) return direct;

    // 2. Generic fallback by text content
    const elements = Array.from(document.querySelectorAll("div, button, a, span"));
    return elements.find(el => {
      const txt = (el.textContent || "").trim();
      return (
        txt.includes("View More Orders") ||
        txt.includes("Show More Orders") ||
        txt.includes("Load More Orders")
      ) && el.offsetParent !== null && !el.closest("#im-widget-root");
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
    const btn = document.getElementById("im-crawl-btn");
    if (btn) {
      btn.innerHTML = `<span>⚡</span><span>Auto-Click "View More Orders"</span>`;
      btn.style.background = "";
    }
    showToast("Instamart auto-clicker paused");
  }

  function startAutoClick() {
    isAutoClicking = true;
    const btn = document.getElementById("im-crawl-btn");
    if (btn) {
      btn.innerHTML = `<span>⏹️</span><span>Stop Auto-Clicking (${imOrders.size} Orders)</span>`;
      btn.style.background = "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)";
    }
    showToast("Starting Auto-Clicker on 'View More Orders'...");
    clickNextShowMore();
  }

  function clickNextShowMore() {
    if (!isAutoClicking) return;

    const btn = findInstamartShowMoreButton();
    if (btn) {
      btn.scrollIntoView({ behavior: "smooth", block: "center" });

      setTimeout(() => {
        if (!isAutoClicking) return;
        btn.click();
        const crawlBtn = document.getElementById("im-crawl-btn");
        if (crawlBtn) {
          crawlBtn.innerHTML = `<span>⏹️</span><span>Stop Auto-Clicking (${imOrders.size} Orders)</span>`;
        }
        autoClickTimer = setTimeout(clickNextShowMore, 2200);
      }, 400);
    } else {
      window.scrollBy({ top: 500, behavior: "smooth" });

      setTimeout(() => {
        if (!isAutoClicking) return;
        const retry = findInstamartShowMoreButton();
        if (retry) {
          clickNextShowMore();
        } else {
          stopAutoClick();
          showToast(`🎉 All Instamart orders loaded! Total ${imOrders.size} orders captured.`);
        }
      }, 1500);
    }
  }

  /**
   * Direct API Cursor Paginator for instamart.in /api/instamart/orders API
   */
  async function fetchAllInstamartOrders() {
    if (isFetchingAll) return;
    isFetchingAll = true;

    const btn = document.getElementById("im-sync-btn");
    if (btn) {
      btn.innerHTML = `<span>⏳</span><span>Syncing API...</span>`;
      btn.style.opacity = "0.7";
    }

    showToast("Calling Instamart API /api/instamart/orders...");

    let fromTime = "";
    let pageCount = 0;
    const maxPages = 100;

    try {
      while (isFetchingAll && pageCount < maxPages) {
        pageCount++;
        const url = fromTime
          ? `/api/instamart/orders?order_type=DASH&count=10&from_time=${encodeURIComponent(fromTime)}`
          : `/api/instamart/orders?order_type=DASH&count=10`;

        const resp = await fetch(url, {
          headers: { "Accept": "application/json" },
          credentials: "include"
        });

        if (!resp.ok) {
          console.warn("[billz:Instamart] Request returned status:", resp.status);
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

        // Update cursor to the created_at of the last order
        const lastOrder = rawOrders[rawOrders.length - 1];
        const nextTime = String(lastOrder.created_at || (lastOrder.order_data_v2 && lastOrder.order_data_v2.created_at) || "");
        if (!nextTime || nextTime === fromTime) {
          break;
        }
        fromTime = nextTime;

        await new Promise(r => setTimeout(r, 1200));
      }

      showToast(`🎉 Direct API sync complete! Total ${imOrders.size} orders.`);
    } catch (err) {
      console.error("[billz:Instamart] Error syncing orders:", err);
      showToast("Sync paused or complete.");
    } finally {
      isFetchingAll = false;
      if (btn) {
        btn.innerHTML = `<span>🔄</span><span>Direct API Fetch</span>`;
        btn.style.opacity = "1";
      }
    }
  }

  function showToast(msg, duration = 3000) {
    const existing = document.querySelector(".im-toast");
    if (existing) existing.remove();
    const t = document.createElement("div");
    t.className = "im-toast";
    t.innerHTML = `<span>⚡</span><span>${msg}</span>`;
    document.body.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  function updateUI() {
    const orders = Array.from(imOrders.values());
    const badge = document.querySelector(".im-pill-badge");
    if (badge) badge.textContent = `${orders.length} Insta Orders`;

    const countEl = document.getElementById("im-stat-orders");
    const spentEl = document.getElementById("im-stat-spent");
    let total = 0;
    orders.forEach(o => total += (o.amount || 0));

    if (countEl) countEl.textContent = orders.length;
    if (spentEl) spentEl.textContent = `₹${Math.round(total).toLocaleString("en-IN")}`;
  }

  // Interceptor listener
  window.addEventListener("message", (e) => {
    if (!e.data || e.data.source !== "BILLZ_INSTAMART_INTERCEPTOR") return;
    ingestData(e.data.response);
  });

  function renderWidget() {
    if (document.getElementById("im-widget-root")) return;
    const root = document.createElement("div");
    root.id = "im-widget-root";
    root.innerHTML = `
      <div class="im-panel" id="im-panel">
        <div class="im-header">
          <div class="im-title">
            <span>⚡</span>
            <span>billz • Instamart</span>
          </div>
          <button class="im-close-btn" id="im-close-btn">✕</button>
        </div>
        <div class="im-body">
          <button class="im-btn-hero" id="im-open-dash-btn">
            <span>📊</span>
            <span>Open Multi-App Bills Dashboard</span>
          </button>
          <div class="im-kpi-bar">
            <div class="kpi"><span class="num" id="im-stat-orders">0</span><span class="lbl">Orders</span></div>
            <div class="kpi"><span class="num" id="im-stat-spent">₹0</span><span class="lbl">Total Spent</span></div>
          </div>
          <button class="im-btn-sync" id="im-crawl-btn">
            <span>⚡</span>
            <span>Auto-Click "View More Orders"</span>
          </button>
          <button id="im-sync-btn" style="background:#334155; color:#f8fafc; border:1px solid #475569; border-radius:8px; padding:8px; font-size:11px; font-weight:600; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;">
            <span>🔄</span>
            <span>Direct API Fetch</span>
          </button>
        </div>
      </div>
      <div class="im-pill" id="im-pill">
        <span>⚡</span>
        <span style="font-weight: 700;">billz</span>
        <span class="im-pill-badge">0 Insta Orders</span>
      </div>
    `;
    document.body.appendChild(root);

    const pill = document.getElementById("im-pill");
    const panel = document.getElementById("im-panel");
    const closeBtn = document.getElementById("im-close-btn");
    const crawlBtn = document.getElementById("im-crawl-btn");
    const syncBtn = document.getElementById("im-sync-btn");
    const dashBtn = document.getElementById("im-open-dash-btn");

    pill.addEventListener("click", () => panel.classList.toggle("active"));
    closeBtn.addEventListener("click", () => panel.classList.remove("active"));
    crawlBtn.addEventListener("click", toggleAutoClick);
    syncBtn.addEventListener("click", fetchAllInstamartOrders);
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
