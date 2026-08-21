/* =========================================================
   APAR Inspector — offline-first, multi-module
   Modules: Dashboard · Scan · Inspeksi (wizard) · Stok
   Backend: Google Sheets via Apps Script (optional)
   ========================================================= */

const SHEET_SYNC_URL = "https://script.google.com/macros/s/AKfycbz8o0-LTLEJu3SqoXvC9f-g8n21mqS1l-9HtK2kZ8mpqSSe5rP77Z2ofAd5b5W4pe2g/exec";

const CHECKLIST_ITEMS = [
  { key: "handle",     q: "Handle sesuai standar" },
  { key: "hose",       q: "Hose sesuai standar (tidak robek, longgar, tersunbat, dan tertekuk)" },
  { key: "isi_tabung", q: "Isi tabung sesuai dengan risiko kebakaran" },
  { key: "lokasi_ap",  q: "Lokasi penempatan mudah dijangkau dan tidak terhalang" },
  { key: "nozzle",     q: "Noozle / Terompet sesuai standar (tidak robek, longgar, dan tersumbat)" },
  { key: "pin_lock",   q: "Pin Lock tersegel dan tidak rusak" },
  { key: "pressure",   q: "Pressure Gauge tidak rusak dan berada pada tekanan yang tepat (bar warna hijau)" },
  { key: "tabung",     q: "Tabung tidak ada kerusakan secara fisik (tidak berkarat dan keropos)" },
  { key: "kip",        q: "Terdapat kartu inspeksi Peralatan (KIP)" },
  { key: "rambu",      q: "Terdapat rambu APAR yang terpasang tepat di atas APAR" },
];

