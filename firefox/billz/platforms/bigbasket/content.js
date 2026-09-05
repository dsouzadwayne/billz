/**
 * billz - BigBasket Content Script
 * In-page UI and crawler for bigbasket.com.
 */

(function() {
  if (window.__BILLZ_BB_CONTENT_LOADED__) return;
  window.__BILLZ_BB_CONTENT_LOADED__ = true;

  const Schema = window.BillzSchema;
  const Parser = window.BigBasketParser;

  let bbOrders = new Map();
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
            if (o.platform === "bigbasket" && !Schema.isCancelledOrder(o)) {
              bbOrders.set(o.orderNumber, o);
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
      bbOrders.forEach((newOrder, key) => {
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
      parsed.forEach(o => bbOrders.set(o.orderNumber, o));
      saveOrdersToStorage();
      updateUI();
      showToast(`Captured ${parsed.length} BigBasket orders! (Total: ${bbOrders.size})`);
    }
  }

  // Find BigBasket "Show more" button
  function findShowMoreButton() {
    const buttons = Array.from(document.querySelectorAll("button"));
    const exact = buttons.find(b => {
      const txt = (b.textContent || "").trim();
      return (txt === "Show more" || txt === "Show more...") && !b.closest("footer") && b.offsetParent !== null;
    });
    if (exact) return exact;

    const byClass = document.querySelector('button.hPSoeF, button[color="silverSurefer"]');
    if (byClass && !byClass.closest("footer") && byClass.offsetParent !== null) {
      return byClass;
    }
    return null;
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
    const btn = document.getElementById("bb-crawl-btn");
    if (btn) {
      btn.innerHTML = `<span>⚡</span><span>Auto-Click "Show more" (Load All)</span>`;
      btn.style.background = "linear-gradient(135deg, #10b981 0%, #059669 100%)";
    }
    showToast("BigBasket auto-clicker paused");
  }

  function startAutoClick() {
    isAutoClicking = true;
    const btn = document.getElementById("bb-crawl-btn");
    if (btn) {
      btn.innerHTML = `<span>⏹️</span><span>Stop Auto-Loading (${bbOrders.size} Orders)</span>`;
      btn.style.background = "linear-gradient(135deg, #ef4444 0%, #dc2626 100%)";
    }
    showToast("Starting Auto-Clicker on 'Show more'...");
    clickNextShowMore();
  }

  function clickNextShowMore() {
    if (!isAutoClicking) return;
    const btn = findShowMoreButton();
    if (btn) {
      btn.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => {
        if (!isAutoClicking) return;
        btn.click();
        const crawlBtn = document.getElementById("bb-crawl-btn");
        if (crawlBtn) crawlBtn.innerHTML = `<span>⏹️</span><span>Stop Auto-Loading (${bbOrders.size} Orders)</span>`;
        autoClickTimer = setTimeout(clickNextShowMore, 2200);
      }, 400);
    } else {
      window.scrollBy({ top: 500, behavior: "smooth" });
      setTimeout(() => {
        if (!isAutoClicking) return;
        const retry = findShowMoreButton();
        if (retry) {
          clickNextShowMore();
        } else {
          stopAutoClick();
          showToast(`🎉 All BigBasket orders loaded! Total ${bbOrders.size} orders captured.`);
        }
      }, 1500);
    }
  }

  function showToast(msg, duration = 3000) {
    const existing = document.querySelector(".bb-toast");
    if (existing) existing.remove();
    const t = document.createElement("div");
    t.className = "bb-toast";
    t.innerHTML = `<span>🛒</span><span>${msg}</span>`;
    document.body.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      setTimeout(() => t.remove(), 300);
    }, duration);
  }

  function updateUI() {
    const orders = Array.from(bbOrders.values()).sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    const badge = document.querySelector(".bb-pill-badge");
    if (badge) badge.textContent = `${orders.length} BB Orders`;

    const countEl = document.getElementById("bb-stat-orders");
    const spentEl = document.getElementById("bb-stat-spent");
    let total = 0;
    orders.forEach(o => total += (o.amount || 0));

    if (countEl) countEl.textContent = orders.length;
    if (spentEl) spentEl.textContent = `₹${Math.round(total).toLocaleString("en-IN")}`;
  }

  // Interceptor message listener
  window.addEventListener("message", (e) => {
    if (!e.data) return;
    if (e.data.source === "BILLZ_BB_INTERCEPTOR" || e.data.source === "BILLZ_INTERCEPTOR") {
      ingestData(e.data.response);
    }
  });

  function renderWidget() {
    if (document.getElementById("bb-widget-root")) return;
    const root = document.createElement("div");
    root.id = "bb-widget-root";
    root.innerHTML = `
      <div class="bb-panel" id="bb-panel">
        <div class="bb-header">
          <div class="bb-title">
            <span>🛒</span>
            <span>billz • BigBasket</span>
          </div>
          <button class="bb-close-btn" id="bb-close-btn">✕</button>
        </div>
        <div class="bb-body">
          <button class="bb-btn-hero" id="bb-open-dash-btn">
            <span>📊</span>
            <span>Open Bills Dashboard</span>
          </button>
          <div class="bb-kpi-bar">
            <div class="kpi"><span class="num" id="bb-stat-orders">0</span><span class="lbl">Orders</span></div>
            <div class="kpi"><span class="num" id="bb-stat-spent">₹0</span><span class="lbl">Total Spent</span></div>
          </div>
          <button class="bb-btn-crawl" id="bb-crawl-btn">
            <span>⚡</span>
            <span>Auto-Click "Show more" (Load All)</span>
          </button>
        </div>
      </div>
      <div class="bb-pill" id="bb-pill">
        <span>🛒</span>
        <span style="font-weight: 700;">billz</span>
        <span class="bb-pill-badge">0 BB Orders</span>
      </div>
    `;
    document.body.appendChild(root);

    const pill = document.getElementById("bb-pill");
    const panel = document.getElementById("bb-panel");
    const closeBtn = document.getElementById("bb-close-btn");
    const crawlBtn = document.getElementById("bb-crawl-btn");
    const dashBtn = document.getElementById("bb-open-dash-btn");

    pill.addEventListener("click", () => panel.classList.toggle("active"));
    closeBtn.addEventListener("click", () => panel.classList.remove("active"));
    crawlBtn.addEventListener("click", toggleAutoClick);
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
