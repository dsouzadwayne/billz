/**
 * billz Background Service Worker
 * Handles persistent state, badge count, downloads, and launching the dashboard.
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

function updateBadge(count) {
  chrome.action.setBadgeText({ text: count > 0 ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#10b981" });
}

function syncBadgeFromStorage() {
  chrome.storage.local.get(["billz_all_orders", "billz_cleared"], (res) => {
    if (res.billz_cleared) {
      updateBadge(0);
      return;
    }
    const orders = (res.billz_all_orders || []).filter(o => !isCancelledOrder(o));
    updateBadge(orders.length);
  });
}

// Automatically sync badge on storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    if (changes.billz_cleared && changes.billz_cleared.newValue) {
      updateBadge(0);
    } else if (changes.billz_all_orders) {
      const orders = (changes.billz_all_orders.newValue || []).filter(o => !isCancelledOrder(o));
      updateBadge(orders.length);
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "OPEN_DASHBOARD") {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
    sendResponse({ success: true });
    return true;
  }

  // Save file to computer via downloads API
  if (message.type === "DOWNLOAD_FILE") {
    const { filename, content, mimeType } = message;
    
    let dataUrl;
    if (mimeType.includes("json") || mimeType.includes("html") || mimeType.includes("text") || mimeType.includes("csv")) {
      dataUrl = `data:${mimeType};charset=utf-8,` + encodeURIComponent(content);
    } else {
      dataUrl = content;
    }

    chrome.downloads.download({
      url: dataUrl,
      filename: `billz_data/${filename}`,
      saveAs: false,
      conflictAction: "uniquify"
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error("[billz] Download error:", chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log(`[billz] File saved: billz_data/${filename}`);
        sendResponse({ success: true, downloadId, filename: `billz_data/${filename}` });
      }
    });

    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("[billz] Extension installed.");
  syncBadgeFromStorage();
});

chrome.runtime.onStartup.addListener(() => {
  syncBadgeFromStorage();
});

