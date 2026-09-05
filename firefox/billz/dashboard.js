/**
 * billz Dashboard Application Logic
 * Multi-platform Analytics, Pack-Size Variants, and Receipts (BigBasket, Swiggy, Instamart)
 */

let allOrders = [];
let currentFilterPlatform = "all";
let currentFilterLocation = "all";
let currentFilterMonth = "all";
let currentFilterStatus = "all";
let currentSearchTerm = "";
let currentView = "dashboard";
let selectedPriceProductKey = "";
let currentModalOrderNumber = "";

// Ensure all orders have valid platform, string address, and delivery location label
function normalizeOrder(o) {
  if (!o) return o;
  o.platform = o.platform || "bigbasket";

  // Ensure o.address is a clean string
  if (typeof BillzSchema !== "undefined" && BillzSchema.formatAddressString) {
    o.address = BillzSchema.formatAddressString(o.address);
  } else if (typeof o.address !== "string") {
    o.address = String(o.address || "Registered Address");
  }

  // Ensure o.location is a clean string
  if (typeof o.location === "string" && o.location.trim() && o.location !== "[object Object]") {
    o.location = o.location.trim();
  } else if (typeof BillzSchema !== "undefined" && BillzSchema.extractLocationLabel) {
    o.location = BillzSchema.extractLocationLabel(o.address);
  } else {
    o.location = "Registered Address";
  }

  return o;
}

// Filter out cancelled orders
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

// Sort orders in reverse chronological order (newest first)
function sortOrdersDesc(orders) {
  return (orders || []).slice().sort((a, b) => {
    const timeA = new Date(a.date || a.displayDate || 0).getTime() || 0;
    const timeB = new Date(b.date || b.displayDate || 0).getTime() || 0;
    return timeB - timeA;
  });
}

// ==========================================================================
// Product Variant & Pack Size Helpers (Distinguish e.g. 1 L vs 200 ml)
// ==========================================================================

function normalizeWeight(w) {
  if (!w) return "";
  let s = String(w).trim();
  // Standardize spacing (e.g. "1L" -> "1 L", "100g" -> "100 g", "200ml" -> "200 ml")
  s = s.replace(/(\d+)\s*(ml|l|g|kg|pcs|pc|units?|packs?|bunch|piece)/gi, "$1 $2");
  // Capitalize L
  s = s.replace(/\b([0-9.]+)\s*l\b/gi, "$1 L");
  s = s.replace(/\b([0-9.]+)\s*ML\b/gi, "$1 ml");
  s = s.replace(/\b([0-9.]+)\s*G\b/gi, "$1 g");
  s = s.replace(/\b([0-9.]+)\s*KG\b/gi, "$1 kg");
  return s.trim();
}

function getProductKey(item) {
  const name = (item.name || "").trim().toLowerCase();
  const weight = normalizeWeight(item.weight).toLowerCase();
  return weight ? `${name}___${weight}` : name;
}

function getProductDisplayName(item) {
  const name = (item.name || "").trim();
  const weight = normalizeWeight(item.weight);
  if (weight && !name.toLowerCase().includes(weight.toLowerCase())) {
    return `${name} (${weight})`;
  }
  return name;
}

// Extract all unique product variants across all orders
function getAllProductVariants() {
  const variantMap = {};
  allOrders.forEach(o => {
    (o.items || []).forEach(it => {
      const key = getProductKey(it);
      if (!key) return;
      if (!variantMap[key]) {
        variantMap[key] = {
          key,
          name: (it.name || "").trim(),
          displayName: getProductDisplayName(it),
          weight: normalizeWeight(it.weight),
          brand: (it.brand || "").trim(),
          imgUrl: it.imgUrl || "",
          totalQty: 0,
          ordersCount: 0,
          totalSpent: 0
        };
      }
      variantMap[key].totalQty += (it.quantity || 1);
      variantMap[key].ordersCount += 1;
      variantMap[key].totalSpent += (it.totalPrice || (it.unitPrice * (it.quantity || 1)) || 0);
      if (!variantMap[key].imgUrl && it.imgUrl) variantMap[key].imgUrl = it.imgUrl;
      if (!variantMap[key].brand && it.brand) variantMap[key].brand = (it.brand || "").trim();
      if (!variantMap[key].weight && it.weight) variantMap[key].weight = normalizeWeight(it.weight);
    });
  });
  return variantMap;
}

// ==========================================================================
// Theme Management (Dark Mode / Light Mode)
// ==========================================================================

function initTheme() {
  const savedTheme = localStorage.getItem("billz_theme") || "dark";
  applyTheme(savedTheme);
}

function toggleTheme() {
  const currentTheme = document.body.classList.contains("dark-mode") ? "dark" : "light";
  const newTheme = currentTheme === "dark" ? "light" : "dark";
  applyTheme(newTheme);
  localStorage.setItem("billz_theme", newTheme);
}

function applyTheme(theme) {
  const icon = document.getElementById("theme-toggle-icon");
  const label = document.getElementById("theme-toggle-label");

  if (theme === "dark") {
    document.body.classList.add("dark-mode");
    if (icon) icon.textContent = "☀️";
    if (label) label.textContent = "Light Mode";
  } else {
    document.body.classList.remove("dark-mode");
    if (icon) icon.textContent = "🌙";
    if (label) label.textContent = "Dark Mode";
  }
}

// ==========================================================================
// Initialization & Data Loading
// ==========================================================================

async function initDashboard() {
  initTheme();

  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["billz_all_orders", "billz_cleared"], async (res) => {
      if (Array.isArray(res.billz_all_orders) && res.billz_all_orders.length > 0) {
        allOrders = sortOrdersDesc(res.billz_all_orders.filter(o => !isCancelledOrder(o)).map(normalizeOrder));
      } else if (!res.billz_cleared) {
        const raw = await loadSampleSeed();
        allOrders = sortOrdersDesc(raw.filter(o => !isCancelledOrder(o)).map(normalizeOrder));
      } else {
        allOrders = [];
      }
      render();
    });

    // Listen for storage updates (e.g. from background sync)
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes.billz_all_orders) {
        const raw = changes.billz_all_orders.newValue || [];
        allOrders = sortOrdersDesc(raw.filter(o => !isCancelledOrder(o)).map(normalizeOrder));
        render();
      }
    });
  } else {
    const raw = await loadSampleSeed();
    allOrders = sortOrdersDesc(raw.filter(o => !isCancelledOrder(o)).map(normalizeOrder));
    render();
  }

  setupEventListeners();

  if (window.location.hash === "#months") {
    switchView("months");
  } else if (window.location.hash === "#items") {
    switchView("items");
  } else if (window.location.hash === "#price-history") {
    switchView("price-history");
  }
}

async function loadSampleSeed() {
  const allSeeds = [];

  // Load BigBasket Seeds
  try {
    const bbRes = await fetch("platforms/bigbasket/sample_orders.json");
    if (bbRes.ok) {
      const bb = await bbRes.json();
      bb.forEach(o => { o.platform = o.platform || "bigbasket"; allSeeds.push(o); });
    }
  } catch (e) {}

  // Load Swiggy Food Seeds
  try {
    const swgRes = await fetch("platforms/swiggy/sample_orders.json");
    if (swgRes.ok) {
      const swg = await swgRes.json();
      swg.forEach(o => { o.platform = o.platform || "swiggy"; allSeeds.push(o); });
    }
  } catch (e) {}

  // Load Swiggy Instamart Seeds
  try {
    const imRes = await fetch("platforms/instamart/sample_orders.json");
    if (imRes.ok) {
      const im = await imRes.json();
      im.forEach(o => { o.platform = o.platform || "instamart"; allSeeds.push(o); });
    }
  } catch (e) {}

  // Fallback to legacy sample_orders.json if needed
  if (allSeeds.length === 0) {
    try {
      const fallbackRes = await fetch("sample_orders.json");
      if (fallbackRes.ok) {
        const fb = await fallbackRes.json();
        fb.forEach(o => { o.platform = o.platform || "bigbasket"; allSeeds.push(o); });
      }
    } catch (e) {}
  }

  return allSeeds;
}

// ==========================================================================
// Event Listeners (CSP-safe delegation)
// ==========================================================================

