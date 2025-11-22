# Shopify Re-Shipping Automation (Draft Orders + Fees)

Automation for Aleena (fashion eCommerce) that creates **Shopify draft orders for re-shipping fees** with a fixed 29 SAR shipping rate, correct VAT behavior, and guardrails for orders in return flow.

## Problem

Support agents had to manually:
- Calculate re-shipping fees
- Create draft orders in Shopify
- Add correct tags / discounts
- Inform the customer and finance

This was slow, error-prone, and led to inconsistent handling of “re-shipping after failed delivery”.

## Solution

A Google Apps Script that:
- Creates a **draft order** with:
  - `Re-shipping Fees` line item (discounted 100%)
  - **Shipping rate: 29 SAR** (Shopify adds VAT)
- Applies the right **tags** (e.g. `skip_cod_fees`) to instruct downstream finance/ops logic
- Generates a **payment link** for the customer
- Handles special case:  
  - If the order is in “return in progress”, it returns a **FAILED** status and message:  
    > "الطلب لا زال قيد الارجاع، انتظر حتى الغاء الارجاع وحاول مجددا"

## Tech Stack

- Google Apps Script (JavaScript)
- Shopify Admin REST API

## Key Features

- Draft order creation with consistent structure
- Fixed shipping rate with proper VAT handling
- Clear labels for finance/ops via tags
- Safety guard for “return in progress” orders

## How It Works (Flow)

1. Support/ops system triggers the webhook / Apps Script entrypoint with:
   - Original order ID
   - Customer info (if needed)
2. Script reads order details from Shopify
3. Script:
   - Creates draft order
   - Adds 29 SAR shipping
   - Adds product line `Re-shipping Fees` discounted 100%
   - Adds appropriate tags (e.g. `skip_cod_fees`)
4. Returns:
   - Payment URL
   - Status (`SUCCESS` / `FAILED`)
   - Error reason if blocked (e.g. return in progress)

## Configuration

Script Properties / Environment:

- `SHOPIFY_SHOP`
- `SHOPIFY_API_VERSION`
- `SHOPIFY_ACCESS_TOKEN`
- `RESHIP_TITLE`
- `RESHIP_SKU`
- `RESHIP_PRICE_SAR`
- `SHIPPING_RATE_SAR`
- Optional: tags / discount labels

## Business Impact (Estimate)

- **40–60% reduction** in manual handling time per re-shipping case
- **Fewer finance disputes** thanks to consistent tagging and discount logic
- Clearer customer communication around re-shipping fees

## My Role

I acted as **Tech PM & Automation Architect**, mapped the re-shipping journey with Ops & Finance, and implemented the full automation in Apps Script and Shopify Admin API.
