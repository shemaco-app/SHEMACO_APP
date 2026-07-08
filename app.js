/* =========================================================
   SPARTA MACO — offline-first emergency equipment monitoring
   Modules: Dashboard · Scan · Inspeksi (wizard) · Stok
   Backend: Google Sheets via Apps Script (optional)
   ========================================================= */

const SHEET_SYNC_URL = "https://script.google.com/macros/s/AKfycbx3FGBe7vrW4qLTR3r1fMwchPzTi-p9XmfJnP8fpp2OzxnTppHD4FsZGhkoH3teCE3pDA/exec";

const CHECKLIST_ITEMS = [
  { key: "handle",     q: "Handle sesuai standar" },
  { key: "hose",       q: "Hose sesuai standar (tidak robek, longgar, tersumbat, dan tertekuk)" },
  { key: "isi_tabung", q: "Isi tabung sesuai dengan risiko kebakaran" },
  { key: "lokasi_ap",  q: "Lokasi penempatan mudah dijangkau dan tidak terhalang" },
  { key: "nozzle",     q: "Nozzle / Terompet sesuai standar (tidak robek, longgar, dan tersumbat)" },
  { key: "pin_lock",   q: "Pin Lock tersegel dan tidak rusak" },
  { key: "pressure",   q: "Pressure Gauge tidak rusak dan berada pada tekanan yang tepat (bar warna hijau)" },
  { key: "tabung",     q: "Tabung tidak ada kerusakan secara fisik (tidak berkarat dan keropos)" },
  { key: "kip",        q: "Terdapat kartu inspeksi Peralatan (KIP)" },
  { key: "rambu",      q: "Terdapat rambu APAR yang terpasang tepat di atas APAR" },
];