function setupEventListeners() {
  // Theme Toggle Button
  document.getElementById("theme-toggle-btn")?.addEventListener("click", toggleTheme);

  // Navigation Menu Tabs
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      const view = btn.getAttribute("data-view");
      switchView(view);
    });
  });

  // Search Input
  const searchInput = document.getElementById("search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      currentSearchTerm = e.target.value.toLowerCase().trim();
      render();
    });
  }

  // Platform Filter Dropdown
  document.getElementById("platform-filter")?.addEventListener("change", (e) => {
    setPlatform(e.target.value);
  });

  // Location Filter Dropdown
  document.getElementById("location-filter")?.addEventListener("change", (e) => {
    currentFilterLocation = e.target.value;
    render();
  });

  // Sidebar Platform Tabs
  document.querySelectorAll(".platform-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const p = tab.getAttribute("data-platform");
      if (p) setPlatform(p);
    });
  });

  // Month & Status Filters
  document.getElementById("month-filter")?.addEventListener("change", (e) => {
    currentFilterMonth = e.target.value;
    render();
  });

  document.getElementById("status-filter")?.addEventListener("change", (e) => {
    currentFilterStatus = e.target.value;
    render();
  });

  // BigBasket Sync Button
  document.getElementById("btn-sync-bigbasket")?.addEventListener("click", () => {
    const bbUrl = "https://www.bigbasket.com/member/active-orders/?nc=md";
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.create({ url: bbUrl });
    } else {
      window.open(bbUrl, "_blank");
    }
  });

  // Swiggy & Instamart Sync Buttons
  document.getElementById("btn-sync-swiggy")?.addEventListener("click", () => {
    const swiggyUrl = "https://www.swiggy.com/my-account/orders";
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.create({ url: swiggyUrl });
    } else {
      window.open(swiggyUrl, "_blank");
    }
  });

  document.getElementById("btn-sync-instamart")?.addEventListener("click", () => {
    const imUrl = "https://instamart.in/account-details";
    if (typeof chrome !== "undefined" && chrome.tabs) {
      chrome.tabs.create({ url: imUrl });
    } else {
      window.open(imUrl, "_blank");
    }
  });

  // Export & Cache Clear
  document.getElementById("btn-export-csv")?.addEventListener("click", exportCSV);
  document.getElementById("btn-export-pdf")?.addEventListener("click", () => {
    exportMonthToPDF(currentFilterMonth !== "all" ? currentFilterMonth : null);
  });
  document.getElementById("btn-export-json")?.addEventListener("click", exportJSON);
  document.getElementById("btn-clear-cache")?.addEventListener("click", clearAllData);

  // Modal Close & Print
  document.getElementById("modal-close-btn")?.addEventListener("click", closeModal);
  document.getElementById("btn-modal-print-receipt")?.addEventListener("click", () => {
    if (currentModalOrderNumber) {
      printSingleOrder(currentModalOrderNumber);
    }
  });
  document.getElementById("order-modal")?.addEventListener("click", (e) => {
    if (e.target.id === "order-modal") closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" || e.key === "Esc") closeModal();
  });

  // Toggle All Months & Month Section PDF Export
  document.getElementById("btn-toggle-all-months")?.addEventListener("click", toggleAllMonths);
  document.getElementById("btn-export-current-month-pdf")?.addEventListener("click", () => {
    exportMonthToPDF(currentFilterMonth !== "all" ? currentFilterMonth : null);
  });

  // Price History Product Dropdown Change
  document.getElementById("price-product-select")?.addEventListener("change", (e) => {
    selectedPriceProductKey = e.target.value;
    renderPriceHistory(selectedPriceProductKey);
  });

  // Global CSP Event Delegation
  document.addEventListener("click", (e) => {
    // 0. Month Statement PDF Export Click
    const monthPdfBtn = e.target.closest("[data-action=\"export-month-pdf\"]");
    if (monthPdfBtn) {
      e.stopPropagation();
      const month = decodeURIComponent(monthPdfBtn.getAttribute("data-month") || "");
      if (month) {
        exportMonthToPDF(month);
      }
      return;
    }

    // 0.1 Single Order Print / PDF Click
    const printOrderBtn = e.target.closest("[data-action=\"print-order\"]");
    if (printOrderBtn) {
      e.stopPropagation();
      const orderNum = decodeURIComponent(printOrderBtn.getAttribute("data-order-number") || "");
      if (orderNum) {
        printSingleOrder(orderNum);
      }
      return;
    }

    // 1. Month Accordion Header Click
    const header = e.target.closest(".month-group-header");
    if (header) {
      header.closest(".month-group").classList.toggle("open");
      return;
    }

    // 2. View Receipt Button Click
    const receiptBtn = e.target.closest("[data-action=\"view-receipt\"]");
    if (receiptBtn) {
      const orderNum = decodeURIComponent(receiptBtn.getAttribute("data-order-number") || "");
      if (orderNum) {
        openOrderModal(orderNum);
      }
      return;
    }

    // 3. View Price History / Inspect Item / Quick Pick / Variant Switcher Click
    const itemHistoryBtn = e.target.closest("[data-action=\"view-item-history\"], [data-action=\"quick-pick\"], [data-action=\"switch-variant\"]");
    if (itemHistoryBtn) {
      const prodKey = decodeURIComponent(itemHistoryBtn.getAttribute("data-product-key") || itemHistoryBtn.getAttribute("data-product-name") || "");
      if (prodKey) {
        switchView("price-history", prodKey);
      }
      return;
    }

    // 4. Delivery Location Filter Click
    const locBtn = e.target.closest("[data-action=\"filter-location\"]");
    if (locBtn) {
      const loc = decodeURIComponent(locBtn.getAttribute("data-location") || "");
      if (loc) {
        setLocationFilter(loc);
      }
      return;
    }
  });
}

function setLocationFilter(location) {
  if (currentFilterLocation === location) {
    currentFilterLocation = "all";
  } else {
    currentFilterLocation = location || "all";
  }
  const sel = document.getElementById("location-filter");
  if (sel) sel.value = currentFilterLocation;
  render();
}

// ==========================================================================
// View Switching & Navigation
// ==========================================================================

function switchView(view, targetProductKey = null) {
  currentView = view;

  // Update Nav menu buttons
  document.querySelectorAll(".nav-item").forEach(btn => {
    if (btn.getAttribute("data-view") === view) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Hide all sections
  const secOverview = document.getElementById("section-overview");
  const secMonths = document.getElementById("section-months");
  const secItems = document.getElementById("section-items");
  const secPrice = document.getElementById("section-price-history");

  if (secOverview) secOverview.style.display = (view === "dashboard") ? "block" : "none";
  if (secMonths) secMonths.style.display = (view === "months") ? "block" : "none";
  if (secItems) secItems.style.display = (view === "items") ? "block" : "none";
  if (secPrice) secPrice.style.display = (view === "price-history") ? "block" : "none";

  // If switched to price history with a specific product key
  if (view === "price-history") {
    if (targetProductKey) {
      selectedPriceProductKey = targetProductKey;
    }
    populatePriceProductSelect();
    if (selectedPriceProductKey) {
      const sel = document.getElementById("price-product-select");
      if (sel) sel.value = selectedPriceProductKey;
      renderPriceHistory(selectedPriceProductKey);
    }
  } else if (view === "items") {
    renderItemsTable();
  }
}

function setPlatform(platform) {
  currentFilterPlatform = platform || "all";
  const sel = document.getElementById("platform-filter");
  if (sel) sel.value = currentFilterPlatform;
  document.querySelectorAll(".platform-tab").forEach(tab => {
    tab.classList.toggle("active", tab.getAttribute("data-platform") === currentFilterPlatform);
  });
  render();
}

function toggleAllMonths() {
  const groups = document.querySelectorAll(".month-group");
  if (!groups.length) return;
  const anyOpen = Array.from(groups).some(g => g.classList.contains("open"));
  groups.forEach(g => {
    if (anyOpen) g.classList.remove("open");
    else g.classList.add("open");
  });
}

// ==========================================================================
// Data Filtering
// ==========================================================================

function getFilteredOrders() {
  return allOrders.filter(o => {
    if (isCancelledOrder(o)) return false;

    // Platform filter
    if (currentFilterPlatform !== "all") {
      const orderPlatform = o.platform || "bigbasket";
      if (orderPlatform !== currentFilterPlatform) return false;
    }

    // Location filter
    if (currentFilterLocation !== "all") {
      const orderLoc = (o.location || "").trim();
      if (orderLoc !== currentFilterLocation) return false;
    }

    // Month filter
    if (currentFilterMonth !== "all" && o.monthKey !== currentFilterMonth) {
      return false;
    }

    // Status filter
    if (currentFilterStatus !== "all") {
      const pStatus = (o.paymentStatus || "").toLowerCase();
      const pMethod = (o.paymentMethod || "").toLowerCase();
      if (currentFilterStatus === "paid" && !pStatus.includes("paid") && !pStatus.includes("success")) return false;
      if (currentFilterStatus === "cod" && !pMethod.includes("cod") && !pStatus.includes("cash")) return false;
    }

    // Search term
    if (currentSearchTerm) {
      const orderNum = String(o.orderNumber || "").toLowerCase();
      const addr = String(o.address || "").toLowerCase();
      const loc = String(o.location || "").toLowerCase();
      const hasItem = (o.items || []).some(item =>
        String(item.name || "").toLowerCase().includes(currentSearchTerm) ||
        String(item.brand || "").toLowerCase().includes(currentSearchTerm) ||
        String(item.weight || "").toLowerCase().includes(currentSearchTerm)
      );
      if (!orderNum.includes(currentSearchTerm) && !addr.includes(currentSearchTerm) && !loc.includes(currentSearchTerm) && !hasItem) {
        return false;
      }
    }

    return true;
  });
}

// ==========================================================================
// Master Render Function
// ==========================================================================

function render() {
  populateLocationFilter();
  populateMonthFilter();
  const filtered = getFilteredOrders();

  renderKPIs(filtered);
  renderOverviewStats(filtered);
  renderMonthsAccordion(filtered);
  populatePriceProductSelect();

  if (currentView === "items") {
    renderItemsTable();
  } else if (currentView === "price-history" && selectedPriceProductKey) {
    renderPriceHistory(selectedPriceProductKey);
  }
}

// ==========================================================================
// 1. KPI Cards
// ==========================================================================

function renderKPIs(orders) {
  let totalSpent = 0;
  let totalSavings = 0;
  let totalItemsCount = 0;
  const uniqueProducts = new Set();
  const months = new Set();

  orders.forEach(o => {
    totalSpent += (o.amount || 0);
    totalSavings += (o.savings || 0);
    if (o.monthKey) months.add(o.monthKey);
    (o.items || []).forEach(it => {
      totalItemsCount += (it.quantity || 1);
      const key = getProductKey(it);
      if (key) uniqueProducts.add(key);
    });
  });

  const avgOrder = orders.length > 0 ? totalSpent / orders.length : 0;

  document.getElementById("kpi-total-spent").textContent = `₹${Math.round(totalSpent).toLocaleString("en-IN")}`;
  document.getElementById("kpi-avg-order").textContent = `Avg ₹${Math.round(avgOrder).toLocaleString("en-IN")} / order`;
  document.getElementById("kpi-total-orders").textContent = orders.length;
  document.getElementById("kpi-months-count").textContent = `across ${months.size} month${months.size === 1 ? "" : "s"}`;
  document.getElementById("kpi-total-savings").textContent = `₹${Math.round(totalSavings).toLocaleString("en-IN")}`;
  document.getElementById("kpi-total-items").textContent = totalItemsCount;
  document.getElementById("kpi-unique-items").textContent = `${uniqueProducts.size} unique products`;
}

function populateLocationFilter() {
  const select = document.getElementById("location-filter");
  if (!select) return;

  const currentVal = currentFilterLocation;
  const locMap = {};

  const baseOrders = (currentFilterPlatform === "all")
    ? allOrders
    : allOrders.filter(o => (o.platform || "bigbasket") === currentFilterPlatform);

  baseOrders.forEach(o => {
    const loc = (o.location || "").trim();
    if (loc) {
      locMap[loc] = (locMap[loc] || 0) + 1;
    }
  });

  select.innerHTML = '<option value="all">📍 All Delivery Locations</option>';

  const sortedLocations = Object.entries(locMap).sort((a, b) => b[1] - a[1]);
  sortedLocations.forEach(([loc, count]) => {
    const opt = document.createElement("option");
    opt.value = loc;
    opt.textContent = `📍 ${loc} (${count} orders)`;
    select.appendChild(opt);
  });

  if (currentVal && locMap[currentVal]) {
    select.value = currentVal;
  } else {
    select.value = "all";
    currentFilterLocation = "all";
  }
}

function populateMonthFilter() {
  const select = document.getElementById("month-filter");
  if (!select) return;

  const currentVal = currentFilterMonth;
  const months = new Set();
  const baseOrders = (currentFilterPlatform === "all")
    ? allOrders
    : allOrders.filter(o => (o.platform || "bigbasket") === currentFilterPlatform);

  baseOrders.forEach(o => { if (o.monthKey && !isCancelledOrder(o)) months.add(o.monthKey); });

  select.innerHTML = "<option value=\"all\">All Months</option>";
  months.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    select.appendChild(opt);
  });

  if (currentVal && months.has(currentVal)) {
    select.value = currentVal;
  } else {
    select.value = "all";
    currentFilterMonth = "all";
  }
}

