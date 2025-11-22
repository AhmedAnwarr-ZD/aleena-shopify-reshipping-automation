/***** CONFIG *****/
// Re-shipping Script: Creates draft orders with 29 SAR shipping (VAT calculated by Shopify)
const SHOPIFY_SHOP = 'shopaleena';
const SHOPIFY_API_VERSION = '2025-07';
const SHOPIFY_ACCESS_TOKEN = 'shpat_XXXXXXXXXXXXXXXXX';

// Re-ship settings
const RESHIP_TITLE = 'Re-shipping Fees';      // Line item shown on the draft order
const RESHIP_SKU = '000222000';               // Re-shipping product SKU
const RESHIP_PRICE_SAR = 29.00;               // Base line item price (will be discounted 100%)
const SHIPPING_RATE_SAR = 29.00;              // Fixed shipping rate (VAT will be added by Shopify)
const APPLY_TAGS = ['skip_cod_fees'];         // Draft order tags
const DISCOUNT_LABEL_FMT = (orderName, damagedSku) => `Reshipping ${orderName} SKU ${damagedSku}`;

// Arabic invoice content
const INVOICE_SUBJECT = 'فاتورة اعادة شحن المنتج | متجر الينا';
const INVOICE_MESSAGE =
  'عزيزتي العميلة،\n\n' +
  'يرجى دفع رسوم الشحن عن طريق الضغط على الزر الأزرق أدناه.\n\n' +
  'سعدنا بخدمتك\n' +
  'فريق ألينا';

// Sheet mapping (optional UI flow)
const COL_EMAIL = 1;       // A
const COL_ORDER = 2;       // B
const COL_SKU = 3;         // C
const COL_STATUS = 4;      // D (written by script)
const COL_LINK = 5;        // E (written by script)

/***** MENU *****/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Reship')
    .addItem('Send invoice for selected row', 'sendInvoiceForSelectedRow')
    .addToUi();
}

/***** MAIN: row-based helper *****/
function sendInvoiceForSelectedRow() {
  const sh = SpreadsheetApp.getActiveSheet();
  const row = sh.getActiveRange().getRow();
  const email = String(sh.getRange(row, COL_EMAIL).getValue()).trim();
  const orderName = String(sh.getRange(row, COL_ORDER).getValue()).trim();
  const damagedSku = String(sh.getRange(row, COL_SKU).getValue()).trim();

  if (!email || !orderName || !damagedSku) {
    throw new Error('Missing email, order name, or damaged SKU in the selected row.');
  }

  try {
    const result = createReshipDraftAndSend(email, orderName, damagedSku);

    sh.getRange(row, COL_STATUS).setValue('✅ Sent');
    if (result && result.invoice_url) {
      sh.getRange(row, COL_LINK).setValue(result.invoice_url);
    }
    SpreadsheetApp.getActive().toast('Invoice sent.');
   } catch (err) {
    const msg = err.message || String(err);

    if (msg.indexOf('الطلب لا زال قيد الارجاع') === 0) {
      // Special case: return in progress
      sh.getRange(row, COL_STATUS).setValue('FAILED - ' + msg);
    } else {
      // Any other error
      sh.getRange(row, COL_STATUS).setValue('❌ ' + msg);
    }

    SpreadsheetApp.getActive().toast('Failed: ' + msg);
    throw err;
  }
}

/***** MAIN: direct call (no sheet) *****/
// Example: createReshipDraftAndSend('customer@example.com', 'A180880', '000222000');
function createReshipDraftAndSend(email, previousOrderName, damagedSku) {
  // 1) Find the original order to pull shipping address AND customer info
  const order = findOrderByName(previousOrderName);
  if (!order) throw new Error(`Order not found by name: ${previousOrderName}`);

  // Block if order is in return process
  const orderTags = (order.tags || '').toLowerCase();
  if (orderTags.indexOf('return_in_progress') !== -1) {
    // This will be caught by the sheet handler and shown as FAILED
    throw new Error('الطلب لا زال قيد الارجاع، انتظر حتى الغاء الارجاع وحاول مجددا');
  }

  const ship = order.shipping_address;
  if (!ship) throw new Error(`Original order ${previousOrderName} has no shipping address.`);

  // 2) Use ORIGINAL customer info instead of creating new customer
  let customerInfo = null;
  if (order.customer && order.customer.id) {
    // Use existing customer data
    customerInfo = {
      id: order.customer.id,
      email: order.customer.email || email,
      first_name: order.customer.first_name || ship.first_name || '',
      last_name: order.customer.last_name || ship.last_name || '',
      phone: order.customer.phone || ship.phone || ''
    };
  } else {
    // Fallback: create customer info from shipping address
    customerInfo = {
      email: email,
      first_name: ship.first_name || '',
      last_name: ship.last_name || '',
      phone: ship.phone || ''
    };
  }

  if (!customerInfo.email) {
    throw new Error('Customer email is required to send invoice.');
  }

  // 3) Use fixed shipping rate (VAT will be calculated by Shopify)
  const shippingRate = {
    title: 'Standard Shipping',
    price: SHIPPING_RATE_SAR,
    custom: true,
    handle: null
  };

  // 4) Build draft order payload (uses fixed shipping rate + Shopify VAT calculation)
  const payload = buildDraftOrderPayload({
    email,
    orderName: normalizeOrderName(previousOrderName),
    damagedSku,
    shippingAddress: ship,
    customerInfo,
    shippingRate
  });

  // 5) Create draft order
  const draft = shopifyPost(`/draft_orders.json`, payload);
  const draftOrder = draft && draft.draft_order;
  if (!draftOrder || !draftOrder.id) {
    throw new Error('Draft order creation failed — no id returned.');
  }

  // 6) Send invoice (Arabic subject/body)
  const invoiceBody = {
    draft_order_invoice: {
      to: customerInfo.email,
      subject: INVOICE_SUBJECT,
      custom_message: INVOICE_MESSAGE
    }
  };
  shopifyPost(`/draft_orders/${draftOrder.id}/send_invoice.json`, invoiceBody);

  // Return useful info to caller
  return {
    draft_id: draftOrder.id,
    invoice_url: draftOrder.invoice_url || '',
  };
}