/* ───────────── IndexedDB ───────────── */
const DB_NAME = "aparDB", DB_VERSION = 3;
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
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => map[c]);
}
function todayISO() { return new Date().toISOString().slice(0,10); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString("id-ID",{day:"numeric",month:"short",year:"numeric"}) : "–"; }
function fmtDT(iso) { return iso ? new Date(iso).toLocaleString("id-ID",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}) : "–"; }
let _toastTimer;
function toast(msg) { const el = document.getElementById("toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(_toastTimer); _toastTimer = setTimeout(() => el.classList.remove("show"), 2800); }


/* ───────────── Apps Script API helpers ───────────── */
function buildApiUrl(action, params = {}) {
  const u = new URL(SHEET_SYNC_URL);
  u.searchParams.set("action", action);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== "") u.searchParams.set(k, v);
  });
  return u.toString();
}
function apiJsonp(action, params = {}, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    if (!navigator.onLine) return reject(new Error("offline"));
    const cb = "spartaCb_" + Date.now() + "_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    const timer = setTimeout(() => cleanup(new Error("timeout")), timeoutMs);
    function cleanup(err, data) {
      clearTimeout(timer);
      delete window[cb];
      if (script.parentNode) script.parentNode.removeChild(script);
      err ? reject(err) : resolve(data);
    }
    window[cb] = data => cleanup(null, data);
    script.onerror = () => cleanup(new Error("network"));
    script.src = buildApiUrl(action, { ...params, callback: cb });
    document.head.appendChild(script);
  });
}
function normalizeAparUnit(r) {
  const code = String(r.apar_code || r.id || "").trim();
  const kapasitas = r.kapasitas || r.type || r.jenis || "APAR";
  const lokasi = r.lokasi_detail || r.location || r.area || "";
  return {
    id: code,
    apar_code: code,
    location: lokasi,
    type: kapasitas,
    kapasitas,
    area: r.area || "",
    lokasi_detail: r.lokasi_detail || lokasi,
    tipe_unit: r.tipe_unit || "",
    no_unit: r.no_unit || "",
    status: r.status || "Active",
    intervalMonths: Number(r.intervalMonths || r.interval_months || 1) || 1,
    lastInspection: r.last_inspection || null,
    nextDue: r.next_due || null,
    lastFlag: r.last_result || null,
    label: r.label || [code, kapasitas, r.area, lokasi].filter(Boolean).join(" — "),
    syncedFromMaster: true
  };
}
function renderAparDatalist(list) {
  const dl = document.getElementById("aparSuggestions");
  if (!dl) return;
  dl.innerHTML = (list || []).slice(0, 100).map(u => {
    const code = escapeHtml(u.id || u.apar_code || "");
    const label = escapeHtml(u.label || [u.id, u.kapasitas, u.area, u.lokasi_detail].filter(Boolean).join(" — "));
    return `<option value="${code}" label="${label}"></option>`;
  }).join("");
}
async function refreshAparMaster(q = "") {
  const hint = document.getElementById("aparSearchHint");
  try {
    if (hint) hint.textContent = "Mengambil master APAR dari database...";
    const res = await apiJsonp("getAparList", { q });
    if (!res || !res.ok) throw new Error((res && res.message) || "Gagal mengambil master APAR");
    aparMasterCache = (res.data || []).map(normalizeAparUnit);
    for (const u of aparMasterCache) if (u.id) await dbPut("units", u);
    renderAparDatalist(aparMasterCache);
    if (hint) hint.textContent = `Master APAR siap: ${aparMasterCache.length} data${q ? " sesuai pencarian" : ""}.`;
    return aparMasterCache;
  } catch (err) {
    const local = await dbGetAll("units");
    const qn = q.toLowerCase().trim();
    aparMasterCache = local.filter(u => !qn || [u.id, u.location, u.type, u.area, u.no_unit].join(" ").toLowerCase().includes(qn));
    renderAparDatalist(aparMasterCache);
    if (hint) hint.textContent = navigator.onLine ? "Gagal ambil database, pakai cache lokal." : "Offline: pakai cache lokal.";
    return aparMasterCache;
  }
}
function slugCode(v) {
  return String(v || "").toUpperCase().trim().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function buildUnitWithoutCodeFromForm() {
  const noUnit = document.getElementById("noCodeUnitNo").value.trim().toUpperCase();
  const tipeUnit = document.getElementById("noCodeTipeUnit").value;
  const kapasitas = document.getElementById("noCodeKapasitas").value;
  const position = document.getElementById("noCodePosition").value;
  const area = document.getElementById("noCodeArea").value.trim();
  const lokasiDetail = document.getElementById("noCodeLocation").value.trim();
  const generated = ["UNIT", slugCode(noUnit), slugCode(position), slugCode(kapasitas)].filter(Boolean).join("-");
  return { noUnit, tipeUnit, kapasitas, aparPosition: position, area, lokasiDetail, generatedCode: generated, unitId: generated };
}
function resetInspectionState() {
  inspState = {
    unitId: null, unitIsNew: false, assetMode: "registered_code", isRegistered: true, hasAparCode: true,
    generatedCode: "", noUnit: "", tipeUnit: "", kapasitas: "", aparPosition: "", area: "", lokasiDetail: "",
    checklist: {}, photo: null, gps: null, sigHasContent: false
  };
}
function setIdentificationMode(mode) {
  inspMode = mode;
  const coded = document.getElementById("codedAparFields");
  const noCode = document.getElementById("noCodeFields");
  const newFields = document.getElementById("newUnitFields");
  document.getElementById("modeCodeBtn").classList.toggle("active", mode === "code");
  document.getElementById("modeNoCodeBtn").classList.toggle("active", mode === "no_code");
  coded.style.display = mode === "code" ? "block" : "none";
  noCode.style.display = mode === "no_code" ? "block" : "none";
  if (newFields) newFields.style.display = "none";
  if (mode === "no_code") {
    const u = buildUnitWithoutCodeFromForm();
    Object.assign(inspState, { assetMode: "unit_without_code", isRegistered: false, hasAparCode: false, unitId: u.unitId, generatedCode: u.generatedCode });
  } else {
    Object.assign(inspState, { assetMode: "registered_code", isRegistered: true, hasAparCode: true });
  }
}
async function initBarcodeDetector() {
  if (!("BarcodeDetector" in window)) return;
  try {
    barcodeDetector = new BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "code_93", "ean_13", "ean_8", "data_matrix", "pdf417"] });
  } catch (_) { barcodeDetector = null; }
}