// ==========================================================================
// 2. Overview Statistics Spotlight
// ==========================================================================

function renderOverviewStats(orders) {
  if (orders.length === 0) {
    document.getElementById("stat-expensive-amount").textContent = "₹0";
    document.getElementById("stat-expensive-date").textContent = "-";
    document.getElementById("stat-expensive-id").textContent = "-";
    document.getElementById("stat-expensive-payment").textContent = "-";
    document.getElementById("stat-expensive-items-list").innerHTML = "<span style=\"color: var(--text-faint); font-size: 12px;\">No orders available</span>";
    document.getElementById("btn-view-expensive-receipt").style.display = "none";

    document.getElementById("stat-peak-month-amount").textContent = "₹0";
    document.getElementById("stat-peak-month-name").textContent = "-";
    document.getElementById("stat-peak-month-orders").textContent = "0 orders";
    document.getElementById("stat-peak-month-avg").textContent = "₹0";

    document.getElementById("leaderboard-items-list").innerHTML = "<div style=\"color: var(--text-faint); font-size: 12px; padding: 10px;\">No items found</div>";
    document.getElementById("leaderboard-brands-list").innerHTML = "<div style=\"color: var(--text-faint); font-size: 12px; padding: 10px;\">No brands found</div>";
    const locList = document.getElementById("leaderboard-locations-list");
    if (locList) locList.innerHTML = "<div style=\"color: var(--text-faint); font-size: 12px; padding: 10px;\">No location data found</div>";
    const locBadge = document.getElementById("stat-locations-count-badge");
    if (locBadge) locBadge.textContent = "0 Locations";
    return;
  }

  // A. Most Expensive Order
  let maxOrder = orders[0];
  orders.forEach(o => {
    if ((o.amount || 0) > (maxOrder.amount || 0)) {
      maxOrder = o;
    }
  });

  document.getElementById("stat-expensive-amount").textContent = `₹${Math.round(maxOrder.amount || 0).toLocaleString("en-IN")}`;
  document.getElementById("stat-expensive-date").textContent = maxOrder.date || maxOrder.displayDate || "N/A";
  document.getElementById("stat-expensive-id").textContent = maxOrder.orderId || maxOrder.orderNumber || "N/A";
  document.getElementById("stat-expensive-payment").textContent = `${maxOrder.paymentMethod || "Online"} (${maxOrder.paymentStatus || "Delivered"})`;

  const expensiveBtn = document.getElementById("btn-view-expensive-receipt");
  if (expensiveBtn) {
    expensiveBtn.style.display = "inline-flex";
    expensiveBtn.setAttribute("data-order-number", encodeURIComponent(maxOrder.orderNumber || ""));
  }

  // Render preview chips of highest-value items in that order
  const chipsContainer = document.getElementById("stat-expensive-items-list");
  if (chipsContainer) {
    const sortedItems = [...(maxOrder.items || [])].sort((a, b) => (b.totalPrice || 0) - (a.totalPrice || 0));
    chipsContainer.innerHTML = sortedItems.slice(0, 4).map(it => {
      const weightStr = normalizeWeight(it.weight);
      return `
        <div class="preview-chip" title="${it.name} (${weightStr})">
          ${it.imgUrl ? `<img src="${it.imgUrl}" class="preview-chip-img" alt="" loading="lazy">` : "🛍️"}
          <span>${it.quantity}x ${it.name.slice(0, 16)}${it.name.length > 16 ? "..." : ""}${weightStr ? ' (' + weightStr + ')' : ''}</span>
          <span class="preview-chip-price">₹${it.totalPrice || it.unitPrice}</span>
        </div>
      `;
    }).join("");
  }

  // B. Highest Spending Month
  const monthMap = {};
  orders.forEach(o => {
    const m = o.monthKey || "Unknown";
    if (!monthMap[m]) monthMap[m] = { total: 0, count: 0 };
    monthMap[m].total += (o.amount || 0);
    monthMap[m].count += 1;
  });

  let peakMonthName = "-";
  let peakMonthTotal = 0;
  let peakMonthCount = 0;
  for (const [m, data] of Object.entries(monthMap)) {
    if (data.total > peakMonthTotal) {
      peakMonthTotal = data.total;
      peakMonthName = m;
      peakMonthCount = data.count;
    }
  }

  const peakAvg = peakMonthCount > 0 ? Math.round(peakMonthTotal / peakMonthCount) : 0;
  document.getElementById("stat-peak-month-amount").textContent = `₹${Math.round(peakMonthTotal).toLocaleString("en-IN")}`;
  document.getElementById("stat-peak-month-name").textContent = peakMonthName;
  document.getElementById("stat-peak-month-orders").textContent = `${peakMonthCount} orders`;
  document.getElementById("stat-peak-month-avg").textContent = `Avg ₹${peakAvg.toLocaleString("en-IN")} / order`;

  // C. Top Most Ordered Items Leaderboard (Differentiating Variants/Pack Sizes)
  const itemMap = {};
  orders.forEach(o => {
    (o.items || []).forEach(it => {
      const key = getProductKey(it);
      if (!key) return;
      if (!itemMap[key]) {
        itemMap[key] = {
          key,
          name: (it.name || "").trim(),
          displayName: getProductDisplayName(it),
          brand: it.brand || "",
          weight: normalizeWeight(it.weight),
          totalQty: 0,
          ordersCount: 0,
          totalSpent: 0,
          imgUrl: it.imgUrl || "",
          unitPrices: []
        };
      }
      itemMap[key].totalQty += (it.quantity || 1);
      itemMap[key].ordersCount += 1;
      itemMap[key].totalSpent += (it.totalPrice || (it.unitPrice * (it.quantity || 1)) || 0);
      if (it.unitPrice) itemMap[key].unitPrices.push(it.unitPrice);
      if (!itemMap[key].imgUrl && it.imgUrl) itemMap[key].imgUrl = it.imgUrl;
      if (!itemMap[key].brand && it.brand) itemMap[key].brand = it.brand;
      if (!itemMap[key].weight && it.weight) itemMap[key].weight = normalizeWeight(it.weight);
    });
  });

  const sortedItems = Object.values(itemMap).sort((a, b) => b.totalQty - a.totalQty);
  const topItems = sortedItems.slice(0, 5);

  const leaderboardContainer = document.getElementById("leaderboard-items-list");
  if (leaderboardContainer) {
    if (topItems.length === 0) {
      leaderboardContainer.innerHTML = "<div style=\"color: var(--text-faint); font-size: 12px; padding: 10px;\">No items found</div>";
    } else {
      leaderboardContainer.innerHTML = topItems.map((item, idx) => {
        const rankClass = idx === 0 ? "rank-1" : idx === 1 ? "rank-2" : idx === 2 ? "rank-3" : "";
        const encodedKey = encodeURIComponent(item.key);
        return `
          <div class="leaderboard-row">
            <div class="rank-badge ${rankClass}">#${idx + 1}</div>
            ${item.imgUrl ? `<img src="${item.imgUrl}" class="item-thumb" alt="" loading="lazy">` : "<div class=\"item-thumb\" style=\"display:flex;align-items:center;justify-content:center;\">🛍️</div>"}
            <div class="leaderboard-info">
              <span class="leaderboard-name" title="${item.displayName}">${item.name}</span>
              <span class="leaderboard-sub">${item.brand ? item.brand + " • " : ""}${item.weight ? item.weight : "Standard Pack"}</span>
            </div>
            <div class="leaderboard-stats">
              <span class="leaderboard-amount">₹${Math.round(item.totalSpent).toLocaleString("en-IN")}</span>
              <span class="leaderboard-units">${item.totalQty} units (${item.ordersCount} orders)</span>
              <button class="btn-inspect-link" data-action="view-item-history" data-product-key="${encodedKey}">Price History ➔</button>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // D. Top Brands by Spend
  const brandMap = {};
  let totalBrandSpend = 0;
  orders.forEach(o => {
    (o.items || []).forEach(it => {
      const b = (it.brand || "").trim();
      if (!b || b === "-" || b.toLowerCase() === "unknown") return;
      const spent = (it.totalPrice || (it.unitPrice * (it.quantity || 1)) || 0);
      if (!brandMap[b]) brandMap[b] = { brand: b, totalSpent: 0, itemsCount: 0 };
      brandMap[b].totalSpent += spent;
      brandMap[b].itemsCount += (it.quantity || 1);
      totalBrandSpend += spent;
    });
  });

  const topBrands = Object.values(brandMap).sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 5);
  const brandsContainer = document.getElementById("leaderboard-brands-list");
  if (brandsContainer) {
    if (topBrands.length === 0) {
      brandsContainer.innerHTML = "<div style=\"color: var(--text-faint); font-size: 12px; padding: 10px;\">No brand data found</div>";
    } else {
      brandsContainer.innerHTML = topBrands.map((b, idx) => {
        const pct = totalBrandSpend > 0 ? Math.round((b.totalSpent / totalBrandSpend) * 100) : 0;
        return `
          <div class="leaderboard-row">
            <div class="rank-badge">#${idx + 1}</div>
            <div class="leaderboard-info">
              <span class="leaderboard-name">${b.brand}</span>
              <span class="leaderboard-sub">${b.itemsCount} products purchased (${pct}% of grocery spend)</span>
            </div>
            <div class="leaderboard-stats">
              <span class="leaderboard-amount">₹${Math.round(b.totalSpent).toLocaleString("en-IN")}</span>
              <span class="leaderboard-units">${pct}% share</span>
            </div>
          </div>
        `;
      }).join("");
    }
  }

  // E. Spend by Delivery Location Leaderboard
  const locationMap = {};
  let totalLocationSpend = 0;

  orders.forEach(o => {
    const loc = (o.location || "").trim() || "Registered Address";
    if (!locationMap[loc]) {
      locationMap[loc] = {
        location: loc,
        totalSpent: 0,
        ordersCount: 0,
        itemsCount: 0,
        addressSample: o.address || ""
      };
    }
    locationMap[loc].totalSpent += (o.amount || 0);
    locationMap[loc].ordersCount += 1;
    locationMap[loc].itemsCount += ((o.items || []).length || o.itemsCount || 1);
    totalLocationSpend += (o.amount || 0);
  });

  const sortedLocations = Object.values(locationMap).sort((a, b) => b.totalSpent - a.totalSpent);
  const locationsCountBadge = document.getElementById("stat-locations-count-badge");
  if (locationsCountBadge) {
    locationsCountBadge.textContent = `${sortedLocations.length} Location${sortedLocations.length === 1 ? "" : "s"}`;
  }

  const locationsContainer = document.getElementById("leaderboard-locations-list");
  if (locationsContainer) {
    if (sortedLocations.length === 0) {
      locationsContainer.innerHTML = '<div style="color: var(--text-faint); font-size: 12px; padding: 10px;">No location data found</div>';
    } else {
      locationsContainer.innerHTML = sortedLocations.map((locData, idx) => {
        const pct = totalLocationSpend > 0 ? Math.round((locData.totalSpent / totalLocationSpend) * 100) : 0;
        const avgPerOrder = locData.ordersCount > 0 ? Math.round(locData.totalSpent / locData.ordersCount) : 0;
        const isCurrentFilter = currentFilterLocation === locData.location;
        const encLoc = encodeURIComponent(locData.location);

        return `
          <div class="location-leaderboard-row ${isCurrentFilter ? 'active-filter' : ''}">
            <div class="location-pin-icon">📍</div>
            <div class="location-info">
              <div class="location-name">
                <span>${locData.location}</span>
                ${isCurrentFilter ? '<span class="location-active-badge">Active Filter</span>' : ''}
              </div>
              <span class="location-sub">${locData.ordersCount} order${locData.ordersCount === 1 ? '' : 's'} • Avg ₹${avgPerOrder.toLocaleString("en-IN")} / order • ${locData.itemsCount} items</span>
              <div class="location-bar-track">
                <div class="location-bar-fill" style="width: ${Math.max(pct, 3)}%;"></div>
              </div>
            </div>
            <div class="location-stats">
              <span class="location-amount">₹${Math.round(locData.totalSpent).toLocaleString("en-IN")}</span>
              <span class="location-pct-badge">${pct}% share</span>
              <button class="btn-filter-location-action" data-action="filter-location" data-location="${encLoc}">
                ${isCurrentFilter ? 'Clear Filter ✕' : 'Filter by Address ➔'}
              </button>
            </div>
          </div>
        `;
      }).join("");
    }
  }
}

// ==========================================================================
// 3. Month-Wise Bills with Direct In-Order Item Breakdown
// ==========================================================================

function renderMonthsAccordion(orders) {
  const container = document.getElementById("months-accordion");
  if (!container) return;

  if (orders.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 40px; color: var(--text-faint); font-size: 14px;">
        No orders match your filter criteria.<br>Try resetting search or filters.
      </div>
    `;
    return;
  }

  // Ensure reverse chronological sorting (newest months & orders first)
  const sortedOrders = sortOrdersDesc(orders);

  // Group by Month
  const groups = {};
  sortedOrders.forEach(o => {
    const m = o.monthKey || "Unknown";
    if (!groups[m]) {
      groups[m] = { month: m, totalSpent: 0, totalSavings: 0, orders: [] };
    }
    groups[m].totalSpent += (o.amount || 0);
    groups[m].totalSavings += (o.savings || 0);
    groups[m].orders.push(o);
  });

  let html = "";
  let isFirst = true;

  for (const [month, group] of Object.entries(groups)) {
    const isOpen = isFirst ? "open" : "";
    isFirst = false;

    html += `
      <div class="month-group ${isOpen}">
        <div class="month-group-header">
          <div class="month-group-title">
            <h3>📅 ${month}</h3>
            <span class="month-badge">${group.orders.length} orders</span>
          </div>
          <div class="month-group-stats">
            <span class="month-stat-amount">₹${Math.round(group.totalSpent).toLocaleString("en-IN")}</span>
            <span class="month-stat-savings">Saved ₹${Math.round(group.totalSavings).toLocaleString("en-IN")}</span>
            <button class="btn-month-pdf" data-action="export-month-pdf" data-month="${encodeURIComponent(month)}" title="Export ${month} Statement as PDF">
              📄 Export Month (PDF)
            </button>
            <span class="chevron">▼</span>
          </div>
        </div>

        <div class="month-orders-container">
          ${group.orders.map(o => renderOrderCard(o)).join("")}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;
}

function renderOrderCard(o) {
  const statusLower = (o.paymentStatus || "").toLowerCase();
  let tagClass = "paid";
  if (statusLower.includes("incomplete") || statusLower.includes("failed")) tagClass = "incomplete";
  else if (statusLower.includes("cash") || (o.paymentMethod || "").toLowerCase().includes("cod")) tagClass = "cod";

  const platform = o.platform || "bigbasket";
  const platformMeta = {
    bigbasket: { name: "BigBasket", icon: "🛒", cls: "platform-badge-bb" },
    swiggy: { name: "Swiggy Food", icon: "🍔", cls: "platform-badge-swiggy" },
    instamart: { name: "Instamart", icon: "⚡", cls: "platform-badge-instamart" }
  }[platform] || { name: "Order", icon: "📦", cls: "" };

  const encodedNum = encodeURIComponent(o.orderNumber || "");
  const items = o.items || [];

  return `
    <div class="order-card">
      <div class="order-card-header">
        <div class="order-header-left">
          <div class="order-tags-row">
            <span class="order-platform-tag ${platformMeta.cls}">${platformMeta.icon} ${o.storeName || platformMeta.name}</span>
            <span class="order-location-tag" title="${(o.address || o.location || '').replace(/"/g, '&quot;')}">📍 ${o.location || "Registered Address"}</span>
          </div>
          <span class="order-card-date">📅 ${o.date || o.displayDate || "N/A"}</span>
          <span class="order-card-slot">${o.deliverySlot || o.deliveryTime || "Standard Delivery"}</span>
          <span class="order-card-num">Order ID: ${(o.orderNumber || "").slice(-18)}</span>
        </div>

        <div class="order-header-right">
          <div class="order-price-block">
            <span class="order-amount">₹${(o.amount || 0).toLocaleString("en-IN")}</span>
            ${o.savings > 0 ? `<span class="order-savings-pill">Saved ₹${o.savings.toLocaleString("en-IN")}</span>` : ""}
          </div>
          <div>
            <span class="status-tag ${tagClass}">${o.paymentStatus || "Delivered"}</span>
          </div>
          <div class="order-actions-row">
            <button class="btn-view-receipt" data-action="view-receipt" data-order-number="${encodedNum}">
              🧾 Full Receipt
            </button>
            <button class="btn-order-print" data-action="print-order" data-order-number="${encodedNum}" title="Print or Save Order Receipt as PDF">
              🖨️ PDF
            </button>
          </div>
        </div>
      </div>

      <!-- Itemized In-Order Breakdown -->
      <div class="order-items-container">
        ${items.length === 0 ? `
          <div style="font-size: 12px; color: var(--text-faint); padding: 8px;">No line items detailed for this order.</div>
        ` : items.map(it => {
          const itemKey = getProductKey(it);
          const encKey = encodeURIComponent(itemKey);
          const weightLabel = normalizeWeight(it.weight);
          return `
            <div class="in-order-item-row">
              ${it.imgUrl ? `<img src="${it.imgUrl}" class="in-order-item-thumb" alt="" loading="lazy">` : "<div class=\"in-order-item-thumb\" style=\"display:flex;align-items:center;justify-content:center;\">🛍️</div>"}
              <div class="in-order-item-details">
                <span class="in-order-item-name" title="${it.name}">${it.name}</span>
                <span class="in-order-item-brand">${it.brand ? it.brand + " • " : ""}${weightLabel ? weightLabel : ""}</span>
              </div>
              <div class="in-order-item-qty-tag">
                Qty: ${it.quantity}
              </div>
              <div class="in-order-item-prices">
                <span class="in-order-total-price">₹${it.totalPrice || (it.unitPrice * it.quantity) || 0}</span>
                <span class="in-order-unit-price">₹${it.unitPrice} / unit</span>
              </div>
              <div>
                <button class="btn-item-history" data-action="view-item-history" data-product-key="${encKey}" title="View price history for ${it.name} (${weightLabel})">
                  📈 Price History
                </button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

// ==========================================================================
// 4. Price History & Product Explorer Logic
// ==========================================================================

function populatePriceProductSelect() {
  const select = document.getElementById("price-product-select");
  const chipsContainer = document.getElementById("quick-picks-chips");
  if (!select) return;

  const variantMap = getAllProductVariants();
  let sortedVariants = Object.values(variantMap).sort((a, b) => a.displayName.localeCompare(b.displayName));
  let topVariants = Object.values(variantMap).sort((a, b) => b.totalQty - a.totalQty).slice(0, 6);

  const curVal = select.value || selectedPriceProductKey;

  // Filter dropdown by current search term if present
  if (currentSearchTerm) {
    const matched = sortedVariants.filter(v => v.displayName.toLowerCase().includes(currentSearchTerm));
    if (matched.length > 0) {
      sortedVariants = matched;
      topVariants = sortedVariants.slice(0, 6);
      if (curVal && variantMap[curVal] && !sortedVariants.some(v => v.key === curVal)) {
        sortedVariants.unshift(variantMap[curVal]);
      }
    }
  }

  select.innerHTML = "<option value=\"\">-- Choose an Ordered Product & Pack Size --</option>";

  sortedVariants.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v.key;
    opt.textContent = `${v.displayName} — ${v.totalQty} units`;
    select.appendChild(opt);
  });

  if (curVal && sortedVariants.some(v => v.key === curVal)) {
    select.value = curVal;
  } else if (sortedVariants.length > 0) {
    selectedPriceProductKey = sortedVariants[0].key;
    select.value = sortedVariants[0].key;
  }

  // Populate Quick Pick Chips
  if (chipsContainer) {
    chipsContainer.innerHTML = topVariants.map(v => {
      const enc = encodeURIComponent(v.key);
      const shortLabel = v.displayName.length > 24 ? v.displayName.slice(0, 22) + "..." : v.displayName;
      return `
        <button class="quick-pick-chip" data-action="quick-pick" data-product-key="${enc}" title="${v.displayName} (${v.totalQty} units)">
          ${shortLabel} (${v.totalQty})
        </button>
      `;
    }).join("");
  }
}

function renderPriceHistory(productKey) {
  const emptyState = document.getElementById("price-history-empty");
  const contentCard = document.getElementById("price-history-content");

  if (!productKey) {
    if (emptyState) emptyState.style.display = "block";
    if (contentCard) contentCard.style.display = "none";
    return;
  }

  // Find all purchase instances for this exact product variant
  let instances = [];
  allOrders.forEach(o => {
    (o.items || []).forEach(it => {
      if (getProductKey(it) === productKey) {
        instances.push({
          orderDate: o.date || o.displayDate || "Unknown",
          orderNumber: o.orderNumber || "",
          orderId: o.orderId || "",
          quantity: it.quantity || 1,
          unitPrice: it.unitPrice || 0,
          mrp: it.mrp || it.unitPrice || 0,
          totalPrice: it.totalPrice || (it.unitPrice * (it.quantity || 1)) || 0,
          savings: it.savings || 0,
          brand: it.brand || "",
          weight: normalizeWeight(it.weight),
          imgUrl: it.imgUrl || "",
          name: it.name,
          key: getProductKey(it)
        });
      }
    });
  });

  // Fallback: If no instances found by key, try matching by base product name
  if (instances.length === 0) {
    const fallbackMatches = [];
    allOrders.forEach(o => {
      (o.items || []).forEach(it => {
        if ((it.name || "").trim().toLowerCase() === productKey.trim().toLowerCase()) {
          fallbackMatches.push(it);
        }
      });
    });
    if (fallbackMatches.length > 0) {
      const counts = {};
      fallbackMatches.forEach(it => {
        const k = getProductKey(it);
        counts[k] = (counts[k] || 0) + (it.quantity || 1);
      });
      const bestKey = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      selectedPriceProductKey = bestKey;
      const sel = document.getElementById("price-product-select");
      if (sel) sel.value = bestKey;
      return renderPriceHistory(bestKey);
    }
  }

  if (instances.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    if (contentCard) contentCard.style.display = "none";
    return;
  }

  if (emptyState) emptyState.style.display = "none";
  if (contentCard) contentCard.style.display = "block";

  // Sort chronological by date (ascending)
  instances.sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());

  // Statistics calculation for this specific pack size
  const prices = instances.map(i => i.unitPrice);
  const lowestPrice = Math.min(...prices);
  const highestPrice = Math.max(...prices);
  const latestPrice = instances[instances.length - 1].unitPrice;
  const firstPrice = instances[0].unitPrice;
  const totalUnits = instances.reduce((acc, i) => acc + i.quantity, 0);

  const lowestInstance = instances.find(i => i.unitPrice === lowestPrice) || instances[0];
  const highestInstance = instances.find(i => i.unitPrice === highestPrice) || instances[0];
  const latestInstance = instances[instances.length - 1];

  // Populate Hero
  document.getElementById("ph-product-name").textContent = latestInstance.name;
  document.getElementById("ph-brand").textContent = latestInstance.brand || "Grocery";
  document.getElementById("ph-weight").textContent = latestInstance.weight || "Standard Pack";

  // Sibling Pack Sizes Switcher (e.g. 1 L vs 200 ml)
  const baseName = latestInstance.name.trim().toLowerCase();
  const allVariants = getAllProductVariants();
  const siblingVariants = Object.values(allVariants).filter(v => v.name.toLowerCase() === baseName);

  const switcherContainer = document.getElementById("ph-variant-switcher");
  if (switcherContainer) {
    if (siblingVariants.length > 1) {
      switcherContainer.style.display = "flex";
      switcherContainer.innerHTML = `
        <span class="switcher-label">📦 Pack Sizes:</span>
        ${siblingVariants.map(sv => `
          <button class="variant-pill ${sv.key === productKey ? "active" : ""}" 
                  data-action="switch-variant" 
                  data-product-key="${encodeURIComponent(sv.key)}">
            ${sv.weight || "Standard"} (${sv.totalQty} units)
          </button>
        `).join("")}
      `;
    } else {
      switcherContainer.style.display = "none";
    }
  }

  const imgBox = document.getElementById("ph-image-box");
  if (imgBox) {
    if (latestInstance.imgUrl) {
      imgBox.innerHTML = `<img src="${latestInstance.imgUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 10px;" alt="">`;
    } else {
      imgBox.textContent = "🛍️";
    }
  }

  // Populate Mini Stat Boxes
  document.getElementById("ph-lowest-price").textContent = `₹${lowestPrice}`;
  document.getElementById("ph-lowest-date").textContent = `on ${lowestInstance.orderDate}`;

  document.getElementById("ph-highest-price").textContent = `₹${highestPrice}`;
  document.getElementById("ph-highest-date").textContent = `on ${highestInstance.orderDate}`;

  document.getElementById("ph-latest-price").textContent = `₹${latestPrice}`;
  document.getElementById("ph-latest-date").textContent = `on ${latestInstance.orderDate}`;

  document.getElementById("ph-total-units").textContent = `${totalUnits} total units purchased`;

  // Price Trend Badge
  const trendBadge = document.getElementById("ph-trend-badge");
  if (trendBadge) {
    if (latestPrice > firstPrice) {
      const diff = latestPrice - firstPrice;
      const pct = Math.round((diff / firstPrice) * 100);
      trendBadge.textContent = `▲ +₹${diff} (+${pct}%)`;
      trendBadge.className = "price-trend-badge trend-up";
    } else if (latestPrice < firstPrice) {
      const diff = firstPrice - latestPrice;
      const pct = Math.round((diff / firstPrice) * 100);
      trendBadge.textContent = `▼ -₹${diff} (-${pct}%)`;
      trendBadge.className = "price-trend-badge trend-down";
    } else if (lowestPrice !== highestPrice) {
      trendBadge.textContent = `• Varied (Latest: ₹${latestPrice})`;
      trendBadge.className = "price-trend-badge trend-same";
    } else {
      trendBadge.textContent = `• Stable Price (₹${latestPrice})`;
      trendBadge.className = "price-trend-badge trend-same";
    }
  }

  // Populate Chronological Timeline Table (Only purchases for THIS pack size!)
  document.getElementById("ph-timeline-count").textContent = instances.length;
  const tbody = document.getElementById("ph-timeline-body");
  if (tbody) {
    let prevPrice = null;
    tbody.innerHTML = instances.map(inst => {
      let changeTag = "<span class=\"change-tag same\">-</span>";
      if (prevPrice !== null) {
        if (inst.unitPrice > prevPrice) {
          changeTag = `<span class="change-tag up">▲ +₹${inst.unitPrice - prevPrice}</span>`;
        } else if (inst.unitPrice < prevPrice) {
          changeTag = `<span class="change-tag down">▼ -₹${prevPrice - inst.unitPrice}</span>`;
        } else {
          changeTag = "<span class=\"change-tag same\">Same</span>";
        }
      }
      prevPrice = inst.unitPrice;
      const encOrder = encodeURIComponent(inst.orderNumber);

      return `
        <tr>
          <td><strong>${inst.orderDate}</strong></td>
          <td><span style="font-family: monospace; font-size: 11px;">${inst.orderNumber.slice(-14)}</span></td>
          <td><span style="font-weight: 700;">${inst.quantity}</span></td>
          <td><strong style="color: var(--text-primary);">₹${inst.unitPrice}</strong></td>
          <td>${changeTag}</td>
          <td><strong style="color: var(--accent-green-light);">₹${inst.totalPrice}</strong></td>
          <td>${inst.savings > 0 ? `<span style="color: var(--accent-green);">₹${inst.savings}</span>` : "-"}</td>
          <td>
            <button class="btn-view-receipt" data-action="view-receipt" data-order-number="${encOrder}">Receipt</button>
          </td>
        </tr>
      `;
    }).join("");
  }
}

// ==========================================================================
// 5. Items Table View
// ==========================================================================

function renderItemsTable() {
  const tbody = document.getElementById("items-table-body");
  if (!tbody) return;

  const filtered = getFilteredOrders();
  const allItems = [];

  filtered.forEach(o => {
    (o.items || []).forEach(it => {
      allItems.push({
        ...it,
        orderDate: o.date,
        orderNumber: o.orderNumber
      });
    });
  });

  if (allItems.length === 0) {
    tbody.innerHTML = "<tr><td colspan=\"9\" style=\"text-align: center; padding: 30px; color: var(--text-faint);\">No items found.</td></tr>";
    return;
  }

  tbody.innerHTML = allItems.map(it => {
    const itemKey = getProductKey(it);
    const encKey = encodeURIComponent(itemKey);
    const weightLabel = normalizeWeight(it.weight);
    return `
      <tr>
        <td><strong>${it.name}</strong></td>
        <td>${it.brand || "-"}</td>
        <td>${weightLabel || "-"}</td>
        <td>${it.quantity}</td>
        <td>₹${it.unitPrice}</td>
        <td style="font-weight: 700; color: var(--accent-green-light);">₹${it.totalPrice}</td>
        <td>${it.orderDate || "-"}</td>
        <td><span style="font-family: monospace; font-size: 11px;">${(it.orderNumber || "").slice(-12)}</span></td>
        <td>
          <button class="btn-item-history" data-action="view-item-history" data-product-key="${encKey}" title="View price history for ${it.name} (${weightLabel})">
            📈 Price History
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

// ==========================================================================
// 6. Modal Receipt Logic
// ==========================================================================

function openOrderModal(orderNumber) {
  const order = allOrders.find(o => o.orderNumber === orderNumber);
  if (!order) return;
  currentModalOrderNumber = orderNumber;

  const modal = document.getElementById("order-modal");
  document.getElementById("modal-order-title").textContent = `Order ${order.orderNumber}`;
  document.getElementById("modal-order-sub").textContent = order.deliverySlot || order.displayDate || "";
  document.getElementById("modal-date").textContent = `${order.date} ${order.deliveryTime ? "(" + order.deliveryTime + ")" : ""}`;
  document.getElementById("modal-payment").textContent = `${order.paymentMethod || "Online"} • ${order.paymentStatus || "Successful"}`;
  document.getElementById("modal-status").textContent = order.deliveryStatus || "Delivered";
  const modalAddr = document.getElementById("modal-address");
  if (modalAddr) {
    modalAddr.innerHTML = `<strong>📍 ${order.location || "Registered Address"}</strong><br><span style="font-size: 11px; color: var(--text-muted);">${order.address || "Home Address"}</span>`;
  }

  document.getElementById("modal-subtotal").textContent = `₹${(order.subtotal || order.amount || 0).toLocaleString("en-IN")}`;
  document.getElementById("modal-savings").textContent = `₹${(order.savings || 0).toLocaleString("en-IN")}`;
  document.getElementById("modal-total").textContent = `₹${(order.amount || 0).toLocaleString("en-IN")}`;
  document.getElementById("modal-items-count").textContent = (order.items || []).length;

  const itemsList = document.getElementById("modal-items-list");
  if (itemsList) {
    if ((order.items || []).length === 0) {
      itemsList.innerHTML = "<div style=\"text-align: center; color: var(--text-faint); padding: 20px;\">No line items detailed for this order.</div>";
    } else {
      itemsList.innerHTML = order.items.map(it => `
        <div class="item-receipt-row">
          ${it.imgUrl ? `<img src="${it.imgUrl}" class="item-img" alt="" loading="lazy">` : "<div class=\"item-img\" style=\"display:flex;align-items:center;justify-content:center;\">🛍️</div>"}
          <div class="item-details">
            <span class="item-name">${it.name}</span>
            <span class="item-brand-weight">${it.brand ? it.brand + " • " : ""}${it.weight || ""}</span>
          </div>
          <div class="item-qty-price">
            <span class="item-price">₹${(it.totalPrice || it.unitPrice || 0).toLocaleString("en-IN")}</span>
            <span class="item-qty">Qty: ${it.quantity} @ ₹${it.unitPrice}</span>
          </div>
        </div>
      `).join("");
    }
  }

  modal.style.display = "flex";
}

function closeModal() {
  currentModalOrderNumber = "";
  const modal = document.getElementById("order-modal");
  if (modal) modal.style.display = "none";
}

// ==========================================================================
// 7. Clear Data & Export Functions
// ==========================================================================

async function clearAllData() {
  if (confirm("Are you sure you want to clear all cached orders from the dashboard?")) {
    allOrders = [];
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ billz_all_orders: [], billz_cleared: true, captured_count: 0 });
    }
    render();
  }
}

function exportCSV() {
  const filtered = getFilteredOrders();
  if (filtered.length === 0) {
    alert("No orders to export!");
    return;
  }

  const headers = ["Platform", "Store / Restaurant", "Delivery Location", "Order Date", "Month", "Order Number", "Total Amount (INR)", "Savings (INR)", "Payment Status", "Payment Method", "Delivery Status", "Items Count", "Items Summary"];
  const rows = filtered.map(o => {
    const summary = (o.items || []).map(i => `${i.quantity}x ${i.name} (${i.weight || ''}) [Rs ${i.totalPrice}]`).join(" | ");
    const cleanStore = (o.storeName || "Store").replace(/[\r\n]+/g, " ").replace(/"/g, "\"\"");
    const cleanLocation = (o.location || "Registered Address").replace(/[\r\n]+/g, " ").replace(/"/g, "\"\"");
    const cleanSummary = summary.replace(/[\r\n]+/g, " ").replace(/"/g, "\"\"");
    return [
      `"${o.platform || "bigbasket"}"`,
      `"${cleanStore}"`,
      `"${cleanLocation}"`,
      `"${o.date || ""}"`,
      `"${o.monthKey || ""}"`,
      `"${o.orderNumber || ""}"`,
      o.amount || 0,
      o.savings || 0,
      `"${(o.paymentStatus || "").replace(/[\r\n]+/g, " ").replace(/"/g, "\"\"")}"`,
      `"${(o.paymentMethod || "").replace(/[\r\n]+/g, " ").replace(/"/g, "\"\"")}"`,
      `"${(o.deliveryStatus || "").replace(/[\r\n]+/g, " ").replace(/"/g, "\"\"")}"`,
      (o.items || []).length || o.itemsCount || 0,
      `"${cleanSummary}"`
    ].join(",");
  });

  const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv" });
  downloadBlob(blob, `billz_orders_${currentFilterPlatform}_${new Date().toISOString().slice(0, 10)}.csv`);
}

function exportJSON() {
  const filtered = getFilteredOrders();
  const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), platform: currentFilterPlatform, total_orders: filtered.length, orders: filtered }, null, 2)], { type: "application/json" });
  downloadBlob(blob, `billz_orders_${currentFilterPlatform}_${new Date().toISOString().slice(0, 10)}.json`);
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

