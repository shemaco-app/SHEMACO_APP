# SPARTA PWA — Exact Apps Script Backend Fix

This package changes only the PWA.

## Backend contract used
- Read: `GET /exec?action=getAllData&callback=...` (JSONP)
- Inspection write: POST `action/type = inspection`
- Stock-in write: POST `action/type = stock_in`
- Stock-out write: POST `action/type = stock_out`

## Key fixes
1. PWA GET now explicitly requests `action=getAllData`; bare `/exec` renders the Apps Script dashboard HTML.
2. PWA consumes `inspectionLogs` and uses `inspection_id` as the IndexedDB key, preventing duplicate local/server records.
3. Inspection POST fields now match `submitInspection_()` exactly, including checklist, `apar_code`, `lokasi_detail`, `kapasitas`, inspector, GPS and notes.
4. Raw base64 photo/signature are retained locally but are not posted into backend `photo_url`/`signature_url` fields. That backend expects URL strings and does not implement Drive upload.
5. Because POST uses `no-cors`, the PWA now re-reads `getAllData` and verifies the record exists before setting `synced=true`.
6. Service-worker cache bumped to v12.

## Deployment
Upload the files in this folder to the existing PWA GitHub Pages location. Do not replace the Apps Script backend or dashboard. Verify `SHEET_SYNC_URL` in `app.js` is the current deployed `/exec` URL.