/* ───────────── State ───────────── */
let activeTab = "dashboard";
let inspStep = 0;
let inspMode = "code"; // code | no_code
let aparMasterCache = [];
let aparSearchTimer = null;
let barcodeDetector = null;
let barcodeDetecting = false;
let inspState = {
  unitId: null,
  unitIsNew: false,
  assetMode: "registered_code",
  isRegistered: true,
  hasAparCode: true,
  generatedCode: "",
  noUnit: "",
  tipeUnit: "",
  kapasitas: "",
  aparPosition: "",
  area: "",
  lokasiDetail: "",
  checklist: {},
  photo: null,
  gps: null,
  sigHasContent: false
};
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

    // Native BarcodeDetector can read QR + several 1D barcodes on supported Android Chrome.
    if (barcodeDetector && !barcodeDetecting) {
      barcodeDetecting = true;
      barcodeDetector.detect(scanCanvas).then(codes => {
        barcodeDetecting = false;
        if (!scanActive || !codes || !codes.length) return;
        const raw = codes[0].rawValue || "";
        if (raw) { stopScanner(); handleScannedCode(raw.trim()); }
      }).catch(() => { barcodeDetecting = false; });
    }

    // Fallback QR reader.
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
  code = String(code || "").trim().toUpperCase();
  document.getElementById("unitIdInput").value = code;
  document.getElementById("inspDateInput").value = todayISO();
  setIdentificationMode("code");

  const savedName = localStorage.getItem("aparInspectorName");
  if (savedName && !document.getElementById("inspNameInput").value) {
    document.getElementById("inspNameInput").value = savedName;
  }

  inspState.unitId = code;
  inspState.assetMode = "registered_code";
  inspState.hasAparCode = true;
  inspState.isRegistered = false;
  inspState.unitIsNew = false;

  let unit = await dbGet("units", code);
  if (!unit && navigator.onLine && code) {
    const list = await refreshAparMaster(code);
    unit = list.find(u => String(u.id).toUpperCase() === code) || null;
  }

  const infoCard = document.getElementById("unitInfoCard");
  const newFields = document.getElementById("newUnitFields");

  if (unit) {
    inspState.isRegistered = !!unit.syncedFromMaster;
    inspState.unitIsNew = false;
    inspState.kapasitas = unit.kapasitas || unit.type || "";
    inspState.area = unit.area || "";
    inspState.lokasiDetail = unit.lokasi_detail || unit.location || "";
    inspState.noUnit = unit.no_unit || "";
    inspState.tipeUnit = unit.tipe_unit || "";
    infoCard.className = "unit-card";
    infoCard.style.display = "block";
    infoCard.innerHTML = `<div class="unit-name mono">${escapeHtml(unit.id)}</div><div class="unit-meta">${escapeHtml(unit.label || [unit.kapasitas || unit.type, unit.area, unit.lokasi_detail || unit.location].filter(Boolean).join(" — "))}</div>`;
    newFields.style.display = "none";
  } else {
    inspState.isRegistered = false;
    inspState.unitIsNew = true;
    infoCard.className = "unit-card warn";
    infoCard.style.display = "block";
    infoCard.innerHTML = `<div class="unit-name mono">${escapeHtml(code)}</div><div class="unit-meta">Kode belum ada di Master_APAR. Data tetap bisa disimpan sebagai kode belum terdaftar.</div>`;
    newFields.style.display = "flex";
    newFields.style.flexDirection = "column";
  }
}

