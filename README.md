# Sempoa Books

Accounting, statutory payroll and e-Invoice readiness for Malaysian SMEs.

**Open it:** https://eldrolee.github.io/sempoa-books/

© 2026 Sempoa Books. All rights reserved. This is proprietary software — see [LICENSE](LICENSE).
The files here are published only so GitHub Pages can serve the app. Copying, re-hosting
or reverse-engineering it is not permitted.

## Accounts and security
- **Member sign-in:** each person signs in with their own email and password. The owner creates the
  first account, then issues temporary passwords to staff (who must change them at first sign-in).
- **Encrypted books:** data is encrypted in the browser with AES-256-GCM. The key is wrapped for each
  member with PBKDF2-SHA256 (310,000 rounds), so nothing readable is left in browser storage.
- **Protection:** 5 wrong passwords lock that email for 15 minutes; optional authenticator-app 2-step
  sign-in; automatic lock after inactivity; a recovery code for forgotten passwords.
- **Privacy (PDPA 2010):** privacy notice in English, Bahasa Malaysia and Chinese with recorded consent,
  an access log, masked IC and tax numbers, data export for access requests, and erasure that keeps the
  records the law requires for 7 years.

## Limits
- **Cloud sync (Supabase, Singapore):** members sign in from any device. Only the encrypted file is
  uploaded; the server never sees business data. Database setup: `supabase/schema.sql`.
- Keep encrypted backups as well (Import & migrate → Backup & restore).
- If both the password and the recovery code are lost, the books cannot be recovered.
- e-Invoices are prepared, not submitted to LHDN. Check statutory figures with a licensed tax agent.
- Shopee order sync needs Shopee Open Platform partner approval. Setup: run `supabase/marketplace.sql`, deploy
  `supabase/functions/marketplace`, and set the secrets SHOPEE_PARTNER_ID, SHOPEE_PARTNER_KEY and FUNCTION_URL.
- PEPPOL files (PINT MY or BIS Billing 3.0) are generated for you to send through a PEPPOL access point.