// ==========================================================================
// 8. Printable PDF Statement & Receipt Generators
// ==========================================================================

function exportMonthToPDF(targetMonth = null) {
  let ordersToExport = [];
  let title = "";

  if (targetMonth && targetMonth !== "all") {
    ordersToExport = allOrders.filter(o => o.monthKey === targetMonth && !isCancelledOrder(o));
    title = targetMonth;
  } else if (currentFilterMonth !== "all") {
    ordersToExport = allOrders.filter(o => o.monthKey === currentFilterMonth && !isCancelledOrder(o));
    title = currentFilterMonth;
  } else {
    // Collect unique months
    const monthSet = new Set();
    allOrders.forEach(o => {
      if (o.monthKey && !isCancelledOrder(o)) monthSet.add(o.monthKey);
    });
    const months = Array.from(monthSet);

    if (months.length === 0) {
      alert("No delivered orders available to export.");
      return;
    }

    if (months.length === 1) {
      ordersToExport = allOrders.filter(o => o.monthKey === months[0] && !isCancelledOrder(o));
      title = months[0];
    } else {
      const promptMsg = `Select a month to export as PDF:\n${months.map((m, i) => `${i + 1}. ${m}`).join("\n")}\n\nEnter number (1-${months.length}) or type 'all' for Complete Grocery Statement:`;
      const choice = prompt(promptMsg, "1");
      if (choice === null) return;
      const trimmed = choice.trim().toLowerCase();
      if (trimmed === "all") {
        ordersToExport = allOrders.filter(o => !isCancelledOrder(o));
        title = "All_Months";
      } else {
        const idx = parseInt(trimmed, 10) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < months.length) {
          title = months[idx];
          ordersToExport = allOrders.filter(o => o.monthKey === title && !isCancelledOrder(o));
        } else {
          const matched = months.find(m => m.toLowerCase().includes(trimmed));
          title = matched || months[0];
          ordersToExport = allOrders.filter(o => o.monthKey === title && !isCancelledOrder(o));
        }
      }
    }
  }

  if (currentFilterPlatform !== "all") {
    ordersToExport = ordersToExport.filter(o => (o.platform || "bigbasket") === currentFilterPlatform);
  }

  if (ordersToExport.length === 0) {
    alert("No orders found to export for " + (title || "this period") + " (" + currentFilterPlatform + ")!");
    return;
  }

  const container = document.getElementById("print-statement-container");
  if (!container) return;

  container.innerHTML = buildStatementHTML(title, ordersToExport);

  const originalTitle = document.title;
  const prefixMap = {
    all: "Consolidated_Billz_Statement",
    bigbasket: "BigBasket_Statement",
    swiggy: "Swiggy_Food_Statement",
    instamart: "Swiggy_Instamart_Statement"
  };
  const prefix = prefixMap[currentFilterPlatform] || "Billz_Statement";
  const sanitizedTitle = `${prefix}_${title.replace(/[^a-zA-Z0-9]/g, "_")}`;
  document.title = sanitizedTitle;

  // DOM-level hide guarantee: hide appLayout and modal completely
  const appLayout = document.querySelector(".app-layout");
  if (appLayout) appLayout.style.display = "none";
  const modal = document.getElementById("order-modal");
  if (modal) modal.style.display = "none";
  document.body.classList.add("printing-statement");

  const restoreDashboard = () => {
    document.title = originalTitle;
    document.body.classList.remove("printing-statement");
    if (appLayout) appLayout.style.display = "";
    container.innerHTML = "";
  };

  window.addEventListener("afterprint", restoreDashboard, { once: true });

  setTimeout(() => {
    window.print();
    setTimeout(restoreDashboard, 2500);
  }, 200);
}

