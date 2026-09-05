/**
 * billz Extension Popup Logic
 */

function isCancelledOrder(o) {
  if (!o) return false;
  const pStatus = (o.paymentStatus || "").toLowerCase();
  const dStatus = (o.deliveryStatus || "").toLowerCase();
  const status = (o.status || "").toLowerCase();
  const dispStatus = (o.display_status || "").toLowerCase();
  const reasonText = (o.reason_text || "").toLowerCase();
  return (
    dStatus.includes("cancel") ||
    pStatus.includes("cancel") ||
    pStatus.includes("incomplete") ||
    pStatus.includes("failed") ||
    status.includes("cancel") ||
    dispStatus.includes("cancel") ||
    reasonText.includes("cancel") ||
    o.auto_cancelled === true ||
    o.is_cancelled === true
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function updateStats() {
  chrome.storage.local.get(["billz_all_orders", "billz_cleared"], (data) => {
    let orders = (data.billz_all_orders || []).filter(o => !isCancelledOrder(o));
    
    // Only fall back to sample seed on fresh install if not cleared
    if (!Array.isArray(data.billz_all_orders) && !data.billz_cleared) {
      fetch("sample_orders.json")
        .then(r => r.json())
        .then(samples => {
          orders = samples.filter(o => !isCancelledOrder(o));
          renderStats(orders);
        })
        .catch(() => renderStats([]));
      return;
    }

    renderStats(orders);
  });
}

function renderStats(orders) {
  let totalSpent = 0;
  const months = new Set();

  orders.forEach(o => {
    totalSpent += (parseFloat(o.amount) || 0);
    if (o.monthKey) months.add(o.monthKey);
  });

  document.getElementById("stat-orders").textContent = `${orders.length} orders`;
  document.getElementById("stat-spent").textContent = `₹${Math.round(totalSpent).toLocaleString("en-IN")}`;
  document.getElementById("stat-months").textContent = `${months.size} months`;
}

// Open Full Dashboard
document.getElementById("btn-open-dashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

// Download CSV
document.getElementById("btn-save-csv").addEventListener("click", () => {
  chrome.storage.local.get(["billz_all_orders"], (data) => {
    const raw = data.billz_all_orders || [];
    const orders = raw.filter(o => !isCancelledOrder(o));
    if (orders.length === 0) {
      alert("No orders captured yet. Click 'Open Full Bills Dashboard' or visit BigBasket!");
      return;
    }

    const headers = ["Platform", "Store / Restaurant", "Delivery Location", "Order Date", "Month", "Order Number", "Total Amount (INR)", "Savings (INR)", "Payment Status", "Payment Method", "Delivery Status", "Items Count", "Items Summary"];
    const rows = orders.map(o => {
      const itemsSummary = (o.items || []).map(i => `${i.quantity}x ${i.name} (${i.weight || ''}) [Rs ${i.totalPrice}]`).join(" | ");
      const cleanStore = (o.storeName || (o.platform === 'swiggy' ? 'Swiggy' : (o.platform === 'instamart' ? 'Instamart' : 'BigBasket'))).replace(/[\r\n]+/g, " ").replace(/"/g, '""');
      const cleanLocation = (o.location || 'Registered Address').replace(/[\r\n]+/g, " ").replace(/"/g, '""');
      const cleanSummary = itemsSummary.replace(/[\r\n]+/g, " ").replace(/"/g, '""');
      return [
        `"${o.platform || 'bigbasket'}"`,
        `"${cleanStore}"`,
        `"${cleanLocation}"`,
        `"${o.date || ''}"`,
        `"${o.monthKey || ''}"`,
        `"${o.orderNumber || ''}"`,
        o.amount || 0,
        o.savings || 0,
        `"${(o.paymentStatus || '').replace(/[\r\n]+/g, " ").replace(/"/g, '""')}"`,
        `"${(o.paymentMethod || '').replace(/[\r\n]+/g, " ").replace(/"/g, '""')}"`,
        `"${(o.deliveryStatus || '').replace(/[\r\n]+/g, " ").replace(/"/g, '""')}"`,
        o.itemsCount || 0,
        `"${cleanSummary}"`
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const timestamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([csvContent], { type: "text/csv" });
    downloadBlob(blob, `billz_orders_${timestamp}.csv`);
  });
});

// Download JSON
document.getElementById("btn-save-json").addEventListener("click", () => {
  chrome.storage.local.get(["billz_all_orders"], (data) => {
    const raw = data.billz_all_orders || [];
    const orders = raw.filter(o => !isCancelledOrder(o));
    const timestamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), total_orders: orders.length, orders: orders }, null, 2)], { type: "application/json" });
    downloadBlob(blob, `billz_orders_full_${timestamp}.json`);
  });
});

// Export Month Statement (PDF)
document.getElementById("btn-export-pdf")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html#months") });
});

// Open Platform Pages
document.getElementById("open-myorders")?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.bigbasket.com/member/active-orders/?nc=md" });
});

document.getElementById("open-swiggy")?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://www.swiggy.com/my-account/orders" });
});

document.getElementById("open-instamart")?.addEventListener("click", () => {
  chrome.tabs.create({ url: "https://instamart.in/account-details" });
});

// Clear Cache
document.getElementById("btn-clear-cache").addEventListener("click", () => {
  if (confirm("Clear cached orders?")) {
    chrome.storage.local.set({ billz_all_orders: [], billz_cleared: true, captured_count: 0 }, () => {
      chrome.action.setBadgeText({ text: "" });
      updateStats();
    });
  }
});

updateStats();
