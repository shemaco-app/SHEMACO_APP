# PWA-only Google Sheets sync fix

This package changes only the PWA. It does not include or modify the dashboard or Apps Script backend.

## What was fixed

The existing Apps Script backend expects inspection fields named:
`unitLocation`, `unitType`, `intervalMonths`, `nextDue`, `gpsLat`, `gpsLng`, `hasPhoto`, and `hasSignature`.

The PWA stored several of these differently (for example GPS under `gps.lat/gps.lng`, and photo/signature as the actual local values). Before POSTing to Apps Script, `app.js` now normalizes every pending inspection into the backend's expected flat payload.

This normalization is done at sync time, so inspections already waiting in IndexedDB can also be retried with the corrected payload after this update.

The service-worker cache name was also bumped so installed phones receive the corrected `app.js` instead of continuing to use the older cached script.

## Deployment

Replace the PWA files on your current PWA hosting with this package. Keep your existing Google Apps Script backend and dashboard unchanged.

After deployment, on the phone open the PWA while online and reload it. If it was installed to the home screen, close and reopen it after the first online reload so the new service worker can activate.

## Endpoint

The package retains the Apps Script URL that was already present in your original PWA:
`https://script.google.com/macros/s/AKfycbz8o0-LTLEJu3SqoXvC9f-g8n21mqS1l-9HtK2kZ8mpqSSe5rP77Z2ofAd5b5W4pe2g/exec`

If your production backend uses a different deployment URL, replace `SHEET_SYNC_URL` at the top of `app.js` with your current `/exec` URL before deployment.
