<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Record Retention Deal Selector</title>
<script src="libs/xlsx.full.min.js"></script>
<script src="app.js" defer></script>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f2f5; color: #1a1a2e; min-height: 100vh; }

.header { background: linear-gradient(135deg, #1a1a2e 0%, #0f3460 100%); color: white; padding: 18px 32px; display: flex; align-items: center; gap: 14px; }
.logo { width: 36px; height: 36px; background: #e94560; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 16px; flex-shrink: 0; }
.header h1 { font-size: 18px; font-weight: 700; }
.header p  { font-size: 12px; opacity: 0.65; margin-top: 1px; }

.container { max-width: 1100px; margin: 0 auto; padding: 22px; }

.card { background: white; border-radius: 12px; padding: 20px 22px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.step-label { font-size: 11px; font-weight: 700; color: #aaa; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
.step-num { width: 20px; height: 20px; background: #0f3460; color: white; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 800; flex-shrink: 0; }

label.field-label { font-size: 13px; font-weight: 600; color: #444; display: block; margin-bottom: 6px; }

/* State tags */
.tag-input-wrap { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; border: 2px solid #e0e0e0; border-radius: 8px; padding: 8px 10px; min-height: 44px; cursor: text; transition: border-color 0.2s; }
.tag-input-wrap:focus-within { border-color: #0f3460; }
.state-tag { display: inline-flex; align-items: center; gap: 5px; background: #0f3460; color: white; border-radius: 6px; padding: 3px 10px; font-size: 13px; font-weight: 700; }
.state-tag button { background: none; border: none; color: rgba(255,255,255,0.7); cursor: pointer; font-size: 14px; line-height: 1; padding: 0 0 0 2px; }
.state-tag button:hover { color: white; }
.tag-text-input { border: none; outline: none; font-size: 13px; font-family: inherit; min-width: 60px; flex: 1; background: transparent; text-transform: uppercase; }
.tag-hint { font-size: 11px; color: #aaa; margin-top: 5px; }

/* In/Out toggle */
.io-toggle { display: flex; border-radius: 8px; overflow: hidden; border: 2px solid #e0e0e0; width: fit-content; }
.io-option { padding: 9px 20px; font-size: 13px; font-weight: 600; cursor: pointer; background: white; color: #888; border: none; }
.io-option.active-in  { background: #dcfce7; color: #15803d; }
.io-option.active-out { background: #fee2e2; color: #dc2626; }

/* Date */
input[type="date"] { padding: 10px 12px; border: 2px solid #e0e0e0; border-radius: 8px; font-size: 14px; outline: none; transition: border-color 0.2s; font-family: inherit; width: 100%; }
input[type="date"]:focus { border-color: #0f3460; }
.date-range-badge { display: inline-block; background: #eff6ff; color: #1d4ed8; border-radius: 6px; padding: 5px 12px; font-size: 12px; font-weight: 600; margin-top: 8px; }

/* Highbeam */
.hb-links { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
.hb-state-group { display: flex; align-items: center; gap: 8px; }
.hb-btn { display: inline-flex; align-items: center; gap: 7px; padding: 10px 18px; border-radius: 8px; font-size: 13px; font-weight: 700; text-decoration: none; background: #0f3460; color: white; transition: background 0.15s; }
.hb-btn:hover { background: #1a4a7a; }
.hb-placeholder { font-size: 13px; color: #aaa; padding: 8px 0; }
.btn-fetch { padding: 9px 14px; border-radius: 8px; border: none; font-size: 13px; font-weight: 600; cursor: pointer; background: #059669; color: white; transition: background 0.15s; white-space: nowrap; }
.btn-fetch:hover { background: #047857; }
.btn-fetch:disabled { background: #d1d5db; cursor: not-allowed; color: #9ca3af; }
.hb-fetch-status { font-size: 12px; color: #6b7280; white-space: nowrap; }

/* Drop zone */
.drop-zone { border: 2px dashed #d0d0d0; border-radius: 10px; padding: 26px; text-align: center; cursor: pointer; transition: all 0.2s; background: #fafafa; }
.drop-zone:hover, .drop-zone.drag-over { border-color: #0f3460; background: #f0f4ff; }
.drop-zone .dz-icon { font-size: 28px; margin-bottom: 8px; }
.drop-zone p { color: #888; font-size: 14px; }
.drop-zone strong { color: #0f3460; }
.file-loaded { border-color: #22c55e !important; background: #f0fdf4 !important; }

.file-chip { display: inline-flex; align-items: center; gap: 8px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 5px 10px; font-size: 12px; color: #166534; font-weight: 600; margin-top: 6px; margin-right: 6px; }
.file-chip button { background: none; border: none; cursor: pointer; color: #dc2626; font-size: 13px; }

/* Buttons */
.btn { padding: 11px 22px; border-radius: 8px; border: none; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
.btn-primary   { background: #0f3460; color: white; }
.btn-primary:hover   { background: #1a4a7a; }
.btn-primary:disabled { background: #d1d5db; cursor: not-allowed; color: #9ca3af; }
.btn-secondary { background: #f0f2f5; color: #444; }
.btn-secondary:hover { background: #e0e4ea; }
.btn-green     { background: #16a34a; color: white; }
.btn-green:hover     { background: #15803d; }
.btn-green:disabled  { background: #d1d5db; cursor: not-allowed; color: #9ca3af; }
.btn-carma     { background: #7c3aed; color: white; }
.btn-carma:hover     { background: #6d28d9; }
.btn-carma:disabled  { background: #d1d5db; cursor: not-allowed; color: #9ca3af; }
.btn-stop      { background: #dc2626; color: white; }
.btn-stop:hover      { background: #b91c1c; }

.action-row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 18px; }

/* Summary stats */
.summary-bar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
.stat-card { background: white; border-radius: 10px; padding: 14px 16px; box-shadow: 0 2px 6px rgba(0,0,0,0.06); }
.stat-card .num { font-size: 24px; font-weight: 800; color: #0f3460; }
.stat-card .lbl { font-size: 12px; color: #888; margin-top: 2px; }

/* Results table */
.hub-section { margin-bottom: 14px; border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
.hub-header { background: #1e293b; color: white; padding: 9px 14px; font-size: 13px; font-weight: 700; display: flex; justify-content: space-between; align-items: center; }
.hub-header .sub { font-size: 11px; font-weight: 400; opacity: 0.6; }
table { width: 100%; border-collapse: collapse; }
th { background: #f8f9fa; font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.06em; padding: 8px 10px; text-align: left; border-bottom: 2px solid #e5e7eb; white-space: nowrap; }
td { padding: 9px 10px; font-size: 13px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
tr:last-child td { border-bottom: none; }
tr:hover td { background: #fafbff; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 700; }
.badge-in  { background: #dcfce7; color: #15803d; }
.badge-out { background: #fee2e2; color: #dc2626; }
.carma-link { display: inline-flex; align-items: center; gap: 4px; color: #0f3460; text-decoration: none; font-weight: 600; font-size: 12px; padding: 3px 8px; background: #eff6ff; border-radius: 5px; }
.carma-link:hover { background: #dbeafe; }

/* CARMA doc scanner */
.carma-scan-section { background: white; border-radius: 12px; padding: 18px 22px; margin-bottom: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); display: none; }
.scan-header { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.scan-progress-bar { flex: 1; height: 8px; background: #e5e7eb; border-radius: 4px; overflow: hidden; }
.scan-progress-fill { height: 100%; background: #7c3aed; border-radius: 4px; transition: width 0.3s; width: 0; }
.scan-status-text { font-size: 13px; color: #6b7280; font-weight: 500; white-space: nowrap; }

.doc-status-cell { font-size: 12px; }
.doc-status-scanning { color: #888; }
.doc-status-ok      { display: flex; flex-direction: column; gap: 4px; }
.doc-status-missing { color: #dc2626; font-weight: 600; }
.doc-status-error   { color: #9ca3af; }
.doc-link { display: inline-flex; align-items: center; gap: 4px; background: #f5f3ff; color: #7c3aed; border-radius: 5px; padding: 3px 8px; font-size: 11px; font-weight: 600; text-decoration: none; white-space: nowrap; }
.doc-link:hover { background: #ede9fe; }
.doc-missing-badge { background: #fff1f2; color: #be123c; border-radius: 5px; padding: 3px 8px; font-size: 11px; font-weight: 700; display: inline-block; }

/* Review column */
.rv-btn { padding:4px 9px;border-radius:6px;border:1.5px solid #e0e0e0;font-size:11px;font-weight:600;cursor:pointer;background:white;color:#888;transition:all .15s; }
.rv-btn:hover { border-color:#aaa; }
.rv-pass-on { background:#dcfce7 !important;border-color:#22c55e !important;color:#15803d !important; }
.rv-fail-on { background:#fee2e2 !important;border-color:#ef4444 !important;color:#dc2626 !important; }
.rv-notes { width:100%;margin-top:4px;padding:5px 7px;border:1.5px solid #e0e0e0;border-radius:6px;font-size:11px;font-family:inherit;resize:vertical;min-height:42px;outline:none; }
.rv-notes:focus { border-color:#0f3460; }
/* Records panel */
.btn-records { background:#1e293b;color:white; }
.btn-records:hover { background:#334155; }
.rf-select { padding:6px 10px;border:1.5px solid #e0e0e0;border-radius:6px;font-size:12px;font-family:inherit;outline:none; }
.rv-badge-pass { background:#dcfce7;color:#15803d;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:700; }
.rv-badge-fail { background:#fee2e2;color:#dc2626;border-radius:5px;padding:2px 7px;font-size:11px;font-weight:700; }
.rv-badge-none { color:#d1d5db;font-size:11px; }
.rv-del-btn { background:none;border:none;cursor:pointer;color:#d1d5db;font-size:14px;padding:2px 6px; }
.rv-del-btn:hover { color:#ef4444; }
#recordsBody tr { border-bottom:1px solid #f3f4f6; }
#recordsBody tr:hover td { background:#fafbff; }
#recordsBody td { padding:8px 10px;vertical-align:top; }

/* Misc */
.warn { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #9a3412; margin-bottom: 10px; }
.info { background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #1e40af; }
.empty-state { text-align: center; padding: 48px 24px; color: #aaa; }
.empty-state .icon { font-size: 42px; margin-bottom: 12px; }
.toast { position: fixed; bottom: 22px; right: 22px; background: #1a1a2e; color: white; padding: 12px 20px; border-radius: 10px; font-size: 14px; font-weight: 600; opacity: 0; transition: opacity 0.3s; pointer-events: none; z-index: 999; }
.toast.show { opacity: 1; }
#results { display: none; }
</style>
</head>
<body>

<div class="header">
  <div class="logo">C</div>
  <div>
    <h1>Record Retention Deal Selector</h1>
    <p>Carvana Compliance · Police Book → Random Deal Selection → CARMA Document Scan</p>
  </div>
</div>

<!-- ── Update banner (hidden until update is available) ── -->
<div id="updateBanner" style="display:none;background:#0f3460;color:white;padding:10px 20px;display:none;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px">
  <span>🔔 Update available: <strong id="updateVersion"></strong></span>
  <span id="updateNotes" style="color:rgba(255,255,255,0.7)"></span>
  <a id="updateDownloadBtn" href="#" target="_blank" style="background:#e94560;color:white;padding:5px 14px;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;white-space:nowrap">⬇ Download Update</a>
  <button id="updateDismiss" style="background:none;border:none;color:rgba(255,255,255,0.6);cursor:pointer;font-size:16px;margin-left:auto">✕</button>
</div>

<div class="container">

  <!-- ── STEP 1: Parameters ─────────────────────────────────── -->
  <div class="card">
    <div class="step-label"><span class="step-num">1</span> Set Parameters</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">

      <div>
        <label class="field-label">Dealer License State(s)</label>
        <div class="tag-input-wrap" id="tagWrap">
          <input id="tagInput" class="tag-text-input" placeholder="e.g. NC" maxlength="2">
        </div>
        <p class="tag-hint">Type a state code and press Enter or comma</p>
      </div>

      <div>
        <label class="field-label">Week Of</label>
        <input type="date" id="weekOf" />
        <div id="dateRangeBadge" class="date-range-badge" style="display:none"></div>
      </div>

    </div>
  </div>

  <!-- ── STEP 2: Highbeam ───────────────────────────────────── -->
  <div class="card">
    <div class="step-label"><span class="step-num">2</span> Open Highbeam &amp; Download</div>
    <div class="hb-links" id="hbLinks">
      <span class="hb-placeholder">Add state(s) and select a week above to generate links</span>
    </div>
    <p style="font-size:12px;color:#aaa;margin-top:10px">Each link opens Highbeam pre-filtered for that state and week. Click the export button, then upload the file below.</p>
  </div>

  <!-- ── STEP 3: Upload ─────────────────────────────────────── -->
  <div class="card">
    <div class="step-label"><span class="step-num">3</span> Upload Police Book File(s)</div>
    <div class="drop-zone" id="dropZone">
      <div class="dz-icon">📊</div>
      <p><strong>Click to upload</strong> or drag &amp; drop</p>
      <p style="font-size:12px;color:#aaa;margin-top:4px">Highbeam Police Book .xlsx — multiple files OK, they'll merge</p>
      <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" multiple style="display:none">
    </div>
    <div id="fileChips"></div>
    <div id="fileStatus" style="display:none;margin-top:10px"></div>
  </div>

  <!-- ── Actions ───────────────────────────────────────────── -->
  <div class="action-row">
    <button class="btn btn-primary"   id="btn-select-is"  disabled>🎲 Select IS Deals</button>
    <button class="btn btn-secondary" id="btn-select-oos" disabled>🎲 Select OOS Deals</button>
    <button class="btn btn-secondary" id="rerunBtn" style="display:none">🔄 Re-randomize</button>
    <button class="btn btn-green"     id="copyBtn"  style="display:none">📋 Copy to Clipboard</button>
    <button class="btn btn-carma"     id="carmaBtn"    style="display:none">🔍 Scan CARMA Docs</button>
    <button class="btn btn-stop"      id="stopBtn"     style="display:none">⏹ Stop Scan</button>
    <button class="btn btn-records"   id="recordsBtn">📋 Records</button>
  </div>

  <!-- ── CARMA scan progress ───────────────────────────────── -->
  <div class="carma-scan-section" id="carmaScanSection">
    <div class="scan-header">
      <span style="font-size:13px;font-weight:700;color:#7c3aed">CARMA Document Scanner</span>
      <div class="scan-progress-bar"><div class="scan-progress-fill" id="scanProgressFill"></div></div>
      <span class="scan-status-text" id="scanStatusText">Starting…</span>
    </div>
    <div id="scanSummary" style="font-size:12px;color:#6b7280;margin-top:4px"></div>
  </div>

  <!-- ── Results ────────────────────────────────────────────── -->
  <div id="results">
    <div class="summary-bar">
      <div class="stat-card"><div class="num" id="statDeals">0</div><div class="lbl">Deals Selected</div></div>
      <div class="stat-card"><div class="num" id="statHubs">0</div><div class="lbl">Hubs Covered</div></div>
      <div class="stat-card"><div class="num" id="statWarn">0</div><div class="lbl">Hubs &lt;3 Deals</div></div>
      <div class="stat-card"><div class="num" id="statDocs" style="color:#7c3aed">—</div><div class="lbl">Docs Found</div></div>
    </div>
    <div id="warnBanner"></div>
    <div id="resultTables"></div>
  </div>

  <div class="empty-state" id="emptyState">
    <div class="icon">🗂️</div>
    <p>Configure parameters, upload your file, then click <strong>Select Deals</strong></p>
  </div>

</div>

<div class="toast" id="toast"></div>

<!-- ── Records Panel ──────────────────────────────────────────── -->
<div id="recordsPanel" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center">
  <div style="background:white;border-radius:14px;width:95vw;max-width:1100px;max-height:90vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,0.3)">
    <!-- Header -->
    <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span style="font-size:16px;font-weight:800;color:#1a1a2e">📋 Deal Records</span>
      <span id="recordsCount" style="font-size:12px;color:#9ca3af;margin-right:auto"></span>
      <!-- Filters -->
      <select id="rfState"  class="rf-select"><option value="">All States</option></select>
      <select id="rfWeek"   class="rf-select"><option value="">All Weeks</option></select>
      <select id="rfStatus" class="rf-select">
        <option value="">All</option>
        <option value="pass">✅ Pass</option>
        <option value="fail">❌ Fail</option>
        <option value="pending">— Not reviewed</option>
      </select>
      <button id="recordsCopyBtn"  class="btn btn-green" style="padding:7px 14px;font-size:12px">📋 Copy</button>
      <button id="recordsClearBtn" class="btn btn-secondary" style="padding:7px 14px;font-size:12px;background:#fee2e2;color:#dc2626">🗑 Clear Week</button>
      <button id="recordsClose" style="background:none;border:none;font-size:18px;cursor:pointer;color:#9ca3af;padding:4px 8px">✕</button>
    </div>
    <!-- Table -->
    <div style="overflow:auto;flex:1">
      <table style="width:100%;border-collapse:collapse;font-size:12px">
        <thead><tr style="background:#f8f9fa;position:sticky;top:0">
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb;white-space:nowrap">Week</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb">State/Type</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb">Hub</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb">PID</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb">VIN</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb">Buyer</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb">Status</th>
          <th style="padding:8px 10px;text-align:left;border-bottom:2px solid #e5e7eb">Notes</th>
          <th style="padding:8px 10px;border-bottom:2px solid #e5e7eb"></th>
        </tr></thead>
        <tbody id="recordsBody"></tbody>
      </table>
    </div>
  </div>
</div>
</body>
</html>