function printSingleOrder(orderNumber) {
  const order = allOrders.find(o => o.orderNumber === orderNumber);
  if (!order) return;

  const container = document.getElementById("print-statement-container");
  if (!container) return;

  container.innerHTML = buildSingleReceiptHTML(order);

  const originalTitle = document.title;
  const sanitizedId = (order.orderNumber || order.orderId || "receipt").replace(/[^a-zA-Z0-9]/g, "_");
  document.title = `BigBasket_Receipt_${sanitizedId}`;

  // DOM-level hide guarantee: hide appLayout and modal completely
  const appLayout = document.querySelector(".app-layout");
  if (appLayout) appLayout.style.display = "none";
  const modal = document.getElementById("order-modal");
  if (modal) modal.style.display = "none";
  document.body.classList.add("printing-statement");

  const restoreDashboard = () => {
    document.title = originalTitle;
    document.body.classList.remove("printing-statement");
    if (appLayout) appLayout.style.display = "";
    container.innerHTML = "";
  };

  window.addEventListener("afterprint", restoreDashboard, { once: true });

  setTimeout(() => {
    window.print();
    setTimeout(restoreDashboard, 2500);
  }, 200);
}

function buildStatementHTML(title, orders) {
  const sorted = sortOrdersDesc(orders);
  let totalSpent = 0;
  let totalSavings = 0;
  let totalItemsCount = 0;
  const uniqueProducts = new Set();
  const paymentMethods = {};

  let customerName = "BigBasket Customer";
  let customerAddress = "";

  sorted.forEach(o => {
    totalSpent += (o.amount || 0);
    totalSavings += (o.savings || 0);
    const pm = o.paymentMethod || o.paymentStatus || "Online";
    paymentMethods[pm] = (paymentMethods[pm] || 0) + 1;
    (o.items || []).forEach(it => {
      totalItemsCount += (it.quantity || 1);
      if (it.name) uniqueProducts.add(it.name.trim().toLowerCase());
    });
    if (!customerAddress && o.address) {
      const addrStr = typeof o.address === "string" ? o.address : String(o.address || "");
      customerAddress = addrStr;
      const parts = addrStr.split(",");
      if (parts.length > 0 && parts[0].trim()) {
        customerName = parts[0].trim();
      }
    }
  });

  const avgOrder = sorted.length > 0 ? totalSpent / sorted.length : 0;
  const paymentSummary = Object.entries(paymentMethods).map(([m, c]) => `${m}: ${c}`).join(" • ");

  const platformTitles = {
    all: "Consolidated Multi-App Statement",
    bigbasket: "Monthly BigBasket Statement",
    swiggy: "Monthly Swiggy Food Statement",
    instamart: "Monthly Swiggy Instamart Statement"
  };
  const stmtTitle = platformTitles[currentFilterPlatform] || "Monthly Order Statement";
  const stmtLogo = currentFilterPlatform === "swiggy" ? "🍔 billz" : (currentFilterPlatform === "instamart" ? "⚡ billz" : "🛒 billz");

  return `
    <div class="stmt-wrap">
      <div class="stmt-header">
        <div class="stmt-header-left">
          <div class="stmt-logo">${stmtLogo}</div>
          <div class="stmt-title">${stmtTitle}</div>
          <div class="stmt-period-badge">📅 Statement Period: ${title.replace(/_/g, " ")}</div>
        </div>
        <div class="stmt-header-right">
          <div><strong>Generated:</strong> ${new Date().toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
          <div><strong>Account Name:</strong> ${customerName}</div>
          <div><strong>Delivery Address:</strong> ${customerAddress || "Registered Address"}</div>
          <div><strong>Status:</strong> ${sorted.length} Delivered Orders</div>
        </div>
      </div>

      <div class="stmt-kpi-row">
        <div class="stmt-kpi-card">
          <div class="stmt-kpi-label">TOTAL AMOUNT SPENT</div>
          <div class="stmt-kpi-value">₹${Math.round(totalSpent).toLocaleString("en-IN")}</div>
          <div class="stmt-kpi-sub">Avg ₹${Math.round(avgOrder).toLocaleString("en-IN")} / order</div>
        </div>
        <div class="stmt-kpi-card">
          <div class="stmt-kpi-label">TOTAL SAVINGS</div>
          <div class="stmt-kpi-value green">₹${Math.round(totalSavings).toLocaleString("en-IN")}</div>
          <div class="stmt-kpi-sub">Discounts & Promos</div>
        </div>
        <div class="stmt-kpi-card">
          <div class="stmt-kpi-label">ORDERS FULFILLED</div>
          <div class="stmt-kpi-value">${sorted.length}</div>
          <div class="stmt-kpi-sub">${paymentSummary || "Delivered"}</div>
        </div>
        <div class="stmt-kpi-card">
          <div class="stmt-kpi-label">ITEMS PURCHASED</div>
          <div class="stmt-kpi-value">${totalItemsCount}</div>
          <div class="stmt-kpi-sub">${uniqueProducts.size} unique products</div>
        </div>
      </div>

      <div class="stmt-orders-section">
        <div class="stmt-section-heading">Detailed Itemized Order Breakdown (${sorted.length} Orders)</div>

        ${sorted.map((o, orderIdx) => {
          const items = o.items || [];
          const platIcon = o.platform === "swiggy" ? "🍔 " : (o.platform === "instamart" ? "⚡ " : "🛒 ");
          return `
            <div class="stmt-order-box">
              <div class="stmt-order-top">
                <div class="stmt-order-top-left">
                  <span class="stmt-order-badge">${platIcon}Order #${orderIdx + 1}</span>
                  <span>📅 ${o.date || o.displayDate || "N/A"}</span>
                  <span class="stmt-order-id-tag">${o.storeName || "Order"}: ${(o.orderNumber || o.orderId || "").slice(-18)}</span>
                  <span class="stmt-order-id-tag">📍 ${o.location || "Registered Address"}</span>
                  ${(o.deliverySlot || o.deliveryTime) ? `<span>⏰ ${o.deliverySlot || o.deliveryTime}</span>` : ""}
                </div>
                <div class="stmt-order-top-right">
                  <span class="stmt-status-tag">${o.paymentMethod || "Paid"} • ${o.paymentStatus || "Delivered"}</span>
                  <span class="stmt-order-amount">₹${(o.amount || 0).toLocaleString("en-IN")}</span>
                </div>
              </div>

              ${items.length === 0 ? `
                <div style="padding: 8px 12px; font-size: 8.5pt; color: #64748b; font-style: italic;">
                  Total items: ${o.itemsCount || 1} (Itemized breakdown not available for this legacy order)
                </div>
              ` : `
                <table class="stmt-table">
                  <thead>
                    <tr>
                      <th style="width: 4%;">#</th>
                      <th style="width: 48%;">Item Description</th>
                      <th style="width: 16%;">Brand</th>
                      <th style="width: 12%;">Pack Size</th>
                      <th style="width: 6%; text-align: center;">Qty</th>
                      <th style="width: 7%; text-align: right;">Price</th>
                      <th style="width: 7%; text-align: right;">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${items.map((it, itemIdx) => `
                      <tr>
                        <td style="color: #64748b;">${itemIdx + 1}</td>
                        <td><strong>${it.name}</strong></td>
                        <td>${it.brand || "-"}</td>
                        <td>${normalizeWeight(it.weight) || "-"}</td>
                        <td style="text-align: center;">${it.quantity || 1}</td>
                        <td style="text-align: right;">₹${it.unitPrice || 0}</td>
                        <td style="text-align: right; font-weight: 700;">₹${it.totalPrice || (it.unitPrice * (it.quantity || 1))}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              `}

              <div class="stmt-order-bottom">
                <div style="font-size: 7.5pt; color: #64748b;">📍 ${o.address || customerAddress}</div>
                <div class="stmt-order-bottom-right">
                  ${o.savings > 0 ? `<span class="stmt-order-savings">Saved ₹${(o.savings || 0).toLocaleString("en-IN")}</span>` : ""}
                  <span>Subtotal: ₹${(o.subtotal || o.amount || 0).toLocaleString("en-IN")}</span>
                  <span style="font-weight: 800; color: #0f172a;">Paid: ₹${(o.amount || 0).toLocaleString("en-IN")}</span>
                </div>
              </div>
            </div>
          `;
        }).join("")}
      </div>

      <div class="stmt-footer">
        <div>billz • Standalone BigBasket Order Harvester & Statement Generator • Confidentially Prepared</div>
        <div>Total Spent: ₹${Math.round(totalSpent).toLocaleString("en-IN")} | ${sorted.length} Orders</div>
      </div>
    </div>
  `;
}

function buildSingleReceiptHTML(order) {
  const items = order.items || [];
  const plat = order.platform || "bigbasket";
  const platLogo = plat === "swiggy" ? "🍔 billz" : (plat === "instamart" ? "⚡ billz" : "🛒 billz");
  const platTitle = plat === "swiggy" ? "Swiggy Food Receipt" : (plat === "instamart" ? "Swiggy Instamart Receipt" : "BigBasket Order Receipt");

  return `
    <div class="stmt-wrap">
      <div class="stmt-header">
        <div class="stmt-header-left">
          <div class="stmt-logo">${platLogo}</div>
          <div class="stmt-title">${platTitle}</div>
          <div class="stmt-period-badge">Order ID: ${order.orderNumber || order.orderId}</div>
        </div>
        <div class="stmt-header-right">
          <div><strong>Order Date:</strong> ${order.date || order.displayDate || "N/A"}</div>
          <div><strong>Delivery Slot:</strong> ${order.deliverySlot || order.deliveryTime || "Delivered"}</div>
          <div><strong>Payment:</strong> ${order.paymentMethod || "Online"} (${order.paymentStatus || "Successful"})</div>
          <div><strong>Delivery Status:</strong> ${order.deliveryStatus || "Delivered"}</div>
        </div>
      </div>

      <div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; margin-bottom: 16px; font-size: 8.5pt;">
        <strong>Delivery Location:</strong> 📍 ${order.location || "Registered Address"} &nbsp;•&nbsp; <strong>Full Address:</strong> ${order.address || "Registered Address"}
      </div>

      <table class="stmt-table" style="font-size: 9pt; margin-bottom: 20px;">
        <thead>
          <tr>
            <th style="width: 5%;">#</th>
            <th style="width: 50%;">Item Description</th>
            <th style="width: 15%;">Brand</th>
            <th style="width: 12%;">Pack Size</th>
            <th style="width: 6%; text-align: center;">Qty</th>
            <th style="width: 6%; text-align: right;">Unit Price</th>
            <th style="width: 6%; text-align: right;">Total</th>
          </tr>
        </thead>
        <tbody>
          ${items.length === 0 ? `
            <tr><td colspan="7" style="text-align:center; padding: 12px; color: #64748b;">No line items detailed for this order.</td></tr>
          ` : items.map((it, idx) => `
            <tr>
              <td style="color: #64748b;">${idx + 1}</td>
              <td><strong>${it.name}</strong></td>
              <td>${it.brand || "-"}</td>
              <td>${normalizeWeight(it.weight) || "-"}</td>
              <td style="text-align: center;">${it.quantity || 1}</td>
              <td style="text-align: right;">₹${it.unitPrice || 0}</td>
              <td style="text-align: right; font-weight: 700;">₹${it.totalPrice || (it.unitPrice * (it.quantity || 1))}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>

      <div style="display: flex; justify-content: flex-end; margin-bottom: 20px;">
        <div style="width: 250px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px; font-size: 9pt;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span>Subtotal:</span>
            <span>₹${(order.subtotal || order.amount || 0).toLocaleString("en-IN")}</span>
          </div>
          <div style="display: flex; justify-content: space-between; margin-bottom: 6px; color: #059669;">
            <span>Savings:</span>
            <span>₹${(order.savings || 0).toLocaleString("en-IN")}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-weight: 800; font-size: 11pt; border-top: 1px solid #cbd5e1; padding-top: 6px; color: #0f172a;">
            <span>Total Paid:</span>
            <span>₹${(order.amount || 0).toLocaleString("en-IN")}</span>
          </div>
        </div>
      </div>

      <div class="stmt-footer">
        <div>billz • Computer-generated BigBasket receipt • Valid for accounts & reimbursement</div>
        <div>Order Status: ${order.deliveryStatus || "Delivered"}</div>
      </div>
    </div>
  `;
}

document.addEventListener("DOMContentLoaded", initDashboard);
