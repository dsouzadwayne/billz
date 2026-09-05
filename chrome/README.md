# billz - Grocery & Food Order Analytics (Chrome & Firefox)

A privacy-first Manifest V3 browser extension for **Chrome, Brave, and Firefox** that captures your order history, itemized receipts, delivery locations, and grocery bills from **BigBasket, Swiggy Food, and Swiggy Instamart**.

---

## 🚀 Installation & Development

### Chrome & Brave
1. Navigate to `chrome://extensions` or `brave://extensions`.
2. Enable **Developer mode** (toggle in top-right corner).
3. Click **"Load unpacked"** and select:
   ```
   billz/chrome/billz
   ```

### Firefox
1. Open Firefox and navigate to:
   ```
   about:debugging#/runtime/this-firefox
   ```
2. Click **"Load Temporary Add-on..."**.
3. Select `manifest.json` inside:
   ```
   billz/firefox/billz/manifest.json
   ```

---

## 📦 Packaging & Release (`release.sh`)

To export production zip packages for the **Chrome Web Store** and **Firefox Add-ons Marketplace (AMO)**:

```bash
./release.sh
```

- **Option 1 (Chrome):** Updates manifest version and builds `chrome/billz.zip`.
- **Option 2 (Firefox):** Updates manifest version, syncs shared assets, and builds `firefox/billz.zip`.
- **Option 3 (Both):** Syncs all assets and builds both `chrome/billz.zip` and `firefox/billz.zip` simultaneously.
- **Git Push:** Automatically commits and pushes release changes if inside a git repository.

---

## 🛒 How to Use on BigBasket

1. Open [bigbasket.com](https://www.bigbasket.com) in Brave and log in.
2. Go to your **My Orders** page (via your profile or at `https://www.bigbasket.com/member/myorders/`).
3. You will see a floating **🛒 billz** launcher badge in the bottom-right corner.
4. Click it to open the control panel:
   - 📦 **Save Orders (JSON):** Scans the order cards and saves structured JSON (Order ID, amounts, dates, and items) to your computer.
   - 📸 **Save Page DOM (HTML):** Dumps the entire rendered HTML of the orders page to your computer for deep inspection of classes and attributes.
   - 📜 **Auto-Scroll History:** Automatically scrolls down and clicks "Load More" so past months load automatically while the interceptor captures every response.
   - 📡 **Save API Traffic:** Saves all raw JSON responses intercepted from BigBasket's backend.

---

## 📊 Analytics Dashboard Features

Open the standalone dashboard anytime by clicking the extension icon and selecting **"📊 Open Full Bills Dashboard"** (or open `dashboard.html`):

- 🌙 **Dark & Light Mode:** Toggle themes with persistent preference saved to local storage.
- 📦 **In-Order Items Breakdown:** See item images, product names, brands, pack sizes, quantities, unit prices, total prices, and savings directly inside each order card in the month-wise view.
- 🏆 **Most Expensive Order:** Instant highlight of your highest-value order, total spend, date, and key items.
- 🛒 **Top Most Ordered Items:** Leaderboard ranking the items you buy most frequently, total units, and total spend.
- 🏷️ **Top Brands by Spend:** Breakdown of top grocery brands (e.g. Amul, Nescafe, Akshayakalpa) and percentage share of your grocery bill.
- 📈 **Price History & Product Explorer:** Pick or search any grocery product to see its historical price trends (lowest price, highest price, latest price, and percentage change) across all purchases on a chronological timeline.
- 🚫 **Zero Cancelled Orders:** Automatically excludes cancelled, incomplete, or failed orders from all KPIs and views.
- 📄 **Monthly PDF Statement & Invoices:** Export any month's complete order history, itemized breakdowns, and spend summaries into a beautifully formatted A4 PDF statement with 1 click (or print individual order receipts).
- 📥 **Export to CSV & JSON:** Download your complete sanitized order and grocery history at any time.

---

## 📂 Where Files Are Saved

Downloaded files are automatically placed in your browser's default download folder under:
```
~/Downloads/billz_data/
```
No background server required—pure standalone client-side extension!
