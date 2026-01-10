# Release Checklist (Pre‑Launch)

## Domains

- [ ] Purchase domain: `chronote.gg` (if available)
- [ ] Configure DNS (prod + staging): `chronote.gg`, `staging.chronote.gg`

## Stripe

- [ ] Create live products + prices (monthly + annual)
- [ ] Confirm lookup keys / price IDs
- [ ] Configure webhook endpoint + secret
- [ ] Verify portal settings (prorations, downgrades next cycle)

## Secrets & Config

- [ ] Create Secrets Manager entries (prod + staging)
- [ ] Map secrets to ECS task env
- [ ] Set Langfuse public and secret keys in Secrets Manager (prod + staging)
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
