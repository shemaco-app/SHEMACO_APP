# SPARTA MACO

Sistem Pemantauan Alat Respon Tanggap Darurat Area — PWA untuk inspeksi APAR/peralatan tanggap darurat.

## Update v2

- PWA tetap offline-first.
- Form inspeksi mendukung 2 metode:
  1. Scan QR/barcode atau search/input kode APAR.
  2. APAR tanpa kode/tag, terutama APAR di unit DT/HD.
- Master APAR ditarik dari Apps Script endpoint `getAparList` untuk dropdown/search.
- Jika online, master APAR dicache ke IndexedDB agar tetap bisa dipakai offline.
- Hasil inspeksi tanpa kode disimpan dengan `asset_mode = unit_without_code` dan `generated_code` berbasis no. unit + posisi + kapasitas.

## URL

App GitHub Pages:

```txt
https://sismaco.github.io/SPARTA_MACO/
```

Backend / Dashboard Apps Script:

```txt
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

Pastikan nilai `SHEET_SYNC_URL` di `app.js` sama dengan URL deployment Apps Script terbaru.
