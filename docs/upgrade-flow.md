# Upgrade flow

## Current experience

- Entry points live on the marketing site at `/upgrade` and `/promo/:code`.
- The dedicated server picker and plan selection live at `/upgrade/select-server`.
- Stripe Checkout handles payment and returns to `/upgrade/success`.
- The success page highlights the upgraded server when a server id is available and routes users back into the portal.

## Operational notes

- Promo codes can be prefilled from the promo landing page and are applied at checkout.
- The upgrade flow is designed to fast-track intent, so it bypasses the portal billing page and goes straight from server selection to Stripe.

## Planned enhancements

- Short upgrade links stored in DynamoDB. These would map a short token to promo codes, suggested plans, and optional server defaults without exposing those details in the URL.
- Preselected server and plan hints in the upgrade flow, for marketing campaigns and in-bot upgrade nudges.
