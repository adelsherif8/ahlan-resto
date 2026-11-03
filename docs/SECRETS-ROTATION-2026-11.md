# Secrets rotation after the Railway incident (QH8L8B3E, 21 Oct 2026)

Railway's notice: *"We strongly recommend that you revoke all environment variables stored in
Railway, including API keys and private registry credentials."* Everything below was on the
`flows` or `api` service on 21 Oct and is treated as exposed. Status as of 2 Nov 2026.

Rule for this file: NEVER paste a secret value here, in chat, or in a commit. New values go
into `flows/.env` (git-ignored) and onto Railway with the script below.

## What is where

| Variable | Service | Who can mint a new one | Status |
|---|---|---|---|
| `OPS_TOKEN` / `FLOWS_OPS_TOKEN` | flows / api | us (random) | rotated 16 Oct — **before** the incident → rotate again |
| `JWT_SECRET` | api | us (random) | pending — logs every dashboard user out once |
| `ENCRYPTION_KEY` | flows + api (must match) | us (random hex 32 bytes) | pending — nothing in the control plane is encrypted today (all tenant creds are plaintext rows), so only build/track tokens (24 h / 14 d) are invalidated |
| `WA_VERIFY_TOKEN` | flows | us, then Meta App → WhatsApp → Configuration → Webhook "Verify token" | founder: the webhook must be re-verified in the Meta app dashboard with the new value |
| `NTFY_TOPIC` | flows | us (random topic name) | founder: re-subscribe the phone to the new topic (ntfy app → + → topic from `flows/.env`) |
| `OPENAI_API_KEY` | flows | founder: platform.openai.com → API keys → create (project key), then delete the old one | pending |
| `SUPABASE_AHLAN_SERVICE_KEY` (control plane, `sb_secret_…` style) | flows + api | founder: Supabase dashboard → project → Settings → API keys → "Create new secret key"; delete the old key after the deploy is green | pending |
| `WA_TOKEN` (system-user token) | flows | founder: Meta Business Settings → System users → the Ahlan system user → Generate new token (`whatsapp_business_messaging` + `whatsapp_business_management`), then revoke the old | pending — also unblocks the Flows build |
| `WA_APP_SECRET` | flows | founder: Meta App dashboard → App settings → Basic → App secret → Reset | pending — inbound webhooks fail signature until Railway has the new value, so set it within a minute of resetting |
| `IG_TOKEN` | flows | founder: Meta Graph Explorer / Business Settings — same system user, Instagram permissions | pending |
| `LINKEDIN_HOOK_URL` | flows | founder: wherever the hook was created (Zapier/Make) — regenerate the URL | pending (low value) |
| `SUPABASE_AHLAN_URL`, `WA_PHONE_NUMBER_ID`, `IG_USER_ID`, `MODEL_*`, `PUBLIC_BASE`, `RESTAURANT_SLUG`, `PORT`, `FLOWS_URL` | — | not secrets | nothing to do |

Tenant Supabase keys live in the control plane `restaurants.integrations.supabase.key` (DB, not
Railway) and were not in the Railway variables — out of scope here.

## How to rotate (any subset, in one go)

1. Mint the new values in the consoles above. Put each one in `flows/.env.new` as
   `NAME=value` (one per line). Only the names you are rotating.
2. Run `flows/tools/rotate-secrets.sh` — it reads `.env.new`, sets each variable on the
   right Railway service(s) (`ENCRYPTION_KEY` and `SUPABASE_AHLAN_SERVICE_KEY` go to both,
   `OPS_TOKEN` also becomes `FLOWS_OPS_TOKEN` on `api`), updates `flows/.env`, and deletes
   `.env.new`. Railway redeploys the services automatically on a variable change.
3. Verify: `curl https://flows-production-e528.up.railway.app/health` → `ok:true`; send one
   WhatsApp message to the Munadim number and see the reply (proves `WA_TOKEN`,
   `WA_APP_SECRET`, `OPENAI_API_KEY`, the Supabase key). Open the dashboard and log in once
   (proves `JWT_SECRET`); paste the new ops token into the ops console (it reads
   `ahlan_ops_token` from localStorage — Vercel has no copy of it).
4. Only then delete / revoke the OLD keys in the consoles.

Order that avoids downtime: self-made ones first (`OPS_TOKEN`, `JWT_SECRET`,
`ENCRYPTION_KEY`), then `OPENAI_API_KEY` and the Supabase key (both allow old+new to coexist
until you delete), then the Meta trio (`WA_TOKEN`, `WA_APP_SECRET`, `WA_VERIFY_TOKEN`) together
in one sitting, `IG_TOKEN` and `LINKEDIN_HOOK_URL` last.

## After the Meta token is rotated

The WhatsApp Flows build (docs/WA-FLOWS-PLAN.md) is code-complete and off by default. Turning
it on for Munadim: store the WABA id (`restaurants.integrations.whatsapp.waba_id`, from
WhatsApp Manager → the number's WABA), set `ai.address_flow = true` on the Munadim row, redeploy;
the boot log prints `address flows ready for munadim: en=… ar=…`. First real test: a delivery
order from a tester phone, fill the form, see the bill with the address.
