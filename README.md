# APAR Inspector

Sistem Inspeksi dan Monitoring APAR Digital — PT. Saptaindra Sejati Hauling

## Live URLs

| | URL |
|---|---|
| 📱 App | `https://SISMACO.github.io/apar-inspector/` |
| 📊 Dashboard | `https://SISMACO.github.io/apar-inspector/dashboard/` |
| 🏷️ Label Generator | `https://SISMACO.github.io/apar-inspector/labels/` |

> Ganti `SISMACO` dengan GitHub username kamu setelah deploy.

## Setup

### 1. Google Sheets Backend
- Buka Google Sheets baru
- Extensions → Apps Script → paste isi `backend/google-apps-script.js`
- Pilih fungsi `setup()` → Run
- Deploy → Web App → Execute as: Me → Anyone
- Copy URL yang muncul (ending `/exec`)

### 2. Paste URL ke kode
Edit `app.js` line 3 dan `dashboard/index.html` — ganti `REPLACE_WITH_YOUR_DEPLOYMENT_ID` dengan URL dari step 1.

### 3. GitHub Pages
- Settings → Pages → Source: Deploy from branch → main → / (root)
- Tunggu ~1 menit → site live

## File Structure

```
├── index.html          ← App mobile (PWA)
├── app.js              ← Logic utama
├── styles.css          ← Styling
├── sw.js               ← Service Worker (offline)
├── manifest.json       ← PWA manifest
├── icon-192.png
├── icon-512.png
├── dashboard/
│   └── index.html      ← Dashboard web analitik
├── labels/
│   └── index.html      ← QR Label Generator
└── backend/
    └── google-apps-script.js  ← Paste ke Apps Script
```

## Stack
- App: Vanilla JS + PWA (IndexedDB, Service Worker)
- Backend: Google Sheets + Apps Script
- Dashboard: Chart.js, Leaflet.js, SheetJS
- Hosting: GitHub Pages (free)
- Biaya: Rp 0