/* ───────────── IndexedDB ───────────── */
const DB_NAME = "aparDB", DB_VERSION = 2;
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("units")) db.createObjectStore("units", { keyPath: "id" });
      if (!db.objectStoreNames.contains("inspections")) {
        const s = db.createObjectStore("inspections", { keyPath: "id" });
        s.createIndex("unitId", "unitId", { unique: false });
      }
      if (!db.objectStoreNames.contains("stock_in")) db.createObjectStore("stock_in", { keyPath: "id" });
      if (!db.objectStoreNames.contains("stock_out")) db.createObjectStore("stock_out", { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
const dbPromise = openDB();
async function dbGetAll(s) { const db = await dbPromise; return new Promise((res,rej) => { const r = db.transaction(s,"readonly").objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function dbGet(s, k) { const db = await dbPromise; return new Promise((res,rej) => { const r = db.transaction(s,"readonly").objectStore(s).get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function dbPut(s, v) { const db = await dbPromise; return new Promise((res,rej) => { const tx = db.transaction(s,"readwrite"); tx.objectStore(s).put(v); tx.oncomplete = () => res(v); tx.onerror = () => rej(tx.error); }); }

/* ───────────── Utils ───────────── */
function uid(prefix) { return prefix + "_" + Date.now() + "_" + Math.random().toString(36).slice(2,7); }
function escapeHtml(s) {
  const map = {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"};
  return (s||"").replace(/[&<>"']/g, c => map[c]);
}
function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"}) : "–"; }
function fmtDT(iso) { return iso ? new Date(iso).toLocaleString("id-ID",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "–"; }
let _toastTimer;
function toast(msg) { const el = document.getElementById("toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(_toastTimer); _toastTimer = setTimeout(() => el.classList.remove("show"), 2800); }

/* ───────────── State ───────────── */
let activeTab = "dashboard";
let inspStep = 0;
let inspState = { unitId: null, unitIsNew: false, aparAvailable: null, checklist: {}, photo: null, gps: null, sigHasContent: false };
let activeStokTab = "masuk";
let activeRiwayatTab = "masuk";
let scanStream = null, scanActive = false;

/* ───────────── Tab Navigation ───────────── */
function showTab(name) {
  if (name === "scan") { startScanner(); }
  else if (name === "cepat") { startBulkScanner(); }
  else { stopScanner(); stopBulkScanner(); }
  document.querySelectorAll(".tab-screen").forEach(s => s.classList.toggle("active", s.dataset.screen === name));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.toggle("active", b.dataset.nav === name));
  activeTab = name;
  if (name === "dashboard") { renderDashboard(); checkUnsynced(); }
  if (name === "stok") renderStokSummary();
}

/* ── Modal helper ── */
function showModal(title, bodyHtml, onConfirm) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalBody").innerHTML = bodyHtml;
  document.getElementById("modalOverlay").style.display = "flex";
  document.getElementById("modalConfirm").onclick = () => { hideModal(); onConfirm(); };
  document.getElementById("modalCancel").onclick = hideModal;
}
function hideModal() { document.getElementById("modalOverlay").style.display = "none"; }

/* ── Unsynced data warning ── */
async function checkUnsynced() {
  const [ins, sIn, sOut] = await Promise.all([dbGetAll("inspections"), dbGetAll("stock_in"), dbGetAll("stock_out")]);
  const n = [...ins, ...sIn, ...sOut].filter(r => !r.synced).length;
  const el = document.getElementById("unsyncedWarning");
  if (n > 0 && !navigator.onLine) {
    el.style.display = "block";
    el.textContent = `⚠️ ${n} data belum tersinkron. Jangan hapus data browser sampai online kembali.`;
  } else { el.style.display = "none"; }
}

/* ── Photo collage generator ── */
async function createCollage(photos, inspections) {
  const MAX = 9;
  const used = photos.slice(0, MAX);
  const cols = used.length === 1 ? 1 : used.length <= 4 ? 2 : 3;
  const CELL = 280, HDR = 72;
  const rows = Math.ceil(used.length / cols);
  const canvas = document.createElement("canvas");
  canvas.width = cols * CELL;
  canvas.height = HDR + rows * CELL;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#14171A";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Header
  ctx.fillStyle = "#E63946";
  ctx.fillRect(0, 0, canvas.width, HDR);
  ctx.fillStyle = "#fff";
  ctx.font = `bold 17px Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText("LAPORAN INSPEKSI APAR", 14, 28);
  ctx.font = "13px Arial, sans-serif";
  const d = new Date().toLocaleDateString("id-ID", {day:"numeric",month:"long",year:"numeric"});
  ctx.fillText(`${d}  |  ${used.length} foto`, 14, 52);

  for (let i = 0; i < used.length; i++) {
    const { unitId, dataUrl, result } = used[i];
    const col = i % cols, row = Math.floor(i / cols);
    const x = col * CELL, y = HDR + row * CELL;

    // Draw photo cover-fitted
    await new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.max(CELL / img.width, CELL / img.height);
        const sw = CELL / scale, sh = CELL / scale;
        const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
        ctx.drawImage(img, sx, sy, sw, sh, x, y, CELL, CELL);
        resolve();
      };
      img.onerror = resolve;
      img.src = dataUrl;
    });

    // Separator lines
    ctx.strokeStyle = "#14171A"; ctx.lineWidth = 3;
    ctx.strokeRect(x, y, CELL, CELL);

    // Bottom label bar
    ctx.fillStyle = "rgba(0,0,0,0.68)";
    ctx.fillRect(x, y + CELL - 28, CELL, 28);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px monospace"; ctx.textAlign = "left";
    ctx.fillText(unitId, x + 7, y + CELL - 10);

    // Result badge
    ctx.fillStyle = result === "ok" ? "#2BAE66" : "#E63946";
    ctx.fillRect(x + CELL - 58, y + CELL - 28, 58, 28);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px Arial"; ctx.textAlign = "center";
    ctx.fillText(result === "ok" ? "✓ OK" : "⚠ PERLU", x + CELL - 29, y + CELL - 10);
    ctx.textAlign = "left";
  }

  // "+N more" overlay if truncated
  if (photos.length > MAX) {
    const last = used.length - 1;
    const lx = (last % cols) * CELL, ly = HDR + Math.floor(last / cols) * CELL;
    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(lx, ly, CELL, CELL);
    ctx.fillStyle = "#fff"; ctx.font = "bold 36px Arial"; ctx.textAlign = "center";
    ctx.fillText(`+${photos.length - MAX + 1}`, lx + CELL / 2, ly + CELL / 2 + 12);
  }
  return canvas.toDataURL("image/jpeg", 0.88);
}

/* ── WhatsApp report with collage ── */
document.getElementById("whatsappBtn").addEventListener("click", async () => {
  const ins = await dbGetAll("inspections");
  const today = todayISO();
  const todayIns = ins.filter(i => i.date && i.date.startsWith(today));
  if (!todayIns.length) { toast("Belum ada inspeksi hari ini"); return; }

  const ok = todayIns.filter(i => i.result === "ok").length;
  const issues = todayIns.filter(i => i.result === "tidak_ok");
  let msg = `*LAPORAN INSPEKSI APAR*\n📅 ${new Date().toLocaleDateString("id-ID",{day:"numeric",month:"long",year:"numeric"})}\n\n`;
  msg += `✅ Total inspeksi: ${todayIns.length} unit\n✓ OK: ${ok} unit\n`;
  if (issues.length) {
    msg += `⚠️ Perlu perhatian: ${issues.length} unit\n\n*Unit bermasalah:*\n`;
    issues.forEach(i => { msg += `• ${i.unitId} (${i.inspectorName})\n`; });
  }
  msg += `\n_Dikirim via APAR Inspector App_`;

  const photos = todayIns.filter(i => i.photo).map(i => ({ unitId: i.unitId, dataUrl: i.photo, result: i.result }));

  if (photos.length === 0) {
    // No photos — text only
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`);
    return;
  }

  toast("Membuat kolase foto...");
  const collageDataUrl = await createCollage(photos, todayIns);
  const blob = await (await fetch(collageDataUrl)).blob();
  const file = new File([blob], `apar-${today}.jpg`, { type: "image/jpeg" });

  // Try native share (Android/iOS native share sheet → direct to WhatsApp)
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: msg, title: "Laporan APAR" });
      return;
    } catch (e) { /* user cancelled or not supported, fall through */ }
  }

  // Fallback: download collage + open WhatsApp text separately
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `apar-${today}.jpg`; a.click();
  URL.revokeObjectURL(url);
  toast("Foto tersimpan — lampirkan ke WhatsApp");
  setTimeout(() => window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`), 800);
});
document.getElementById("modeCepatBtn").addEventListener("click", () => showTab("cepat"));
document.querySelectorAll(".nav-btn").forEach(b => b.addEventListener("click", () => showTab(b.dataset.nav)));


/* ───────────── Google Sheet → local cache ─────────────
   The dashboard used to read only IndexedDB, so a fresh phone/browser showed 0
   even when Google Sheets already contained inspections. The existing Apps
   Script doGet supports JSONP; use the same endpoint here so no backend/CORS
   change is required. Unsynced local records are never deleted. */
function remoteKey(prefix, parts) {
  const raw = parts.map(v => String(v ?? "")).join("|");
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${prefix}_remote_${(h >>> 0).toString(16)}`;
}

function loadSheetData() {
  return new Promise((resolve, reject) => {
    if (!navigator.onLine) return resolve(null);
    if (SHEET_SYNC_URL.includes("REPLACE_WITH_YOUR_DEPLOYMENT_ID")) return resolve(null);

    const cb = `__spartaPwaCb_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    let finished = false;
    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      try { delete window[cb]; } catch (_) { window[cb] = undefined; }
    };
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error("Timeout saat membaca Google Sheet"));
    }, 15000);

    window[cb] = data => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      resolve(data || {});
    };
    script.onerror = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error("Gagal membaca Google Sheet"));
    };
    script.src = `${SHEET_SYNC_URL}${SHEET_SYNC_URL.includes("?") ? "&" : "?"}action=getAllData&callback=${encodeURIComponent(cb)}&_=${Date.now()}`;
    document.head.appendChild(script);
  });
}

async function cacheSheetData(data) {
  if (!data) return;

  // Units are keyed by their actual APAR/unit ID.
  for (const u of (data.units || [])) {
    if (!u || !u.id) continue;
    const existing = await dbGet("units", String(u.id));
    await dbPut("units", {
      ...(existing || {}),
      id: String(u.id),
      location: u.location || existing?.location || "",
      type: u.type || existing?.type || "",
      intervalMonths: Number(u.intervalMonths || existing?.intervalMonths || 6),
      lastInspection: u.lastInspection || existing?.lastInspection || "",
      nextDue: u.nextDue || existing?.nextDue || "",
      lastFlag: u.lastFlag || existing?.lastFlag || "",
      synced: true,
      source: "sheet"
    });
  }

  // Prefer the exact backend shape because it carries inspection_id.
  // The PWA sends its local UUID as inspection_id; when the same record comes
  // back from Apps Script we update that same IndexedDB row instead of creating
  // a duplicate with a timestamp-derived key.
  const remoteInspections = Array.isArray(data.inspectionLogs) && data.inspectionLogs.length
    ? data.inspectionLogs
    : (data.inspections || []);

  for (const r of remoteInspections) {
    if (!r) continue;
    const exactShape = Object.prototype.hasOwnProperty.call(r, "inspection_id") ||
      Object.prototype.hasOwnProperty.call(r, "apar_code");
    const remoteId = exactShape && r.inspection_id
      ? String(r.inspection_id)
      : remoteKey("insp", [r.date, r.unitId, r.inspector]);
    const existing = await dbGet("inspections", remoteId);
    const normalized = exactShape ? {
      ...(existing || {}),
      id: remoteId,
      date: r.timestamp || r.inspection_date || existing?.date || "",
      inspectionDate: r.inspection_date || "",
      unitId: String(r.apar_code || r.generated_code || existing?.unitId || ""),
      unitLocation: r.lokasi_detail || existing?.unitLocation || "",
      unitType: r.kapasitas || existing?.unitType || "",
      inspectorName: r.inspector || existing?.inspectorName || "",
      aparAvailable: r.apar_available || existing?.aparAvailable || "ya",
      checklist: {
        handle: r.handle || "", hose: r.hose || "", isi_tabung: r.isi_tabung || "",
        lokasi_ap: r.lokasi_ap || "", nozzle: r.nozzle || "", pin_lock: r.pin_lock || "",
        pressure: r.pressure || "", tabung: r.tabung || "", kip: r.kip || "", rambu: r.rambu || ""
      },
      result: r.result || "",
      notes: r.notes || "",
      gpsLat: r.gps_lat ?? existing?.gpsLat ?? null,
      gpsLng: r.gps_lng ?? existing?.gpsLng ?? null,
      // Preserve locally captured media. The current Apps Script stores URL
      // fields only and does not upload base64 media to Drive.
      photo: existing?.photo || null,
      signature: existing?.signature || null,
      hasPhoto: Boolean(r.photo_url || existing?.photo),
      hasSignature: Boolean(r.signature_url || existing?.signature),
      synced: true,
      source: "sheet"
    } : {
      ...(existing || {}),
      id: remoteId,
      date: r.date || existing?.date || "",
      unitId: String(r.unitId || existing?.unitId || ""),
      unitLocation: r.location || existing?.unitLocation || "",
      inspectorName: r.inspector || existing?.inspectorName || "",
      aparAvailable: r.aparAvailable || existing?.aparAvailable || "ya",
      checklist: {
        handle: r.handle || "", hose: r.hose || "", isi_tabung: r.isi_tabung || "",
        lokasi_ap: r.lokasi_ap || "", nozzle: r.nozzle || "", pin_lock: r.pin_lock || "",
        pressure: r.pressure || "", tabung: r.tabung || "", kip: r.kip || "", rambu: r.rambu || ""
      },
      result: r.result || "", notes: r.notes || "",
      gpsLat: r.gpsLat ?? existing?.gpsLat ?? null,
      gpsLng: r.gpsLng ?? existing?.gpsLng ?? null,
      photo: existing?.photo || null,
      signature: existing?.signature || null,
      hasPhoto: Boolean(existing?.photo || r.hasPhoto === true || String(r.hasPhoto || "").toLowerCase() === "ya"),
      hasSignature: Boolean(existing?.signature || r.hasSignature === true || String(r.hasSignature || "").toLowerCase() === "ya"),
      synced: true,
      source: "sheet"
    };
    if (normalized.unitId || normalized.date) await dbPut("inspections", normalized);
  }

  const localIn = await dbGetAll("stock_in");
  const fpIn = r => [r.date, r.jenis, r.jumlah, r.keterangan, r.lokasiStock].map(v => String(v ?? "")).join("|");
  const localInFp = new Set(localIn.map(fpIn));
  for (const r of (data.stockIn || [])) {
    if (!r) continue;
    const rec = {
      id: remoteKey("stockin", [r.date, r.jenis, r.jumlah, r.keterangan, r.lokasiStock, r.catatan]),
      date: r.date || "", jenis: r.jenis || "", jumlah: Number(r.jumlah || 0),
      keterangan: r.keterangan || "", lokasiStock: r.lokasiStock || "", catatan: r.catatan || "",
      synced: true, source: "sheet"
    };
    if (!localInFp.has(fpIn(rec))) await dbPut("stock_in", rec);
  }

  const localOut = await dbGetAll("stock_out");
  const fpOut = r => [r.date, r.noUnit, r.namaPemohon, r.jenis, r.areaOp].map(v => String(v ?? "")).join("|");
  const localOutFp = new Set(localOut.map(fpOut));
  for (const r of (data.stockOut || [])) {
    if (!r) continue;
    const rec = {
      id: remoteKey("stockout", [r.date, r.areaOp, r.namaPemohon, r.departemen, r.perusahaan, r.jenis, r.noUnit]),
      date: r.date || "", areaOp: r.areaOp || "", namaPemohon: r.namaPemohon || "",
      departemen: r.departemen || "", perusahaan: r.perusahaan || "", jenis: r.jenis || "",
      tipeUnit: r.tipeUnit || "", noUnit: r.noUnit || "", status: r.status || "",
      penyebab: r.penyebab || "", catatan: r.catatan || "", synced: true, source: "sheet"
    };
    if (!localOutFp.has(fpOut(rec))) await dbPut("stock_out", rec);
  }
}

async function pullFromSheet({ quiet = false } = {}) {
  if (!navigator.onLine) return false;
  try {
    const data = await loadSheetData();
    if (!data) return false;
    await cacheSheetData(data);
    await renderDashboard();
    if (activeTab === "stok") await renderStokSummary();
    if (!quiet) toast("Data Google Sheet diperbarui");
    return true;
  } catch (err) {
    console.error("Google Sheet pull failed", err);
    if (!quiet) toast("Data Sheet belum dapat dimuat");
    return false;
  }
}

/* ───────────── Dashboard ───────────── */
async function renderDashboard() {
  const [ins, sIn, sOut] = await Promise.all([dbGetAll("inspections"), dbGetAll("stock_in"), dbGetAll("stock_out")]);
  const today = todayISO();

  // Stock sisa
  const in6 = sIn.filter(r => r.jenis === "APAR 6KG").reduce((a, r) => a + (parseInt(r.jumlah) || 0), 0);
  const in3 = sIn.filter(r => r.jenis === "APAR 3KG").reduce((a, r) => a + (parseInt(r.jumlah) || 0), 0);
  const out6 = sOut.filter(r => r.jenis === "APAR 6KG").length;
  const out3 = sOut.filter(r => r.jenis === "APAR 3KG").length;
  document.getElementById("dash6kg").textContent = Math.max(0, in6 - out6);
  document.getElementById("dash3kg").textContent = Math.max(0, in3 - out3);

  const todayIns = ins.filter(i => i.date && i.date.startsWith(today));
  document.getElementById("dashToday").textContent = todayIns.length;
  document.getElementById("dashIssues").textContent = ins.filter(i => i.result === "tidak_ok").length;

  const recent = [...ins].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 15);
  const list = document.getElementById("recentList");
  list.innerHTML = recent.length ? recent.map(i => `
    <div class="item-card ${i.result || "ok"}">
      <div class="row">
        <div class="title mono">${escapeHtml(i.unitId)}</div>
        <div class="badge ${i.result || "ok"}">${i.result === "tidak_ok" ? "Perlu Perhatian" : "OK"}</div>
      </div>
      <div class="sub">${escapeHtml(i.inspectorName)} &mdash; ${fmtDT(i.date)}</div>
    </div>`).join("") : `<div class="empty-state">Belum ada inspeksi tersimpan</div>`;
}

/* ───────────── Scanner ───────────── */
const scanCanvas = document.createElement("canvas");
async function startScanner() {
  scanActive = true;
  document.getElementById("scanHint").textContent = "Arahkan kamera ke QR code pada tag APAR";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    scanStream = stream;
    const video = document.getElementById("scanVideo");
    video.srcObject = stream;
    await video.play();
    scanLoop();
  } catch (err) {
    document.getElementById("scanHint").textContent = "Kamera tidak tersedia: " + err.message;
  }
}
function stopScanner() {
  scanActive = false;
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
}
function scanLoop() {
  if (!scanActive) return;
  const video = document.getElementById("scanVideo");
  if (video.readyState === video.HAVE_ENOUGH_DATA) {
    scanCanvas.width = video.videoWidth; scanCanvas.height = video.videoHeight;
    const ctx = scanCanvas.getContext("2d");
    ctx.drawImage(video, 0, 0, scanCanvas.width, scanCanvas.height);
    const img = ctx.getImageData(0, 0, scanCanvas.width, scanCanvas.height);
    const code = window.jsQR && jsQR(img.data, img.width, img.height);
    if (code && code.data) { stopScanner(); handleScannedCode(code.data.trim()); return; }
  }
  requestAnimationFrame(scanLoop);
}
document.getElementById("manualEntryBtn").addEventListener("click", () => {
  const code = prompt("Masukkan kode APAR:");
  if (code && code.trim()) { stopScanner(); handleScannedCode(code.trim()); }
});
async function handleScannedCode(code) {
  await loadUnitForInspection(code);
  showTab("inspeksi");
  showStep(0);
}

/* ───────────── Inspection Wizard ───────────── */
function showStep(n) {
  inspStep = n;
  document.querySelectorAll(".step-pane").forEach(p => p.classList.toggle("active", parseInt(p.dataset.pane) === n));
  document.querySelectorAll(".step-node").forEach(node => {
    const s = parseInt(node.dataset.step);
    node.classList.toggle("active", s === n);
    node.classList.toggle("done", s < n);
    const circle = node.querySelector(".step-circle");
    if (s < n) circle.textContent = "✓";
    else circle.textContent = s + 1;
  });
}

async function loadUnitForInspection(code) {
  document.getElementById("unitIdInput").value = code;
  document.getElementById("inspDateInput").value = todayISO();
  // Remember inspector name
  const savedName = localStorage.getItem("aparInspectorName");
  if (savedName && !document.getElementById("inspNameInput").value) {
    document.getElementById("inspNameInput").value = savedName;
  }
  inspState.unitId = code;
  inspState.unitIsNew = false;

  const unit = await dbGet("units", code);
  const infoCard = document.getElementById("unitInfoCard");
  const newFields = document.getElementById("newUnitFields");

  if (unit) {
    infoCard.style.display = "block";
    infoCard.innerHTML = `<div class="unit-name mono">${escapeHtml(unit.id)}</div><div class="unit-meta">${escapeHtml(unit.location)} &mdash; ${escapeHtml(unit.type)}</div>`;
    newFields.style.display = "none";
  } else {
    infoCard.style.display = "none";
    newFields.style.display = "flex";
    newFields.style.flexDirection = "column";
    inspState.unitIsNew = true;
  }
}

// Scan button in step 0 → go to scan tab then come back
document.getElementById("scanUnitBtn").addEventListener("click", () => showTab("scan"));

document.getElementById("unitIdInput").addEventListener("change", async (e) => {
  const code = e.target.value.trim();
  if (code) await loadUnitForInspection(code);
});

// Step 0 → 1
document.getElementById("step0Next").addEventListener("click", async () => {
  const unitId = document.getElementById("unitIdInput").value.trim();
  const name = document.getElementById("inspNameInput").value.trim();
  if (!unitId) { toast("Masukkan kode APAR terlebih dahulu"); return; }
  if (!name) { toast("Masukkan nama inspektor"); return; }

  if (inspState.unitIsNew) {
    const loc = document.getElementById("newUnitLoc").value.trim();
    if (!loc) { toast("Masukkan lokasi APAR"); return; }
    const unit = { id: unitId, location: loc, type: document.getElementById("newUnitType").value, intervalMonths: parseInt(document.getElementById("newUnitInterval").value)||6, lastInspection: null, nextDue: new Date().toISOString(), lastFlag: null };
    await dbPut("units", unit);
    inspState.unitIsNew = false;
  }
  inspState.unitId = unitId;
  inspState.aparAvailable = null;
  inspState.checklist = {};
  renderChecklist();
  showStep(1);
});

// Checklist
function renderChecklist() {
  const container = document.getElementById("checklist");
  container.innerHTML = `
    <div class="check-item availability-item" data-key="apar_available">
      <div class="q">Apakah APAR tersedia di lokasi/unit?</div>
      <div class="yn-opts">
        <button class="yn-btn ya" data-val="ya">&#10003; Ya</button>
        <button class="yn-btn tidak" data-val="tidak">&#10007; Tidak</button>
      </div>
    </div>
    <div id="detailedChecklist" style="display:none">
      ${CHECKLIST_ITEMS.map(item => `
        <div class="check-item" data-key="${item.key}">
          <div class="q">${escapeHtml(item.q)}</div>
          <div class="yn-opts">
            <button class="yn-btn ya" data-val="ya">&#10003; Ya</button>
            <button class="yn-btn tidak" data-val="tidak">&#10007; Tidak</button>
          </div>
        </div>`).join("")}
    </div>`;

  const availabilityCard = container.querySelector('[data-key="apar_available"]');
  availabilityCard.querySelectorAll(".yn-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      availabilityCard.querySelectorAll(".yn-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      inspState.aparAvailable = btn.dataset.val;

      const details = document.getElementById("detailedChecklist");
      if (inspState.aparAvailable === "ya") {
        details.style.display = "block";
      } else {
        // APAR tidak ada: checklist kondisi tidak relevan dan tidak dianggap gagal.
        inspState.checklist = {};
        details.style.display = "none";
        details.querySelectorAll(".yn-btn").forEach(b => b.classList.remove("active"));
      }
      updateChecklistProgress();
    });
  });

  container.querySelectorAll('#detailedChecklist .check-item').forEach(card => {
    card.querySelectorAll(".yn-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        card.querySelectorAll(".yn-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        inspState.checklist[card.dataset.key] = btn.dataset.val;
        updateChecklistProgress();
      });
    });
  });

  updateChecklistProgress();
}
function updateChecklistProgress() {
  const nextBtn = document.getElementById("step1Next");
  if (!inspState.aparAvailable) {
    document.getElementById("checklistProgress").textContent = "Jawab ketersediaan APAR terlebih dahulu";
    document.getElementById("checklistBar").style.width = "0%";
    nextBtn.disabled = true;
    return;
  }

  if (inspState.aparAvailable === "tidak") {
    document.getElementById("checklistProgress").textContent = "APAR tidak tersedia — checklist kondisi dilewati";
    document.getElementById("checklistBar").style.width = "100%";
    nextBtn.disabled = false;
    return;
  }

  const answered = Object.keys(inspState.checklist).length;
  const total = CHECKLIST_ITEMS.length;
  document.getElementById("checklistProgress").textContent = `${answered} dari ${total} dijawab`;
  document.getElementById("checklistBar").style.width = `${(answered / total) * 100}%`;
  nextBtn.disabled = answered < total;
}

document.getElementById("step1Back").addEventListener("click", () => showStep(0));
document.getElementById("step1Next").addEventListener("click", () => { initSignaturePad(); showStep(2); });

// Step 2: Photo
document.getElementById("photoBox").addEventListener("click", () => document.getElementById("photoInput").click());
document.getElementById("photoInput").addEventListener("change", (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    downscale(reader.result, 800, (url) => {
      inspState.photo = url;
      const box = document.getElementById("photoBox");
      box.classList.add("filled");
      document.getElementById("photoPrompt").textContent = "Foto tersimpan · tap untuk ganti";
      let img = box.querySelector("img"); if (!img) { img = document.createElement("img"); box.appendChild(img); }
      img.src = url;
    });
  };
  reader.readAsDataURL(file);
});
function downscale(dataUrl, max, cb) {
  const img = new Image();
  img.onload = () => {
    let {width, height} = img;
    if (width > height && width > max) { height *= max/width; width = max; } else if (height > max) { width *= max/height; height = max; }
    const c = document.createElement("canvas"); c.width = width; c.height = height;
    c.getContext("2d").drawImage(img, 0, 0, width, height);
    cb(c.toDataURL("image/jpeg", 0.72));
  };
  img.src = dataUrl;
}

// Step 2: GPS
document.getElementById("gpsBtn").addEventListener("click", () => {
  if (!navigator.geolocation) { toast("GPS tidak didukung perangkat ini"); return; }
  document.getElementById("gpsReadout").textContent = "Mengambil lokasi...";
  navigator.geolocation.getCurrentPosition(pos => {
    inspState.gps = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    document.getElementById("gpsReadout").textContent = `${inspState.gps.lat.toFixed(5)}, ${inspState.gps.lng.toFixed(5)} (±${Math.round(inspState.gps.acc)}m)`;
  }, err => { document.getElementById("gpsReadout").textContent = "Gagal: " + err.message; }, { enableHighAccuracy: true, timeout: 10000 });
});

// Step 2: Signature
let sigCtx, sigDrawing = false;
function initSignaturePad() {
  const canvas = document.getElementById("sigPad");
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
  sigCtx = canvas.getContext("2d");
  sigCtx.scale(ratio, ratio);
  sigCtx.lineWidth = 2; sigCtx.lineCap = "round"; sigCtx.strokeStyle = "#14171A";
  inspState.sigHasContent = false;
  const pos = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.onpointerdown = (e) => { sigDrawing = true; const p = pos(e); sigCtx.beginPath(); sigCtx.moveTo(p.x, p.y); e.preventDefault(); };
  canvas.onpointermove = (e) => { if (!sigDrawing) return; const p = pos(e); sigCtx.lineTo(p.x, p.y); sigCtx.stroke(); inspState.sigHasContent = true; e.preventDefault(); };
  canvas.onpointerup = () => sigDrawing = false;
  canvas.onpointerleave = () => sigDrawing = false;
}
document.getElementById("clearSigBtn").addEventListener("click", initSignaturePad);

document.getElementById("step2Back").addEventListener("click", () => showStep(1));
document.getElementById("step2Next").addEventListener("click", () => {
  if (inspState.aparAvailable === "tidak" && !inspState.photo) {
    toast("Foto evidence wajib untuk APAR yang tidak tersedia");
    return;
  }
  renderPreview();
  showStep(3);
});

// Step 3: Preview
function renderPreview() {
  const unavailable = inspState.aparAvailable === "tidak";
  const allYa = !unavailable && CHECKLIST_ITEMS.every(item => inspState.checklist[item.key] === "ya");
  const result = unavailable ? "apar_tidak_tersedia" : (allYa ? "ok" : "tidak_ok");
  const resultLabel = unavailable ? "&#9888; APAR TIDAK TERSEDIA" : (allYa ? "&#10003; SEMUA OK" : "&#10007; PERLU PERHATIAN");

  const rows = unavailable
    ? `<div class="preview-row"><span class="key">Ketersediaan APAR</span><span class="val tidak">Tidak tersedia</span></div>`
    : `<div class="preview-row"><span class="key">Ketersediaan APAR</span><span class="val ya">Tersedia</span></div>` + CHECKLIST_ITEMS.map(item => {
        const val = inspState.checklist[item.key];
        const cls = val === "ya" ? "ya" : "tidak";
        const lbl = val === "ya" ? "Ya" : "Tidak";
        return `<div class="preview-row"><span class="key">${escapeHtml(item.q)}</span><span class="val ${cls}">${lbl}</span></div>`;
      }).join("");

  document.getElementById("previewCard").innerHTML = `
    <div class="preview-card">
      <div class="preview-result ${result}">${resultLabel}</div>
      <div>
        <div class="preview-section">Unit</div>
        <div class="preview-row"><span class="key">Kode</span><span class="val mono">${escapeHtml(inspState.unitId)}</span></div>
        <div class="preview-row"><span class="key">Inspektor</span><span class="val">${escapeHtml(document.getElementById("inspNameInput").value)}</span></div>
        <div class="preview-row"><span class="key">Tanggal</span><span class="val">${fmtDate(document.getElementById("inspDateInput").value)}</span></div>
      </div>
      <div>
        <div class="preview-section">Hasil Inspeksi</div>
        ${rows}
      </div>
      ${unavailable ? `<div class="preview-row"><span class="key">Evidence foto</span><span class="val ya">Tersimpan</span></div>` : ""}
      ${inspState.gps ? `<div class="preview-row"><span class="key">GPS</span><span class="val mono" style="font-size:11px">${inspState.gps.lat.toFixed(4)}, ${inspState.gps.lng.toFixed(4)}</span></div>` : ""}
    </div>`;
}


document.getElementById("step3Back").addEventListener("click", () => showStep(2));
document.getElementById("submitBtn").addEventListener("click", async () => {
  const unavailable = inspState.aparAvailable === "tidak";
  const tidak = unavailable ? [] : CHECKLIST_ITEMS.filter(item => inspState.checklist[item.key] === "tidak");
  const inspName = document.getElementById("inspNameInput").value.trim();

  // Build modal body
  let body = `<b>${inspState.unitId}</b> — Inspektor: ${inspName}<br><br>`;
  if (unavailable) {
    body += `<b style="color:var(--red)">⚠️ APAR TIDAK TERSEDIA DI LOKASI/UNIT</b><br>Foto evidence akan disimpan pada perangkat.<br><br>`;
  } else if (tidak.length) {
    body += `<b style="color:var(--red)">⚠️ ${tidak.length} item TIDAK OK:</b><br>`;
    tidak.forEach(i => { body += `<div class="issue">• ${i.q}</div>`; });
    body += "<br>";
  } else {
    body += `<span style="color:var(--green)">✓ Semua item OK</span><br><br>`;
  }
  body += "Simpan inspeksi ini?";

  showModal("Konfirmasi Inspeksi", body, async () => {
    // Save inspector name for next time
    localStorage.setItem("aparInspectorName", inspName);

    const allYa = !unavailable && CHECKLIST_ITEMS.every(item => inspState.checklist[item.key] === "ya");
    const result = unavailable ? "apar_tidak_tersedia" : (allYa ? "ok" : "tidak_ok");
    const inspection = {
      id: uid("insp"), unitId: inspState.unitId,
      inspectorName: inspName,
      date: new Date().toISOString(),
      aparAvailable: inspState.aparAvailable,
      checklist: inspState.checklist, result,
      photo: inspState.photo,
      signature: inspState.sigHasContent ? document.getElementById("sigPad").toDataURL("image/png") : null,
      gps: inspState.gps,
      notes: document.getElementById("notesInput").value.trim(),
      synced: false,
    };
    await dbPut("inspections", inspection);
    const unit = await dbGet("units", inspState.unitId);
    if (unit) {
      const nextDue = new Date(); nextDue.setMonth(nextDue.getMonth() + (unit.intervalMonths || 6));
      await dbPut("units", { ...unit, lastInspection: inspection.date, nextDue: nextDue.toISOString(), lastFlag: result });
    }
    // Clear progress
    localStorage.removeItem("aparInspProgress");
    inspState = { unitId: null, unitIsNew: false, aparAvailable: null, checklist: {}, photo: null, gps: null, sigHasContent: false };
    document.getElementById("unitIdInput").value = "";
    document.getElementById("photoBox").classList.remove("filled");
    document.getElementById("photoBox").querySelector("img")?.remove();
    document.getElementById("photoPrompt").textContent = "Tap untuk ambil foto";
    document.getElementById("gpsReadout").textContent = "Belum diambil";
    document.getElementById("notesInput").value = "";
    document.getElementById("unitInfoCard").style.display = "none";
    document.getElementById("newUnitFields").style.display = "none";
    toast("Inspeksi tersimpan" + (navigator.onLine ? " · sinkronisasi..." : " · akan sinkron saat online"));
    showTab("dashboard");
    if (navigator.onLine) trySync();
  });
});

/* ───────────── Stok ───────────── */
async function renderStokSummary() {
  const [sIn, sOut] = await Promise.all([dbGetAll("stock_in"), dbGetAll("stock_out")]);
  const in6 = sIn.filter(r => r.jenis === "APAR 6KG").reduce((a, r) => a + (parseInt(r.jumlah) || 0), 0);
  const in3 = sIn.filter(r => r.jenis === "APAR 3KG").reduce((a, r) => a + (parseInt(r.jumlah) || 0), 0);
  const out6 = sOut.filter(r => r.jenis === "APAR 6KG").length;
  const out3 = sOut.filter(r => r.jenis === "APAR 3KG").length;
  document.getElementById("stok6kg").textContent = Math.max(0, in6 - out6);
  document.getElementById("stok3kg").textContent = Math.max(0, in3 - out3);
}

// Sub-tab switching
document.querySelectorAll("#stokTabs .sub-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#stokTabs .sub-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeStokTab = btn.dataset.stok;
    document.querySelectorAll(".stok-pane").forEach(p => p.classList.toggle("active", p.dataset.stokPane === activeStokTab));
    if (activeStokTab === "riwayat") renderRiwayat();
  });
});
document.querySelectorAll("#riwayatTabs .sub-tab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#riwayatTabs .sub-tab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeRiwayatTab = btn.dataset.riwayat;
    renderRiwayat();
  });
});

// Show/hide penyebab field
document.getElementById("keluarStatus").addEventListener("change", (e) => {
  document.getElementById("penyebabField").style.display = e.target.value === "Kerusakan" ? "flex" : "none";
});

// QR scan for Stok Keluar No. Unit — reuses bulk-style inline scanner via prompt fallback + camera
let keluarScanStream = null, keluarScanning = false;
const keluarScanCanvas = document.createElement("canvas");
document.getElementById("keluarScanBtn").addEventListener("click", () => {
  // Build a lightweight fullscreen scanner overlay on demand
  let overlay = document.getElementById("keluarScanOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "keluarScanOverlay";
    overlay.className = "scan-overlay";
    overlay.innerHTML = `
      <div class="scan-overlay-inner">
        <div class="scan-overlay-head">
          <span>Scan QR No. Unit</span>
          <button class="btn btn-ghost" id="keluarScanClose">Tutup</button>
        </div>
        <div class="scan-frame"><video id="keluarVideo" playsinline muted></video><div class="reticle"></div></div>
        <p class="scan-hint">Arahkan kamera ke QR code unit</p>
        <button class="btn btn-secondary btn-block" id="keluarScanManual">Masukkan manual</button>
      </div>`;
    document.getElementById("app").appendChild(overlay);
    document.getElementById("keluarScanClose").addEventListener("click", closeKeluarScan);
    document.getElementById("keluarScanManual").addEventListener("click", () => {
      const code = prompt("Masukkan No. Unit:");
      if (code && code.trim()) { document.getElementById("keluarNoUnit").value = code.trim(); }
      closeKeluarScan();
    });
  }
  overlay.style.display = "flex";
  startKeluarScan();
});
function startKeluarScan() {
  keluarScanning = true;
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    .then(stream => {
      keluarScanStream = stream;
      const v = document.getElementById("keluarVideo");
      v.srcObject = stream; v.play();
      keluarScanLoop();
    })
    .catch(err => toast("Kamera tidak tersedia: " + err.message));
}
function closeKeluarScan() {
  keluarScanning = false;
  if (keluarScanStream) { keluarScanStream.getTracks().forEach(t => t.stop()); keluarScanStream = null; }
  const o = document.getElementById("keluarScanOverlay");
  if (o) o.style.display = "none";
}
function keluarScanLoop() {
  if (!keluarScanning) return;
  const v = document.getElementById("keluarVideo");
  if (v && v.readyState === v.HAVE_ENOUGH_DATA) {
    keluarScanCanvas.width = v.videoWidth; keluarScanCanvas.height = v.videoHeight;
    const ctx = keluarScanCanvas.getContext("2d");
    ctx.drawImage(v, 0, 0);
    const img = ctx.getImageData(0, 0, keluarScanCanvas.width, keluarScanCanvas.height);
    const code = window.jsQR && jsQR(img.data, img.width, img.height);
    if (code && code.data) {
      document.getElementById("keluarNoUnit").value = code.data.trim();
      toast("Unit: " + code.data.trim());
      closeKeluarScan();
      return;
    }
  }
  requestAnimationFrame(keluarScanLoop);
}

// Set today as default dates
function setDefaultDates() {
  const t = todayISO();
  ["masukDate", "keluarDate"].forEach(id => { const el = document.getElementById(id); if (el) el.value = t; });
}

// Stok Masuk
document.getElementById("saveMasukBtn").addEventListener("click", async () => {
  const jumlah = parseInt(document.getElementById("masukJumlah").value) || 0;
  const lokasi = document.getElementById("masukLokasi").value.trim();
  if (!lokasi) { toast("Masukkan lokasi stock"); return; }
  if (jumlah < 1) { toast("Jumlah harus minimal 1"); return; }
  const rec = {
    id: uid("masuk"),
    date: document.getElementById("masukDate").value || todayISO(),
    jenis: document.getElementById("masukJenis").value,
    jumlah,
    keterangan: document.getElementById("masukKeterangan").value,
    lokasiStock: lokasi,
    catatan: document.getElementById("masukCatatan").value.trim(),
    synced: false,
  };
  await dbPut("stock_in", rec);
  toast("Stok masuk tersimpan");
  document.getElementById("masukJumlah").value = "1";
  document.getElementById("masukCatatan").value = "";
  renderStokSummary();
  if (navigator.onLine) trySync();
});

// Stok Keluar
document.getElementById("saveKeluarBtn").addEventListener("click", async () => {
  const nama = document.getElementById("keluarNama").value.trim();
  const noUnit = document.getElementById("keluarNoUnit").value.trim();
  if (!nama) { toast("Masukkan nama pemohon"); return; }
  if (!noUnit) { toast("Masukkan no. unit"); return; }
  const rec = {
    id: uid("keluar"),
    date: document.getElementById("keluarDate").value || todayISO(),
    areaOp: document.getElementById("keluarArea").value,
    namaPemohon: nama,
    departemen: document.getElementById("keluarDept").value.trim(),
    perusahaan: document.getElementById("keluarPerus").value.trim(),
    jenis: document.getElementById("keluarJenis").value,
    tipeUnit: document.getElementById("keluarTipeUnit").value,
    noUnit,
    status: document.getElementById("keluarStatus").value,
    penyebab: document.getElementById("keluarPenyebab").value.trim(),
    catatan: document.getElementById("keluarCatatan").value.trim(),
    synced: false,
  };
  await dbPut("stock_out", rec);
  toast("Stok keluar tersimpan");
  document.getElementById("keluarNama").value = "";
  document.getElementById("keluarNoUnit").value = "";
  document.getElementById("keluarDept").value = "";
  document.getElementById("keluarPerus").value = "";
  document.getElementById("keluarPenyebab").value = "";
  document.getElementById("keluarCatatan").value = "";
  document.getElementById("penyebabField").style.display = "none";
  document.getElementById("keluarStatus").value = "Baru";
  renderStokSummary();
  if (navigator.onLine) trySync();
});

// Riwayat
async function renderRiwayat() {
  const list = document.getElementById("riwayatList");
  if (activeRiwayatTab === "masuk") {
    const recs = (await dbGetAll("stock_in")).sort((a,b) => new Date(b.date)-new Date(a.date));
    list.innerHTML = recs.length ? recs.map(r => `
      <div class="item-card masuk">
        <div class="row"><div class="title">${escapeHtml(r.jenis)} &mdash; ${r.jumlah} unit</div><div class="badge masuk">Masuk</div></div>
        <div class="sub">${fmtDate(r.date)} &mdash; ${escapeHtml(r.keterangan)} &mdash; ${escapeHtml(r.lokasiStock)}</div>
      </div>`).join("") : `<div class="empty-state">Belum ada stok masuk</div>`;
  } else {
    const recs = (await dbGetAll("stock_out")).sort((a,b) => new Date(b.date)-new Date(a.date));
    list.innerHTML = recs.length ? recs.map(r => `
      <div class="item-card keluar">
        <div class="row"><div class="title mono">${escapeHtml(r.noUnit)}</div><div class="badge keluar">Keluar</div></div>
        <div class="sub">${fmtDate(r.date)} &mdash; ${escapeHtml(r.jenis)} &mdash; ${escapeHtml(r.namaPemohon)} &mdash; <strong>${escapeHtml(r.status)}</strong>${r.penyebab ? " (" + escapeHtml(r.penyebab) + ")" : ""}</div>
      </div>`).join("") : `<div class="empty-state">Belum ada stok keluar</div>`;
  }
}

/* ───────────── Bulk Mode (Mode Cepat) ───────────── */
let bulkStream = null, bulkScanning = false, bulkChecklist = {}, bulkUnitId = null, bulkCount = 0;
const bulkCanvas = document.createElement("canvas");

function startBulkScanner() {
  bulkScanning = true;
  document.getElementById("bulkForm").style.display = "none";
  document.getElementById("bulkScanFrame").style.display = "block";
  // Pre-fill inspector name from localStorage
  const saved = localStorage.getItem("aparInspectorName");
  if (saved) document.getElementById("bulkInspector").value = saved;
  navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } })
    .then(stream => {
      bulkStream = stream;
      const v = document.getElementById("bulkVideo");
      v.srcObject = stream; v.play();
      bulkScanLoop();
    })
    .catch(err => { document.getElementById("bulkHint").textContent = "Kamera tidak tersedia: " + err.message; });
}
function stopBulkScanner() {
  bulkScanning = false;
  if (bulkStream) { bulkStream.getTracks().forEach(t => t.stop()); bulkStream = null; }
}
function bulkScanLoop() {
  if (!bulkScanning) return;
  const v = document.getElementById("bulkVideo");
  if (v.readyState === v.HAVE_ENOUGH_DATA) {
    bulkCanvas.width = v.videoWidth; bulkCanvas.height = v.videoHeight;
    const ctx = bulkCanvas.getContext("2d"); ctx.drawImage(v, 0, 0);
    const img = ctx.getImageData(0, 0, bulkCanvas.width, bulkCanvas.height);
    const code = window.jsQR && jsQR(img.data, img.width, img.height);
    if (code && code.data) { bulkHandleCode(code.data.trim()); return; }
  }
  requestAnimationFrame(bulkScanLoop);
}
document.getElementById("bulkManualBtn").addEventListener("click", () => {
  const code = prompt("Masukkan kode APAR:");
  if (code && code.trim()) bulkHandleCode(code.trim());
});
async function bulkHandleCode(code) {
  stopBulkScanner();
  bulkUnitId = code; bulkChecklist = {};
  document.getElementById("bulkScanFrame").style.display = "none";
  document.getElementById("bulkManualBtn").style.display = "none";

  const unit = await dbGet("units", code);
  const display = document.getElementById("bulkUnitDisplay");
  display.innerHTML = unit
    ? `<div class="unit-id">${escapeHtml(code)}</div><div class="unit-loc">${escapeHtml(unit.location)}</div>`
    : `<div class="unit-id">${escapeHtml(code)}</div><div class="unit-loc" style="color:var(--amber)">Unit baru — akan didaftarkan</div>`;

  // Render compact checklist
  const container = document.getElementById("bulkChecklist");
  container.innerHTML = CHECKLIST_ITEMS.map(item => `
    <div class="check-item" data-key="${item.key}" style="padding:10px;">
      <div class="q" style="font-size:12.5px;margin-bottom:8px;">${escapeHtml(item.q)}</div>
      <div class="yn-opts">
        <button class="yn-btn ya" data-val="ya">&#10003; Ya</button>
        <button class="yn-btn tidak" data-val="tidak">&#10007; Tidak</button>
      </div>
    </div>`).join("");
  container.querySelectorAll(".check-item").forEach(card => {
    card.querySelectorAll(".yn-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        card.querySelectorAll(".yn-btn").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        bulkChecklist[card.dataset.key] = btn.dataset.val;
        document.getElementById("bulkSubmitBtn").disabled = Object.keys(bulkChecklist).length < CHECKLIST_ITEMS.length;
      });
    });
  });

  const form = document.getElementById("bulkForm");
  form.style.display = "flex"; form.style.flexDirection = "column";
  document.getElementById("bulkSubmitBtn").disabled = true;
}

document.getElementById("bulkSubmitBtn").addEventListener("click", async () => {
  const name = document.getElementById("bulkInspector").value.trim();
  if (!name) { toast("Masukkan nama inspektor"); return; }
  localStorage.setItem("aparInspectorName", name);

  // Register unit if new
  let unit = await dbGet("units", bulkUnitId);
  if (!unit) {
    unit = { id: bulkUnitId, location: "—", type: "APAR", intervalMonths: 6, lastInspection: null, nextDue: new Date().toISOString(), lastFlag: null };
    await dbPut("units", unit);
  }
  const allYa = Object.values(bulkChecklist).every(v => v === "ya");
  const result = allYa ? "ok" : "tidak_ok";
  const insp = { id: uid("insp"), unitId: bulkUnitId, inspectorName: name, date: new Date().toISOString(), checklist: bulkChecklist, result, photo: null, signature: null, gps: null, notes: "", synced: false };
  await dbPut("inspections", insp);
  const nextDue = new Date(); nextDue.setMonth(nextDue.getMonth() + (unit.intervalMonths || 6));
  await dbPut("units", { ...unit, lastInspection: insp.date, nextDue: nextDue.toISOString(), lastFlag: result });

  bulkCount++;
  document.getElementById("bulkCounter").textContent = `${bulkCount} unit diinspeksi hari ini`;
  toast(result === "ok" ? "✓ OK — scan berikutnya" : "⚠️ Perlu perhatian — scan berikutnya");

  // Reset for next scan
  document.getElementById("bulkManualBtn").style.display = "block";
  document.getElementById("bulkUnitDisplay").innerHTML = `<div class="subtle" style="text-align:center">Scan tag APAR berikutnya</div>`;
  startBulkScanner();
  if (navigator.onLine) trySync();
});
document.getElementById("bulkStopBtn").addEventListener("click", () => {
  stopBulkScanner(); bulkCount = 0;
  document.getElementById("bulkCounter").textContent = "0 unit diinspeksi hari ini";
  showTab("dashboard");
});

/* ───────────── Online / Sync ───────────── */
function updateStatusPill() {
  const pill = document.getElementById("statusPill");
  const text = document.getElementById("statusText");
  if (navigator.onLine) { pill.className = "status-pill online"; text.textContent = "Online"; }
  else { pill.className = "status-pill offline"; text.textContent = "Offline"; }
}
window.addEventListener("online", async () => { updateStatusPill(); await trySync(); await pullFromSheet({ quiet: true }); });
window.addEventListener("offline", updateStatusPill);

async function trySync() {
  if (!navigator.onLine || SHEET_SYNC_URL.includes("REPLACE_WITH_YOUR_DEPLOYMENT_ID")) return;
  const pill = document.getElementById("statusPill");
  const text = document.getElementById("statusText");
  pill.className = "status-pill syncing"; text.textContent = "Sinkronisasi...";

  let ok = 0;
  const allPending = [
    ...(await dbGetAll("inspections")).filter(r => !r.synced).map(r => ({ store: "inspections", rec: r })),
    ...(await dbGetAll("stock_in")).filter(r => !r.synced).map(r => ({ store: "stock_in", rec: r })),
    ...(await dbGetAll("stock_out")).filter(r => !r.synced).map(r => ({ store: "stock_out", rec: r })),
  ];

  for (const { store, rec } of allPending) {
    try {
      let payload;
      if (store === "inspections") {
        const unit = await dbGet("units", rec.unitId);
        const c = rec.checklist || {};
        payload = {
          action: "inspection",
          type: "inspection",
          inspection_id: rec.id,
          inspection_date: rec.date || todayISO(),
          timestamp: rec.date || new Date().toISOString(),
          apar_code: rec.unitId || "",
          unitId: rec.unitId || "",
          location: rec.unitLocation || unit?.location || "",
          lokasi_detail: rec.unitLocation || unit?.location || "",
          kapasitas: rec.unitType || unit?.type || "",
          type: rec.unitType || unit?.type || "",
          inspector: rec.inspectorName || "",
          inspectorName: rec.inspectorName || "",
          apar_available: rec.aparAvailable || "ya",
          handle: c.handle || "",
          hose: c.hose || "",
          isi_tabung: c.isi_tabung || "",
          lokasi_ap: c.lokasi_ap || "",
          nozzle: c.nozzle || "",
          pin_lock: c.pin_lock || "",
          pressure: c.pressure || "",
          tabung: c.tabung || "",
          kip: c.kip || "",
          rambu: c.rambu || "",
          notes: rec.notes || "",
          gps_lat: rec.gpsLat ?? rec.gps?.lat ?? "",
          gps_lng: rec.gpsLng ?? rec.gps?.lng ?? "",
          // Apps Script currently expects URL values here. Raw data URLs are
          // deliberately not sent because they can exceed a Sheet cell limit.
          photo_url: "",
          signature_url: "",
          sync_source: "github_pwa"
        };
      } else if (store === "stock_in") {
        payload = { action: "stock_in", type: "stock_in", ...rec };
      } else {
        payload = {
          action: "stock_out", type: "stock_out", ...rec,
          jenisKerusakan: rec.jenisKerusakan || "",
          penyebab: rec.penyebab || ""
        };
      }

      await fetch(SHEET_SYNC_URL, {
        method: "POST",
        mode: "no-cors",
        cache: "no-store",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });

      // A no-cors POST is opaque, so success cannot be inferred from fetch().
      // Verify against getAllData before marking the local record as synced.
      await new Promise(resolve => setTimeout(resolve, 500));
      const server = await loadSheetData();
      let confirmed = false;
      if (store === "inspections") {
        confirmed = (server?.inspectionLogs || []).some(r => String(r.inspection_id || "") === String(rec.id));
      } else if (store === "stock_in") {
        confirmed = (server?.stockIn || []).some(r =>
          String(r.date || "") === String(rec.date || "") &&
          String(r.jenis || "") === String(rec.jenis || "") &&
          Number(r.jumlah || 0) === Number(rec.jumlah || 0) &&
          String(r.lokasiStock || "") === String(rec.lokasiStock || ""));
      } else {
        confirmed = (server?.stockOut || []).some(r =>
          String(r.date || "") === String(rec.date || "") &&
          String(r.noUnit || "") === String(rec.noUnit || "") &&
          String(r.namaPemohon || "") === String(rec.namaPemohon || ""));
      }

      if (!confirmed) throw new Error("Server did not confirm the submitted record");
      const original = await dbGet(store, rec.id);
      if (original) {
        original.synced = true;
        original.syncedAt = new Date().toISOString();
        await dbPut(store, original);
      }
      await cacheSheetData(server);
      ok++;
    } catch (err) {
      console.error("Google Apps Script sync failed", store, rec.id, err);
      // Keep this and remaining records pending so they can be retried safely.
      break;
    }
  }
  updateStatusPill();
  if (ok) {
    toast(`${ok} data terkonfirmasi di Google Sheet`);
    await renderDashboard();
    if (activeTab === "stok") await renderStokSummary();
  }
  await checkUnsynced();
}

/* ───────────── Init ───────────── */
async function init() {
  await dbPromise;
  updateStatusPill();
  setDefaultDates();
  showStep(0);
  await renderDashboard(); // instant offline/local view
  if (navigator.onLine) {
    await trySync();        // push pending local records first
    await pullFromSheet({ quiet: true }); // then hydrate from Google Sheet
  }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
init();
