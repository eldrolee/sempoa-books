# Sempoa Books

Accounting, statutory payroll and e-Invoice readiness for Malaysian SMEs — a working prototype.

**Open it:** after GitHub Pages is switched on, the app runs at `https://<your-username>.github.io/sempoa-books/`.

## What is inside
- Double-entry ledger, sales and purchase documents, inventory, SST, multi-company and roles
- Statutory payroll (EPF, SOCSO, EIS, PCB), payslips, EA statements, staff self-service pay with PIN
- LHDN MyInvois readiness checks and JSON payloads, monthly B2C consolidation
- Cash forecast, collections with WhatsApp reminders, bank statement matching, recurring and batch invoices
- Fixed assets and capital allowances, FX revaluation, tags, 25+ reports
- Insights: health score, Monte Carlo cash risk, audit radar, RFM segments, smart reorder, loan readiness
- Interface in English, 中文 and Bahasa Melayu

## Important
- This is a **prototype**: all data is stored only in the browser that opens it (localStorage). Use *Import & migrate → Backup & restore* to keep a copy.
- Sign-in has no passwords. Do not put real company data on a public link.
- e-Invoices are prepared, not submitted to LHDN. Payroll figures follow the official 2026 tables and LHDN's PCB specification, but have not been verified by LHDN; check with a licensed tax agent before relying on them.

## Files
- `index.html` — the app, ready to open (no build step)
- `src/app.jsx` — readable source of the app code