// Scan button in step 0 → go to scan tab then come back
if (document.getElementById("scanUnitBtn")) document.getElementById("scanUnitBtn").addEventListener("click", () => showTab("scan"));
if (document.getElementById("modeCodeBtn")) document.getElementById("modeCodeBtn").addEventListener("click", () => setIdentificationMode("code"));
if (document.getElementById("modeNoCodeBtn")) document.getElementById("modeNoCodeBtn").addEventListener("click", () => setIdentificationMode("no_code"));
if (document.getElementById("refreshAparBtn")) document.getElementById("refreshAparBtn").addEventListener("click", async () => { await refreshAparMaster(document.getElementById("unitIdInput").value.trim()); toast("Master APAR diperbarui"); });

["noCodeUnitNo","noCodeTipeUnit","noCodeKapasitas","noCodePosition","noCodeArea","noCodeLocation"].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener("input", () => {
    if (inspMode !== "no_code") return;
    const u = buildUnitWithoutCodeFromForm();
    Object.assign(inspState, { ...u, unitId: u.unitId, assetMode: "unit_without_code", isRegistered: false, hasAparCode: false });
  });
});

document.getElementById("unitIdInput").addEventListener("input", (e) => {
  const q = e.target.value.trim();
  clearTimeout(aparSearchTimer);
  aparSearchTimer = setTimeout(() => refreshAparMaster(q), q.length >= 2 ? 350 : 800);
});

document.getElementById("unitIdInput").addEventListener("change", async (e) => {
  const code = e.target.value.trim();
  if (code) await loadUnitForInspection(code);
});

// Step 0 → 1
document.getElementById("step0Next").addEventListener("click", async () => {
  const name = document.getElementById("inspNameInput").value.trim();
  if (!name) { toast("Masukkan nama inspektor"); return; }

  if (inspMode === "no_code") {
    const u = buildUnitWithoutCodeFromForm();
    if (!u.noUnit) { toast("Masukkan no. unit"); return; }
    if (!u.area) { toast("Masukkan area"); return; }
    Object.assign(inspState, { ...u, unitId: u.unitId, assetMode: "unit_without_code", isRegistered: false, hasAparCode: false, unitIsNew: true });
    await dbPut("units", { id: u.unitId, location: [u.area, u.lokasiDetail, u.aparPosition].filter(Boolean).join(" — "), type: u.kapasitas, kapasitas: u.kapasitas, area: u.area, lokasi_detail: u.lokasiDetail, tipe_unit: u.tipeUnit, no_unit: u.noUnit, intervalMonths: 1, lastInspection: null, nextDue: new Date().toISOString(), lastFlag: null, assetMode: "unit_without_code" });
  } else {
    const unitId = document.getElementById("unitIdInput").value.trim().toUpperCase();
    if (!unitId) { toast("Scan atau masukkan kode APAR terlebih dahulu"); return; }
    if (inspState.unitId !== unitId) await loadUnitForInspection(unitId);

    if (inspState.unitIsNew) {
      const loc = document.getElementById("newUnitLoc").value.trim();
      if (!loc) { toast("Masukkan lokasi APAR"); return; }
      const unit = { id: unitId, apar_code: unitId, location: loc, lokasi_detail: loc, type: document.getElementById("newUnitType").value, kapasitas: document.getElementById("newUnitType").value, intervalMonths: parseInt(document.getElementById("newUnitInterval").value)||1, lastInspection: null, nextDue: new Date().toISOString(), lastFlag: null, syncedFromMaster: false };
      await dbPut("units", unit);
      Object.assign(inspState, { unitId, assetMode: "unregistered_code", isRegistered: false, hasAparCode: true, kapasitas: unit.kapasitas, lokasiDetail: loc });
    } else {
      Object.assign(inspState, { unitId, assetMode: inspState.isRegistered ? "registered_code" : "unregistered_code", hasAparCode: true });
    }
  }

  inspState.checklist = {};
  renderChecklist();
  showStep(1);
});

