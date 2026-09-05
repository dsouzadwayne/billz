/**
 * billz - Swiggy Instamart Platform Parser
 * Parses Swiggy Instamart grocery order API responses from:
 * 1. instamart.in (/api/instamart/orders)
 * 2. swiggy.com (/dapi/order/all)
 */

(function(root) {
  const Schema = (typeof module !== "undefined" && module.exports)
    ? require("../../core/schema.js")
    : root.BillzSchema;

  const InstamartParser = {
    platform: "instamart",

    /**
     * Parse Instamart orders from API response (instamart.in or swiggy.com)
     */
    parseOrderListingResponse: function(data) {
      if (!data) return [];

      // If data is from instamart.in /api/instamart/orders:
      // { statusCode: "SUCCESS", data: { orders: [...], total_orders: ... } }
      const rawOrders = (data.data && Array.isArray(data.data.orders))
        ? data.data.orders
        : (Array.isArray(data.orders) ? data.orders : (Array.isArray(data) ? data : []));

      if (rawOrders.length === 0) return [];

      const parsedOrders = [];

      rawOrders.forEach(entry => {
        // Case A: Format from instamart.in (/api/instamart/orders)
        if (entry.order_data_v2 || entry.order_data) {
          const v2 = entry.order_data_v2 || {};
          const status = String(v2.status || entry.status || "").toUpperCase();

          // Exclude cancelled / failed orders
          if (
            status === "LEAF_ORDER_STATUS_CANCELLED" ||
            status === "LEAF_ORDER_STATUS_FAILED" ||
            status === "CANCELLED" ||
            status === "FAILED" ||
            entry.is_cancelled === true
          ) {
            return;
          }

          // Extract job info from order_data if available
          let orderId = "";
          let paymentMethod = "Online (UPI / Card)";
          if (entry.order_data && Array.isArray(entry.order_data.orders)) {
            const firstJob = entry.order_data.orders[0]?.order_jobs?.[0];
            if (firstJob) {
              orderId = String(firstJob.order_job_id || firstJob.order_id || "");
              if (firstJob.payment_info) {
                paymentMethod = firstJob.payment_info.payment_method || firstJob.payment_info.mode || paymentMethod;
              }
            }
          }
          if (!orderId) {
            orderId = String(entry.order_id || entry.id || v2.order_id || Date.now());
          }
          orderId = orderId.replace(/^INSTA-/, "");

          // Timestamp
          let orderDate = "";
          let displayDate = "";
          const ts = entry.created_at || v2.created_at;
          if (ts) {
            const timeNum = typeof ts === "number" ? (ts > 1e11 ? ts : ts * 1000) : new Date(ts).getTime();
            const d = new Date(timeNum);
            if (!isNaN(d.getTime())) {
              orderDate = d.toISOString().split("T")[0];
              displayDate = d.toLocaleDateString("en-IN", { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
            }
          }

          // Amount
          let totalAmount = 0;
          if (v2.total && v2.total.units) {
            totalAmount = parseFloat(v2.total.units) || 0;
          } else if (typeof v2.total === "number" || typeof v2.total === "string") {
            totalAmount = parseFloat(v2.total) || 0;
          } else {
            totalAmount = parseFloat(v2.order_total || entry.order_total || entry.final_amount || 0);
          }
          if (totalAmount > 100000 && Number.isInteger(totalAmount)) totalAmount /= 100;

          // Extract line items across all possible Instamart payload locations
          const rawItems = [];

          // 1. Shipments array in order_data_v2 (Standard on instamart.in)
          if (Array.isArray(v2.shipments)) {
            v2.shipments.forEach(s => {
              if (Array.isArray(s.items)) rawItems.push(...s.items);
              else if (Array.isArray(s.shipment_items)) rawItems.push(...s.shipment_items);
            });
          }

          // 2. Direct items array
          if (rawItems.length === 0) {
            if (Array.isArray(v2.items)) rawItems.push(...v2.items);
            else if (Array.isArray(entry.items)) rawItems.push(...entry.items);
            else if (Array.isArray(entry.order_items)) rawItems.push(...entry.order_items);
          }

          // 3. order_jobs or metadata inside order_data
          if (rawItems.length === 0 && entry.order_data && Array.isArray(entry.order_data.orders)) {
            entry.order_data.orders.forEach(sub => {
              (sub.order_jobs || []).forEach(job => {
                if (Array.isArray(job.items)) rawItems.push(...job.items);
                else if (job.metadata) {
                  try {
                    const meta = typeof job.metadata === "string" ? JSON.parse(unescape(job.metadata)) : job.metadata;
                    if (Array.isArray(meta.items)) rawItems.push(...meta.items);
                  } catch (e) {}
                }
              });
            });
          }

          // 4. Fallback from description string (e.g. "Amul Taaza Milk (2), Whole Wheat Bread (1)")
          if (rawItems.length === 0) {
            const desc = v2.description || (v2.shipments && v2.shipments[0]?.description) || "";
            if (desc && (desc.includes("(") || desc.includes(","))) {
              desc.split(",").forEach(part => {
                const match = part.trim().match(/^(.*?)\s*\((\d+)\)$/);
                if (match) {
                  rawItems.push({ name: match[1].trim(), quantity: parseInt(match[2], 10) || 1 });
                } else if (part.trim()) {
                  rawItems.push({ name: part.trim(), quantity: 1 });
                }
              });
            }
          }

          let totalItemsQuantity = 0;
          rawItems.forEach(it => totalItemsQuantity += (parseInt(it.quantity || it.item_quantity || 1, 10)));
          const defaultItemPrice = (totalItemsQuantity > 0 && totalAmount > 0) ? Math.round((totalAmount / totalItemsQuantity) * 100) / 100 : 0;

          const items = [];
          rawItems.forEach(it => {
            const name = it.name || it.item_name || "Grocery Item";
            const qty = parseInt(it.quantity || it.item_quantity || 1, 10);
            let itemPrice = parseFloat(it.final_price || it.price || it.unit_price || 0);
            if (itemPrice > 50000 && Number.isInteger(itemPrice)) itemPrice /= 100;
            if (itemPrice <= 0 && defaultItemPrice > 0) {
              itemPrice = defaultItemPrice * qty;
            }

            const unitPrice = qty > 0 ? Math.round((itemPrice / qty) * 100) / 100 : itemPrice;
            let mrp = it.mrp ? parseFloat(it.mrp) : unitPrice;
            if (mrp > 50000 && Number.isInteger(mrp)) mrp /= 100;
            const savings = Math.max(0, (mrp - unitPrice) * qty);
            const brand = it.brand || Schema.extractBrandFromName(name);

            items.push(Schema.createItem({
              name: name,
              brand: brand,
              category: it.category || "Groceries",
              quantity: qty,
              weight: Schema.normalizeWeight(it.quantity_description || it.weight || it.variant || it.pack_size || ""),
              unitPrice: unitPrice,
              mrp: mrp,
              totalPrice: itemPrice,
              savings: savings,
              isVeg: it.is_veg === 1 || it.is_veg === true,
              imgUrl: it.image_url || it.cloudinary_image_id || ""
            }));
          });

          // Address & Location resolution
          const addressStr = Schema.formatAddressString(entry.delivery_address || entry.address || entry.details_text);
          const locationLabel = Schema.extractLocationLabel(addressStr);

          // Calculate total savings (order-level discount or sum of item discounts)
          const orderSavings = parseFloat(v2.savings || v2.discount || entry.order_discount || entry.discount || 0);
          const itemsSavings = items.reduce((acc, it) => acc + (it.savings || 0), 0);
          let totalSavings = Math.max(orderSavings, itemsSavings);
          if (totalSavings > 100000 && Number.isInteger(totalSavings)) totalSavings /= 100;

          const normalized = Schema.createOrder({
            platform: "instamart",
            orderNumber: `INSTA-${orderId}`,
            orderId: orderId,
            date: orderDate,
            displayDate: displayDate,
            deliverySlot: entry.details_text || "Delivered in 10-15 mins",
            deliveryTime: displayDate,
            monthKey: Schema.getMonthKey(orderDate),
            amount: totalAmount,
            subtotal: Math.round((totalAmount + totalSavings) * 100) / 100,
            savings: Math.round(totalSavings * 100) / 100,
            paymentStatus: "Paid",
            paymentMethod: paymentMethod,
            deliveryStatus: "Delivered",
            address: addressStr,
            location: locationLabel,
            storeName: "Swiggy Instamart",
            itemsCount: items.length || 1,
            items: items
          });

          parsedOrders.push(normalized);
          return;
        }

        // Case B: Instamart orders inside Swiggy's /dapi/order/all format
        if (InstamartParser.isInstamartOrder(entry)) {
          const orderStatus = String(entry.order_status || entry.status || "").toLowerCase();
          if (orderStatus.includes("cancel") || orderStatus.includes("failed") || entry.is_cancelled === true) {
            return;
          }

          const rawOrderId = String(entry.order_id || entry.id || "");
          const orderId = rawOrderId.replace(/^INSTA-/, "");
          const storeName = entry.restaurant_name || entry.store_name || "Swiggy Instamart";

          let orderDate = "";
          let displayDate = "";
          if (entry.order_time || entry.created_at) {
            const d = new Date(entry.order_time || entry.created_at);
            if (!isNaN(d.getTime())) {
              orderDate = d.toISOString().split("T")[0];
              displayDate = d.toLocaleDateString("en-IN", { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
            }
          }

          let totalAmount = parseFloat(entry.order_total || entry.net_amount || entry.final_amount || 0);
          if (totalAmount > 100000 && Number.isInteger(totalAmount)) totalAmount /= 100;

          let totalSavings = parseFloat(entry.order_discount || entry.discount || 0);
          if (totalSavings > 100000 && Number.isInteger(totalSavings)) totalSavings /= 100;

          const addressStr = Schema.formatAddressString(entry.delivery_address || entry.address || entry.delivery_address_details);
          const locationLabel = Schema.extractLocationLabel(addressStr);

          const items = [];
          const rawItems = entry.order_items || entry.items || [];
          rawItems.forEach(it => {
            const name = it.name || it.item_name || "Grocery Item";
            const qty = parseInt(it.quantity || it.item_quantity || 1, 10);
            let price = parseFloat(it.final_price || it.price || it.sub_total || 0);
            if (price > 50000 && Number.isInteger(price)) price /= 100;
            const unitPrice = qty > 0 ? (price / qty) : price;
            let mrp = it.mrp ? parseFloat(it.mrp) : unitPrice;
            if (mrp > 50000 && Number.isInteger(mrp)) mrp /= 100;
            const savings = Math.max(0, (mrp - unitPrice) * qty);

            items.push(Schema.createItem({
              name: name,
              brand: it.brand || "Instamart",
              category: it.category || "Groceries",
              quantity: qty,
              weight: Schema.normalizeWeight(it.quantity_description || it.weight || it.variant || it.pack_size || ""),
              unitPrice: unitPrice,
              mrp: mrp,
              totalPrice: price,
              savings: savings,
              isVeg: it.is_veg === 1 || it.is_veg === true,
              imgUrl: it.image_url || it.cloudinary_image_id || ""
            }));
          });

          const normalized = Schema.createOrder({
            platform: "instamart",
            orderNumber: `INSTA-${orderId}`,
            orderId: orderId,
            date: orderDate,
            displayDate: displayDate,
            deliverySlot: "Delivered in 10-15 mins",
            deliveryTime: displayDate,
            monthKey: Schema.getMonthKey(orderDate),
            amount: totalAmount,
            subtotal: totalAmount + totalSavings,
            savings: totalSavings,
            paymentStatus: "Paid",
            paymentMethod: entry.payment_method || entry.payment_mode || "Online",
            deliveryStatus: "Delivered",
            address: addressStr,
            location: locationLabel,
            storeName: storeName,
            itemsCount: items.length || 1,
            items: items
          });

          parsedOrders.push(normalized);
        }
      });

      return parsedOrders;
    },

    isInstamartOrder: function(order) {
      if (!order) return false;
      const type = String(order.order_type || order.type || "").toLowerCase();
      const restaurant = String(order.restaurant_name || order.restaurant?.name || order.store_name || "").toLowerCase();
      return (
        type.includes("instamart") ||
        type.includes("grocery") ||
        type.includes("dash") ||
        restaurant.includes("instamart") ||
        restaurant.includes("darkstore") ||
        order.is_instamart === true ||
        !!order.order_data_v2
      );
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = InstamartParser;
  } else {
    root.InstamartParser = InstamartParser;
  }
})(typeof window !== "undefined" ? window : global);
