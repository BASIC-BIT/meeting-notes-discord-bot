# Release Checklist (Pre‑Launch)

## Domains

- [x] Purchase domain: `chronote.gg` (if available)
- [x] Configure DNS (prod + staging): `chronote.gg`, `staging.chronote.gg`

## Stripe

- [x] Create live products + prices (monthly + annual)
- [x] Confirm lookup keys / price IDs
- [x] Configure webhook endpoint + secret
- [ ] Verify portal settings (prorations, downgrades next cycle)

## Secrets & Config

- [ ] Create Secrets Manager entries (prod + staging)
- [ ] Map secrets to ECS task env
- [ ] Add/verify env vars in Terraform (prod + staging)

## Infrastructure

- [ ] Terraform apply (staging)
- [ ] Terraform apply (prod)
- [ ] Verify ACM certs + CloudFront aliases
- [ ] Enable AWS cost allocation tags (Project, Environment) in Billing console

## Deploy

- [ ] Deploy backend (staging)
- [ ] Deploy frontend (staging)
- [ ] Smoke test staging (OAuth, Ask, Billing, Library)
- [ ] Deploy backend (prod)
- [ ] Deploy frontend (prod)

## Post‑Deploy

- [ ] Verify Stripe checkout + webhook in prod
- [ ] Verify Discord bot flow in prod
- [ ] Confirm dashboards/logs/alerts