// Checklist
function renderChecklist() {
  const container = document.getElementById("checklist");
  container.innerHTML = CHECKLIST_ITEMS.map(item => `
    <div class="check-item" data-key="${item.key}">
      <div class="q">${escapeHtml(item.q)}</div>
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
        inspState.checklist[card.dataset.key] = btn.dataset.val;
        updateChecklistProgress();
      });
    });
  });
}
function updateChecklistProgress() {
  const answered = Object.keys(inspState.checklist).length;
  const total = CHECKLIST_ITEMS.length;
  document.getElementById("checklistProgress").textContent = `${answered} dari ${total} dijawab`;
  document.getElementById("checklistBar").style.width = `${(answered / total) * 100}%`;
  document.getElementById("step1Next").disabled = answered < total;
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
document.getElementById("step2Next").addEventListener("click", () => { renderPreview(); showStep(3); });

// Step 3: Preview
function renderPreview() {
  const allYa = Object.values(inspState.checklist).every(v => v === "ya");
  const result = allYa ? "ok" : "tidak_ok";
  const resultLabel = allYa ? "&#10003; SEMUA OK" : "&#10007; PERLU PERHATIAN";

  const rows = CHECKLIST_ITEMS.map(item => {
    const val = inspState.checklist[item.key];
    const cls = val === "ya" ? "ya" : "tidak";
    const lbl = val === "ya" ? "Ya" : "Tidak";
    return `<div class="preview-row"><span class="key">${escapeHtml(item.q)}</span><span class="val ${cls}">${lbl}</span></div>`;
  }).join("");

  const unitRows = inspMode === "no_code" ? `
        <div class="preview-row"><span class="key">Mode</span><span class="val">APAR Tanpa Kode</span></div>
        <div class="preview-row"><span class="key">Generated Code</span><span class="val mono">${escapeHtml(inspState.generatedCode || inspState.unitId)}</span></div>
        <div class="preview-row"><span class="key">No. Unit</span><span class="val mono">${escapeHtml(inspState.noUnit)}</span></div>
        <div class="preview-row"><span class="key">Posisi</span><span class="val">${escapeHtml(inspState.aparPosition)}</span></div>
        <div class="preview-row"><span class="key">Area</span><span class="val">${escapeHtml(inspState.area)}</span></div>` : `
        <div class="preview-row"><span class="key">Kode</span><span class="val mono">${escapeHtml(inspState.unitId)}</span></div>
        <div class="preview-row"><span class="key">Status Master</span><span class="val">${inspState.isRegistered ? "Terdaftar" : "Belum terdaftar"}</span></div>
        ${inspState.area ? `<div class="preview-row"><span class="key">Area</span><span class="val">${escapeHtml(inspState.area)}</span></div>` : ""}
        ${inspState.lokasiDetail ? `<div class="preview-row"><span class="key">Lokasi</span><span class="val">${escapeHtml(inspState.lokasiDetail)}</span></div>` : ""}`;

  document.getElementById("previewCard").innerHTML = `
    <div class="preview-card">
      <div class="preview-result ${result}">${resultLabel}</div>
      <div>
        <div class="preview-section">Identitas Peralatan</div>
        ${unitRows}
        <div class="preview-row"><span class="key">Inspektor</span><span class="val">${escapeHtml(document.getElementById("inspNameInput").value)}</span></div>
        <div class="preview-row"><span class="key">Tanggal</span><span class="val">${fmtDate(document.getElementById("inspDateInput").value)}</span></div>
      </div>
      <div>
        <div class="preview-section">Hasil Checklist</div>
        ${rows}
      </div>
      ${inspState.gps ? `<div class="preview-row"><span class="key">GPS</span><span class="val mono" style="font-size:11px">${inspState.gps.lat.toFixed(4)}, ${inspState.gps.lng.toFixed(4)}</span></div>` : ""}
    </div>`;
}

document.getElementById("step3Back").addEventListener("click", () => showStep(2));
document.getElementById("submitBtn").addEventListener("click", async () => {
  const tidak = CHECKLIST_ITEMS.filter(item => inspState.checklist[item.key] === "tidak");
  const inspName = document.getElementById("inspNameInput").value.trim();

  // Build modal body
  let body = `<b>${inspState.unitId}</b> — Inspektor: ${inspName}<br><br>`;
  if (tidak.length) {
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

    const allYa = Object.values(inspState.checklist).every(v => v === "ya");
    const result = allYa ? "ok" : "tidak_ok";
    const inspection = {
      id: uid("insp"),
      inspection_id: uid("insp"),
      unitId: inspState.unitId,
      apar_code: inspState.hasAparCode ? inspState.unitId : "",
      generated_code: inspState.generatedCode || inspState.unitId,
      asset_mode: inspState.assetMode,
      assetMode: inspState.assetMode,
      is_registered: inspState.isRegistered,
      has_apar_code: inspState.hasAparCode,
      no_unit: inspState.noUnit,
      noUnit: inspState.noUnit,
      tipe_unit: inspState.tipeUnit,
      tipeUnit: inspState.tipeUnit,
      kapasitas: inspState.kapasitas,
      apar_position: inspState.aparPosition,
      aparPosition: inspState.aparPosition,
      area: inspState.area,
      lokasi_detail: inspState.lokasiDetail,
      inspector: inspName,
      inspectorName: inspName,
      inspection_date: document.getElementById("inspDateInput").value,
      date: new Date().toISOString(),
      checklist: inspState.checklist,
      ...inspState.checklist,
      result,
      photo: inspState.photo,
      signature: inspState.sigHasContent ? document.getElementById("sigPad").toDataURL("image/png") : null,
      gps: inspState.gps,
      gps_lat: inspState.gps ? inspState.gps.lat : "",
      gps_lng: inspState.gps ? inspState.gps.lng : "",
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
    resetInspectionState();
    setIdentificationMode("code");
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
window.addEventListener("online", () => { updateStatusPill(); trySync(); });
window.addEventListener("offline", updateStatusPill);

async function trySync() {
  if (!navigator.onLine || SHEET_SYNC_URL.includes("REPLACE_WITH_YOUR_DEPLOYMENT_ID")) return;
  const pill = document.getElementById("statusPill");
  const text = document.getElementById("statusText");
  pill.className = "status-pill syncing"; text.textContent = "Sinkronisasi...";

  let ok = 0;
  const allPending = [
    ...(await dbGetAll("inspections")).filter(r => !r.synced).map(r => ({ store: "inspections", rec: { type: "inspection", ...r } })),
    ...(await dbGetAll("stock_in")).filter(r => !r.synced).map(r => ({ store: "stock_in", rec: { type: "stock_in", ...r } })),
    ...(await dbGetAll("stock_out")).filter(r => !r.synced).map(r => ({ store: "stock_out", rec: { type: "stock_out", ...r } })),
  ];

  for (const { store, rec } of allPending) {
    try {
      await fetch(SHEET_SYNC_URL, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(rec) });
      const original = await dbGet(store, rec.id);
      if (original) { original.synced = true; await dbPut(store, original); }
      ok++;
    } catch { break; }
  }
  updateStatusPill();
  if (ok) toast(`${ok} data tersinkron ke dashboard`);
}

/* ───────────── Init ───────────── */
async function init() {
  await dbPromise;
  await initBarcodeDetector();
  updateStatusPill();
  setDefaultDates();
  setIdentificationMode("code");
  showStep(0);
  renderDashboard();
  refreshAparMaster("").catch(() => {});
  if (navigator.onLine) trySync();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}
init();
