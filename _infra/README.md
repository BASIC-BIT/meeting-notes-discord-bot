# Infrastructure Notes

## Observability (AMP + AMG)

This stack provisions:

- Amazon Managed Prometheus (AMP) workspace
- Amazon Managed Grafana (AMG) workspace
- (Optional) Grafana datasource + starter dashboard via the Grafana provider

### Prerequisites

- **AWS Organizations enabled** (single-account org is fine)
- **IAM Identity Center (AWS SSO)** enabled in the **same region** as AMG (us-east-1 here)

### Bootstrap steps (Grafana service account token)

1. **First apply** (creates AMP + AMG):

   - Leave `grafana_api_key` and `grafana_url` empty in `terraform.tfvars`.
   - Run: `terraform apply`

2. **Create a Grafana service account + token** (preferred):

   - Open the Grafana workspace URL.
   - In Grafana: _Administration → Service accounts_ → **New service account** (role: Admin).
   - Create a **token** and copy it.
   - Copy the workspace **endpoint URL** (e.g., `https://g-xxxx.grafana-workspace.us-east-1.amazonaws.com/`).

3. **Second apply** (provisions datasource + dashboard):
   - Set either in `terraform.tfvars` or env vars:
     - `grafana_api_key` (service account token)
     - `grafana_url`
   - Then run: `terraform apply`

### Useful tips

- If AMG workspace creation conflicts, bump `grafana_suffix_seed` in `terraform.tfvars` to force a new workspace name suffix.
- If you change the workspace name, you may want to update `grafana_url` before the second apply.