/***** HELPERS *****/
function normalizeOrderName(name) {
  // normalize like A180880 (Shopify "name" query expects exact)
  const m = String(name).match(/A\d+/i);
  return m ? m[0].toUpperCase() : String(name).toUpperCase();
}

function findOrderByName(orderName) {
  const name = encodeURIComponent(normalizeOrderName(orderName));
  const url = `/orders.json?name=${name}&status=any&limit=1`;
  const data = shopifyGet(url);
  return (data && data.orders && data.orders.length) ? data.orders[0] : null;
}

function getShippingRateForAddress(shippingAddress) {
  try {
    const countryCode = (shippingAddress.country_code || shippingAddress.country_code_v2 || '').toUpperCase();
    if (!countryCode) return null;

    // Get shipping zones
    const data = shopifyGet('/shipping_zones.json');
    const zones = (data && data.shipping_zones) || [];
    
    for (const zone of zones) {
      const countries = (zone.countries || []).map(c => (c.code || '').toUpperCase());
      if (countries.includes(countryCode)) {
        // Try to find a suitable rate
        const priceRates = zone.price_based_shipping_rates || [];
        const weightRates = zone.weight_based_shipping_rates || [];
        
        // Prefer price-based rates
        if (priceRates.length > 0) {
          const rate = priceRates[0]; // Use first available rate
          return {
            title: rate.name || 'Shipping',
            price: parseFloat(rate.price || DEFAULT_SHIPPING_RATE_SAR),
            code: rate.id || 'STANDARD'
          };
        }
        
        // Fallback to weight-based rates
        if (weightRates.length > 0) {
          const rate = weightRates[0];
          return {
            title: rate.name || 'Shipping',
            price: parseFloat(rate.price || DEFAULT_SHIPPING_RATE_SAR),
            code: rate.id || 'STANDARD'
          };
        }
      }
    }
    
    return null;
  } catch (err) {
    console.log('Error getting shipping rate:', err.message);
    return null;
  }
}

function buildDraftOrderPayload({ email, orderName, damagedSku, shippingAddress, customerInfo, shippingRate }) {
  const payload = {
    draft_order: {
      line_items: [
        {
          title: RESHIP_TITLE,
          sku: RESHIP_SKU,
          price: RESHIP_PRICE_SAR.toFixed(2),
          quantity: 1,
          requires_shipping: true,    // CRITICAL: Required for shipping line to appear
          taxable: false,             // Don't tax the discounted item
          applied_discount: {
            title: DISCOUNT_LABEL_FMT(orderName, damagedSku),
            value_type: 'percentage',
            value: '100.0'
          }
        }
      ],
      // Use original customer info
      customer: customerInfo,
      shipping_address: pickAddressFields(shippingAddress),
      tags: APPLY_TAGS.join(','), // Shopify accepts comma-separated string
      // Custom shipping line (try without 'custom' and 'handle' properties)
      shipping_line: {
        title: shippingRate.title,
        price: shippingRate.price.toString() // Must be string
      }
      // Let Shopify handle VAT calculation based on store settings
    }
  };

  return payload;
}

function pickAddressFields(addr) {
  return {
    first_name: addr.first_name || '',
    last_name: addr.last_name || '',
    address1: addr.address1 || '',
    address2: addr.address2 || '',
    city: addr.city || '',
    province: addr.province || '',
    country: addr.country || '',
    country_code: (addr.country_code || addr.country_code_v2 || '') || '',
    zip: addr.zip || '',
    phone: addr.phone || ''
  };
}

/***** Shopify HTTP wrappers *****/
function shopifyGet(path) {
  const url = `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  checkResponse(res, 'GET ' + path);
  return JSON.parse(res.getContentText());
}

function shopifyPost(path, bodyObj) {
  const url = `https://${SHOPIFY_SHOP}.myshopify.com/admin/api/${SHOPIFY_API_VERSION}${path}`;
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    muteHttpExceptions: true,
    payload: JSON.stringify(bodyObj),
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    }
  });
  checkResponse(res, 'POST ' + path);
  return JSON.parse(res.getContentText());
}

function checkResponse(res, label) {
  const code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`${label} failed: HTTP ${code} — ${res.getContentText()}`);
  }
}
