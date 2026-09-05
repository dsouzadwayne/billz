/**
 * billz - Swiggy Food Platform Parser
 * Parses Swiggy food delivery order API responses (/dapi/order/all) into normalized billz orders.
 */

(function(root) {
  const Schema = (typeof module !== "undefined" && module.exports)
    ? require("../../core/schema.js")
    : root.BillzSchema;

  const SwiggyParser = {
    platform: "swiggy",

    /**
     * Parse Swiggy orders from /dapi/order/all or /mapi/order/all JSON response
     */
    parseOrderListingResponse: function(data) {
      if (!data) return [];

      // Response may be wrapped under data.orders or orders directly
      const rawOrders = (data.data && Array.isArray(data.data.orders))
        ? data.data.orders
        : (Array.isArray(data.orders) ? data.orders : []);

      if (rawOrders.length === 0) return [];

      const parsedOrders = [];

      rawOrders.forEach(order => {
        // Distinguish if this is an Instamart order or regular restaurant order
        const isInstamart = SwiggyParser.isInstamartOrder(order);
        if (isInstamart) {
          // If routed here by mistake, skip or let instamart parser handle it
          return;
        }

        // Filter out cancelled orders
        const orderStatus = String(order.order_status || order.status || "").toLowerCase();
        if (
          orderStatus.includes("cancel") ||
          orderStatus.includes("failed") ||
          orderStatus.includes("rejected") ||
          order.is_cancelled === true
        ) {
          return;
        }

        const rawOrderId = String(order.order_id || order.id || "");
        const orderId = rawOrderId.replace(/^SWG-/, "");
        const restaurantName = order.restaurant_name || order.restaurant?.name || "Swiggy Restaurant";
        
        // Parse date and time
        let orderDate = "";
        let displayDate = "";
        if (order.order_time) {
          const d = new Date(order.order_time);
          if (!isNaN(d.getTime())) {
            orderDate = d.toISOString().split("T")[0];
            displayDate = d.toLocaleDateString("en-IN", { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
          }
        } else if (order.created_at) {
          const d = new Date(order.created_at);
          if (!isNaN(d.getTime())) {
            orderDate = d.toISOString().split("T")[0];
            displayDate = d.toLocaleDateString("en-IN", { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
          }
        }

        // Calculate pricing (Swiggy sometimes provides amounts in rupees or paise)
        let totalAmount = parseFloat(order.order_total || order.net_amount || order.final_amount || 0);
        // If amount is unnaturally large (e.g. > 50000 with no decimals, it might be in paise)
        if (totalAmount > 100000 && Number.isInteger(totalAmount)) {
          totalAmount = totalAmount / 100;
        }

        let totalSavings = parseFloat(order.order_discount || order.discount || order.total_discount || 0);
        if (totalSavings > 100000 && Number.isInteger(totalSavings)) {
          totalSavings = totalSavings / 100;
        }

        // Address resolution
        const addressStr = Schema.formatAddressString(order.delivery_address || order.address);
        const locationLabel = Schema.extractLocationLabel(addressStr);

        // Items extraction
        const items = [];
        const rawItems = order.order_items || order.items || [];
        rawItems.forEach(it => {
          const itemName = it.name || it.item_name || "Food Item";
          const qty = parseInt(it.quantity || it.item_quantity || 1, 10);
          let price = parseFloat(it.final_price || it.price || it.sub_total || 0);
          if (price > 50000 && Number.isInteger(price)) price = price / 100;

          const unitPrice = qty > 0 ? (price / qty) : price;

          items.push(Schema.createItem({
            name: itemName,
            brand: restaurantName,
            category: it.category || "Meal",
            quantity: qty,
            weight: it.portion_size || it.variant || "",
            unitPrice: unitPrice,
            mrp: unitPrice,
            totalPrice: price,
            savings: 0,
            isVeg: it.is_veg === 1 || it.is_veg === true,
            imgUrl: it.image_url || it.cloudinary_image_id || ""
          }));
        });

        const normalized = Schema.createOrder({
          platform: "swiggy",
          orderNumber: `SWG-${orderId}`,
          orderId: orderId,
          date: orderDate,
          displayDate: displayDate,
          deliverySlot: "Delivered in 30-45 mins",
          deliveryTime: displayDate,
          monthKey: Schema.getMonthKey(orderDate),
          amount: totalAmount,
          subtotal: totalAmount + totalSavings,
          savings: totalSavings,
          paymentStatus: "Paid",
          paymentMethod: order.payment_method || order.payment_mode || "Online",
          deliveryStatus: "Delivered",
          address: addressStr,
          location: locationLabel,
          storeName: restaurantName,
          itemsCount: items.length || order.total_item_count || 1,
          items: items
        });

        parsedOrders.push(normalized);
      });

      return parsedOrders;
    },

    /**
     * Check if an order object belongs to Swiggy Instamart rather than food delivery
     */
    isInstamartOrder: function(order) {
      if (!order) return false;
      const type = String(order.order_type || order.type || "").toLowerCase();
      const restaurant = String(order.restaurant_name || order.restaurant?.name || "").toLowerCase();
      return (
        type.includes("instamart") ||
        type.includes("grocery") ||
        restaurant.includes("instamart") ||
        restaurant.includes("darkstore") ||
        order.is_instamart === true
      );
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = SwiggyParser;
  } else {
    root.SwiggyParser = SwiggyParser;
  }
})(typeof window !== "undefined" ? window : global);
