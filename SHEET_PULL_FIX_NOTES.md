# PWA Google Sheet pull fix

This package changes only the PWA.

## Root cause
The PWA dashboard previously read `inspections`, `stock_in`, and `stock_out` only from browser IndexedDB. It POSTed new records to Apps Script, but never GET/pulled the existing Google Sheet database. Therefore a new browser/device displayed 0 even when the Sheet already contained data.

## Fix
- Pulls the existing Apps Script `doGet` response using JSONP (same CORS-safe mechanism used by the existing dashboard).
- Caches Units, Inspections, StockIn, and StockOut into IndexedDB for offline viewing.
- Preserves unsynced local records.
- Avoids obvious duplicate inspection display by comparing date + unitId + inspector.
- After pushing pending records, refreshes from Google Sheet.
- Refreshes again when connectivity returns.
- Uses local calendar date for "Inspeksi Hari Ini" instead of UTC date.
- Service worker cache bumped so deployed phones receive the new JavaScript.

No dashboard or Apps Script/backend files are included or changed.
