# Privacy Policy for billz

**Last updated:** September 5, 2026

**billz** is a client-side browser extension designed to help users track and analyze their personal grocery and food order history from supported platforms (BigBasket, Swiggy, and Swiggy Instamart).

### 1. Data Collection & Processing
- **Local Execution:** All data extraction, parsing, and analytics run entirely within your local browser.
- **No External Servers:** billz does not operate any backend server, database, or analytics tracking service. Your order history and itemized bills are never transmitted to external servers or third parties.
- **Local Storage Only:** Data extracted from your active sessions on supported platforms is stored strictly in your browser's local storage (`chrome.storage.local`) on your device.

### 2. Information Handled
When you use billz on supported platforms, the extension reads:
- Order identifiers, order dates, and delivery statuses.
- Itemized grocery/food names, quantities, brand names, and price breakdowns.
- Delivery location / address labels as displayed on your order invoices.
- Payment method and totals (subtotal, discounts, savings).

This information is used solely to generate your personal dashboard, spending summaries, and local export files (CSV, JSON, PDF).

### 3. Permissions Used
- `storage`: Required to save your parsed order data and display preferences locally on your browser.
- `downloads`: Required to save exported CSV, JSON, and PDF files directly to your device's download folder.
- `activeTab`: Required to interact with the currently active grocery/food order tab when triggering extraction.
- `Host Permissions` (`*://*.bigbasket.com/*`, `*://*.swiggy.com/*`, `*://*.instamart.in/*`): Required to inject content scripts to parse order history on supported domains.

### 4. Third-Party Sharing
billz does not sell, rent, license, or transfer your data to any third party under any circumstances.

### 5. Data Retention & Deletion
You retain complete control over your data. You can delete all cached order data at any time by clicking "Clear Cache" in the extension popup or dashboard. Uninstalling the extension automatically deletes all stored data.

### 6. Contact & Support
If you have any questions or feedback regarding this policy, please open an issue at:
https://github.com/dsouzadwayne/billz
