/**
 * billz - BigBasket Platform Parser
 * Parses BigBasket API responses (/order-listing/, /self-service/) into normalized billz orders.
 */

(function(root) {
  const Schema = (typeof module !== "undefined" && module.exports)
    ? require("../../core/schema.js")
    : root.BillzSchema;

  const BigBasketParser = {
    platform: "bigbasket",

    /**
     * Parse raw response from BigBasket /order-listing/ API
     */
    parseOrderListingResponse: function(data) {
      if (!data || !data.orders || !Array.isArray(data.orders)) return [];

      const parsedOrders = [];

      data.orders.forEach(group => {
        const groupAmount = parseFloat(group.total_order_amount) || 0;
        const groupSavings = parseFloat(group.total_savings) || 0;
        const member = group.member || {};
        const addressStr = `${member.first_name || ''} ${member.last_name || ''}, ${member.address1 || ''}, ${member.area || ''}, ${member.city || ''} - ${member.pin || ''}`.trim();

        (group.orders || []).forEach(sub => {
          const rawStatus = (sub.status || "").toLowerCase();
          const displayStatus = (sub.display_status || "").toLowerCase();
          const deliveryStatus = sub.delivery_status_title || "Delivered";
          const paymentStatus = sub.display_payment_status || sub.payment_status || "Unknown";
          const paymentMethod = sub.display_payment_method || "Unknown";
          const reasonText = (sub.reason_text || "").toLowerCase();

          // Exclude cancelled and incomplete orders
          if (
            sub.auto_cancelled === true ||
            rawStatus.includes("cancel") ||
            displayStatus.includes("cancel") ||
            deliveryStatus.toLowerCase().includes("cancel") ||
            paymentStatus.toLowerCase().includes("cancel") ||
            paymentStatus.toLowerCase().includes("incomplete") ||
            paymentStatus.toLowerCase().includes("failed") ||
            reasonText.includes("cancel")
          ) {
            return;
          }

          const orderNumber = sub.order_number || `BB-${sub.potential_order_id}`;
          const slotDate = sub.slot?.date || "";
          const displayDate = sub.slot?.display_date || slotDate;
          const deliverySlot = sub.slot?.shipment_time || sub.slot?.display_slot || "";
          const deliveryTime = sub.header_details?.msg || "";
          const finalAmount = parseFloat(sub.final_total) || groupAmount;

          const items = [];
          const rawLineItems = sub.line_items_grp?.no_change?.line_items || [];
          rawLineItems.forEach(item => {
            items.push(Schema.createItem({
              name: item.desc || item.invoice_desc || "Grocery Item",
              brand: item.brand || "",
              quantity: item.quantity || 1,
              weight: item.weight || "",
              unitPrice: parseFloat(item.sp) || 0,
              mrp: parseFloat(item.mrp) || 0,
              totalPrice: parseFloat(item.total) || 0,
              savings: parseFloat(item.savings) || 0,
              imgUrl: item.img_url || ""
            }));
          });

          const normalizedOrder = Schema.createOrder({
            platform: "bigbasket",
            orderNumber: orderNumber,
            orderId: String(sub.order_id || sub.potential_order_id || ""),
            date: slotDate,
            displayDate: displayDate,
            deliverySlot: deliverySlot,
            deliveryTime: deliveryTime,
            monthKey: Schema.getMonthKey(slotDate),
            amount: finalAmount,
            subtotal: parseFloat(sub.sub_total) || finalAmount,
            savings: parseFloat(sub.savings) || groupSavings,
            paymentStatus: paymentStatus,
            paymentMethod: paymentMethod,
            deliveryStatus: deliveryStatus,
            address: addressStr,
            storeName: "BigBasket",
            itemsCount: items.length || sub.items_count || 1,
            items: items
          });

          parsedOrders.push(normalizedOrder);
        });
      });

      return parsedOrders;
    }
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = BigBasketParser;
  } else {
    root.BigBasketParser = BigBasketParser;
  }
})(typeof window !== "undefined" ? window : global);
