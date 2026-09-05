/**
 * billz Core Data Schema & Shared Utilities
 * Modular data structures for BigBasket, Swiggy, and Swiggy Instamart.
 */

(function(root) {
  const BillzSchema = {
    PLATFORMS: {
      BIGBASKET: "bigbasket",
      SWIGGY: "swiggy",
      INSTAMART: "instamart"
    },

    PLATFORM_META: {
      bigbasket: { name: "BigBasket", icon: "🛒", color: "#059669", domain: "bigbasket.com" },
      swiggy: { name: "Swiggy Food", icon: "🍔", color: "#fc8019", domain: "swiggy.com" },
      instamart: { name: "Swiggy Instamart", icon: "⚡", color: "#f97316", domain: "swiggy.com" }
    },

    /**
     * Standardized Order Object Model
     */
    createOrder: function(data = {}) {
      const platform = data.platform || BillzSchema.PLATFORMS.BIGBASKET;
      const amount = parseFloat(data.amount) || 0;
      const subtotal = parseFloat(data.subtotal) || amount;
      const savings = parseFloat(data.savings) || 0;
      const items = Array.isArray(data.items) ? data.items : [];

      const addressStr = BillzSchema.formatAddressString(data.address);
      const locationStr = (typeof data.location === "string" && data.location.trim())
        ? data.location.trim()
        : BillzSchema.extractLocationLabel(addressStr);

      return {
        platform: platform,
        orderNumber: String(data.orderNumber || data.orderId || ""),
        orderId: String(data.orderId || data.orderNumber || ""),
        date: String(data.date || ""),
        displayDate: String(data.displayDate || data.date || ""),
        deliverySlot: String(data.deliverySlot || ""),
        deliveryTime: String(data.deliveryTime || ""),
        monthKey: data.monthKey || BillzSchema.getMonthKey(data.date || data.displayDate),
        amount: Math.round(amount * 100) / 100,
        subtotal: Math.round(subtotal * 100) / 100,
        savings: Math.round(savings * 100) / 100,
        paymentStatus: String(data.paymentStatus || "Paid"),
        paymentMethod: String(data.paymentMethod || "Online"),
        deliveryStatus: String(data.deliveryStatus || "Delivered"),
        address: addressStr,
        location: locationStr,
        storeName: String(data.storeName || (platform === "bigbasket" ? "BigBasket" : (platform === "instamart" ? "Swiggy Instamart" : "Restaurant"))),
        itemsCount: items.length || data.itemsCount || 0,
        items: items.map(BillzSchema.createItem)
      };
    },

    /**
     * Standardized Line Item Object Model
     */
    createItem: function(item = {}) {
      const quantity = parseInt(item.quantity, 10) || 1;
      const unitPrice = parseFloat(item.unitPrice) || 0;
      const mrp = parseFloat(item.mrp) || unitPrice;
      const totalPrice = parseFloat(item.totalPrice) || (unitPrice * quantity);
      const savings = parseFloat(item.savings) || Math.max(0, (mrp - unitPrice) * quantity);

      return {
        name: String(item.name || "Item").trim(),
        brand: String(item.brand || "").trim(),
        category: String(item.category || "").trim(),
        weight: String(item.weight || item.packSize || "").trim(),
        quantity: quantity,
        unitPrice: Math.round(unitPrice * 100) / 100,
        mrp: Math.round(mrp * 100) / 100,
        totalPrice: Math.round(totalPrice * 100) / 100,
        savings: Math.round(savings * 100) / 100,
        isVeg: typeof item.isVeg === "boolean" ? item.isVeg : null,
        imgUrl: item.imgUrl || ""
      };
    },

    /**
     * Universal Cancelled Order Checker
     */
    isCancelledOrder: function(o) {
      if (!o) return false;
      const pStatus = String(o.paymentStatus || "").toLowerCase();
      const dStatus = String(o.deliveryStatus || "").toLowerCase();
      const status = String(o.status || "").toLowerCase();
      const dispStatus = String(o.display_status || "").toLowerCase();
      const reasonText = String(o.reason_text || "").toLowerCase();
      const orderStatus = String(o.order_status || "").toLowerCase();

      return (
        dStatus.includes("cancel") ||
        pStatus.includes("cancel") ||
        pStatus.includes("incomplete") ||
        pStatus.includes("failed") ||
        status.includes("cancel") ||
        dispStatus.includes("cancel") ||
        orderStatus.includes("cancel") ||
        reasonText.includes("cancel") ||
        o.auto_cancelled === true ||
        o.is_cancelled === true
      );
    },

    /**
     * Calculate Standard Month Key ("August 2026")
     */
    getMonthKey: function(dateStr) {
      if (!dateStr) return "Unknown";
      const match = String(dateStr).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
      if (match) {
        const year = parseInt(match[1], 10);
        const monthIdx = parseInt(match[2], 10) - 1;
        const date = new Date(year, monthIdx, 1);
        return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      }
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      }
      return "Other";
    },

    /**
     * Clean and Normalize Weight / Pack Size Strings
     */
    normalizeWeight: function(val) {
      if (!val) return "";
      let s = String(val).trim();
      s = s.replace(/\s+/g, " ");
      s = s.replace(/(\d+)\s*(kg|g|gm|gms|l|ltr|ml|pc|pcs|pack|units)\b/gi, "$1 $2");
      return s;
    },

    /**
     * Safely format any address input (string, object, array) to a clean string
     */
    formatAddressString: function(val) {
      if (!val) return "";
      if (typeof val === "string") return val.trim();
      if (typeof val === "object") {
        try {
          if (typeof val.formatted_address === "string" && val.formatted_address.trim()) {
            return val.formatted_address.trim();
          }
          if (typeof val.formattedAddress === "string" && val.formattedAddress.trim()) {
            return val.formattedAddress.trim();
          }
          if (typeof val.address === "string" && val.address.trim()) {
            return val.address.trim();
          }
          if (typeof val.delivery_address === "string" && val.delivery_address.trim()) {
            return val.delivery_address.trim();
          }
          if (typeof val.address_string === "string" && val.address_string.trim()) {
            return val.address_string.trim();
          }
          const parts = [
            val.address_line1 || val.line1 || val.flat_no || val.house_number,
            val.address_line2 || val.line2 || val.building_name || val.apartment_name,
            val.landmark,
            val.area || val.sublocality || val.locality || val.area_name,
            val.city,
            val.state,
            val.pincode || val.pin
          ].filter(p => typeof p === "string" && p.trim().length > 0).map(p => p.trim());

          if (parts.length > 0) {
            return parts.join(", ");
          }

          const stringVals = Object.values(val)
            .filter(v => typeof v === "string" && v.trim().length > 0 && v !== "[object Object]")
            .map(v => v.trim());
          if (stringVals.length > 0) {
            return stringVals.join(", ");
          }
          return "";
        } catch (e) {}
      }
      const str = String(val || "").trim();
      return str === "[object Object]" ? "" : str;
    },

    /**
     * Smart Location Label Extractor for Indian addresses
     * Returns clean format e.g. "Bhayandar West, Mumbai" or "Bandra West, Mumbai"
     */
    extractLocationLabel: function(addressInput) {
      const addressStr = BillzSchema.formatAddressString(addressInput);
      if (!addressStr || typeof addressStr !== "string" || addressStr === "[object Object]") {
        return "Registered Address";
      }

      let clean = addressStr.replace(/^(Delivered to|Deliver to|Delivery Address:?)\s*/i, "").trim();
      const parts = clean.split(",").map(p => p.trim()).filter(Boolean);
      if (parts.length === 0) return "Registered Address";

      // If address contains multiple comma-separated parts
      if (parts.length >= 3) {
        const lastPart = parts[parts.length - 1];
        const secondLastPart = parts[parts.length - 2];
        const thirdLastPart = parts[parts.length - 3];

        // Check if last part contains pincode (e.g. "Mumbai - 401101")
        const cityMatch = lastPart.replace(/-\s*\d+/, "").replace(/\b\d{6}\b/, "").trim();
        if (cityMatch && secondLastPart) {
          return `${secondLastPart}, ${cityMatch}`;
        }
        return `${thirdLastPart}, ${secondLastPart}`;
      } else if (parts.length === 2) {
        const cityPart = parts[1].replace(/-\s*\d+/, "").replace(/\b\d{6}\b/, "").trim();
        return `${parts[0]}, ${cityPart || parts[1]}`;
      }

      return clean.slice(0, 35) || "Registered Address";
    },

    /**
     * Smart Grocery Brand Extractor
     */
    extractBrandFromName: function(name) {
      if (!name) return "Grocery";
      const trimmed = name.trim();
      const lower = trimmed.toLowerCase();

      const KNOWN_BRANDS = [
        "Amul", "Mother Dairy", "Nandini", "Britannia", "Nestle", "Aashirvaad", "Tata",
        "Lay's", "Haldiram's", "Haldirams", "Bikaji", "Kurkure", "Bingo", "Doritos", "Pringles",
        "Coca-Cola", "Coke", "Pepsi", "Thums Up", "Sprite", "Fanta", "Limca", "7Up", "Mirinda",
        "Gatorade", "Red Bull", "Monster", "Paper Boat", "Real", "Tropicana", "Maaza", "Frooti",
        "Cadbury", "Dairy Milk", "KitKat", "Snickers", "Ferrero Rocher", "5 Star", "Perk",
        "Parle", "Sunfeast", "Oreo", "Bourbon", "Hide & Seek", "Good Day", "Marie Gold", "Monaco",
        "Fortune", "Saffola", "Dhara", "Gemini", "Emami", "Sundrop",
        "Kissan", "Maggi", "Chings", "Knorr", "Top Ramen", "Yippee", "Nutrela",
        "Dabur", "Patanjali", "Zandu", "Baidyanath", "Himalaya",
        "Colgate", "Pepsodent", "Sensodyne", "Close Up", "Oral-B",
        "Dettol", "Lifebuoy", "Savlon", "Dove", "Pears", "Lux", "Santoor", "Fiama", "Medimix",
        "Surf Excel", "Ariel", "Tide", "Rin", "Wheel", "Comfort", "Vanish",
        "Vim", "Pril", "Exo", "Lizol", "Colin", "Harpic", "Domex", "Goodknight", "All Out", "Hit",
        "Whisper", "Stayfree", "Sofy", "Kotex", "Pampers", "Huggies", "MamyPoko",
        "Nescafe", "Bru", "Davidoff", "Tata Tea", "Red Label", "Taj Mahal", "Wagh Bakri", "Lipton",
        "Modern", "Harvest Gold", "English Oven", "The Health Factory", "Bonn",
        "Kellogg's", "Quaker", "Saffola Oats", "Bagrry's",
        "Epigamia", "Milky Mist", "Gowardhan", "Go Cheese", "Eggoz", "Freshey's", "Suguna",
        "Double Horse", "Everest", "MDH", "Catch", "Badshah", "Goldmee"
      ];

      for (let i = 0; i < KNOWN_BRANDS.length; i++) {
        const b = KNOWN_BRANDS[i];
        const bLower = b.toLowerCase();
        if (lower.startsWith(bLower + " ") || lower.startsWith(bLower + "-") || lower === bLower) {
          return b;
        }
      }

      // Fallback: first significant capitalized word
      const firstWord = trimmed.split(/[\s\-–—/]+/)[0];
      const generic = ["fresh", "organic", "frozen", "raw", "pure", "pack", "mixed", "mini", "small", "large", "premium", "daily", "classic", "natural", "farm"];
      if (firstWord && firstWord.length >= 3 && !/^\d+$/.test(firstWord) && !generic.includes(firstWord.toLowerCase())) {
        return firstWord;
      }

      return "General";
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = BillzSchema;
  } else {
    root.BillzSchema = BillzSchema;
  }
})(typeof window !== "undefined" ? window : global);
