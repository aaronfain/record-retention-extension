// ═══════════════════════════════════════════════════════════════
// CARVANA RECORD RETENTION — app.js
// ═══════════════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────────────────
let selectedStates = [];
let dealType       = 'in';
let loadedFiles    = [];
let rawData        = [];
let detectedCols   = {};
let selectedDeals  = [];
let carmaResults   = {};   // pid → { status, docs, customerUrl }
let myTabId        = null;
let reviewRecords  = {};   // 'pid_weekOf' → review record (loaded from storage)

const HIGHBEAM_BASE = 'https://highbeam.carvana.net/dashboards/police-book-0d07164a';

// ── Column aliases ────────────────────────────────────────────────
const COL_ALIASES = {
  hub:      ['hub name', 'hub', 'delivery hub', 'market', 'delivery market'],
  vin:      ['vin', 'vehicle identification number'],
  pid:      ['purchaseid', 'purchase id', 'pid', 'purchase_id'],
  saleDate: ['saleeffectivedate', 'sale effective date', 'sale date', 'saledate', 'date of sale'],
  buyer:    ['buyer', 'customer', 'buyer name', 'customer name'],
  regState: ['registration state', 'buyer reg state', 'buyerregstate', 'reg state',
             'buyer registration state', 'buyerregistrationstate', 'vehicle registration state',
             'customer registration state', 'reg. state'],
  dlrState: ['dealer license state', 'dealerlicensestate', 'dealer lic state',
             'dealer state', 'dlr state', 'dlr license state', 'statecode',
             'stateabbreviation', 'state abbreviation', 'dealer lic. state'],
};

// ── Init ──────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  // Default week-of date
  const today = new Date();
  document.getElementById('weekOf').value = today.toISOString().split('T')[0];
  onWeekChange();

  // ── Wire all event handlers (CSP-safe, no inline handlers) ──────

  // State tag input
  const tagWrap  = document.getElementById('tagWrap');
  const tagInput = document.getElementById('tagInput');
  tagWrap.addEventListener('click', () => tagInput.focus());
  tagInput.addEventListener('keydown', handleTagKey);
  tagInput.addEventListener('input', () => { tagInput.value = tagInput.value.toUpperCase(); });

  // Week-of date
  document.getElementById('weekOf').addEventListener('change', onWeekChange);

  // Drop zone
  const dropZone  = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');
  dropZone.addEventListener('click',      () => fileInput.click());
  dropZone.addEventListener('dragover',   e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave',  () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop',       handleDrop);
  fileInput.addEventListener('change',    e => {
    [...e.target.files].forEach(processFile);
    e.target.value = '';
  });

  // Action buttons — IS / OOS select buttons set deal type then run
  document.getElementById('btn-select-is').addEventListener('click',  () => { setDealType('in');  runSelection(); });
  document.getElementById('btn-select-oos').addEventListener('click', () => { setDealType('out'); runSelection(); });
  document.getElementById('rerunBtn').addEventListener('click', runSelection);
  document.getElementById('copyBtn').addEventListener('click',  copyAll);
  document.getElementById('carmaBtn').addEventListener('click', startCarmaScan);
  document.getElementById('stopBtn').addEventListener('click', stopCarmaScan);
  document.getElementById('recordsBtn').addEventListener('click', openRecordsPanel);
  document.getElementById('recordsClose').addEventListener('click', () => {
    document.getElementById('recordsPanel').style.display = 'none';
  });

  // Load persisted reviews on startup
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.get('rrReviews', d => { reviewRecords = d.rrReviews || {}; });
  }

  // Dismiss update banner
  document.getElementById('updateDismiss').addEventListener('click', () => {
    document.getElementById('updateBanner').style.display = 'none';
  });

  // Check for updates from GitHub
  checkForUpdates();

  // Chrome extension setup
  if (typeof chrome !== 'undefined' && chrome.tabs) {
    chrome.tabs.getCurrent(tab => { myTabId = tab?.id; });
    chrome.runtime.onMessage.addListener(msg => {
      if (msg.action === 'carmaProgress')    handleCarmaProgress(msg);
      if (msg.action === 'carmaDealResult')  handleCarmaDealResult(msg);
      if (msg.action === 'highbeamProgress') handleHighbeamProgress(msg);
    });
  }
});

// ═══════════════════════════════════════════════════════════════
// STATE TAGS
// ═══════════════════════════════════════════════════════════════
function handleTagKey(e) {
  const input = e.target;
  const val   = input.value.trim().toUpperCase();
  if ((e.key === 'Enter' || e.key === ',') && val.length >= 2) {
    e.preventDefault(); addState(val.slice(0, 2)); input.value = '';
  } else if (e.key === 'Backspace' && input.value === '' && selectedStates.length) {
    removeState(selectedStates[selectedStates.length - 1]);
  }
}

function addState(code) {
  if (!code || selectedStates.includes(code)) return;
  selectedStates.push(code); renderTags(); refreshHighbeam();
}

function removeState(code) {
  selectedStates = selectedStates.filter(s => s !== code); renderTags(); refreshHighbeam();
}

function renderTags() {
  const wrap  = document.getElementById('tagWrap');
  const input = document.getElementById('tagInput');
  wrap.querySelectorAll('.state-tag').forEach(t => t.remove());
  selectedStates.forEach(code => {
    const tag = document.createElement('span');
    tag.className = 'state-tag';
    const btn = document.createElement('button');
    btn.title = 'Remove'; btn.textContent = '×';
    btn.addEventListener('click', e => { e.stopPropagation(); removeState(code); });
    tag.textContent = code;
    tag.appendChild(btn);
    wrap.insertBefore(tag, input);
  });
}

// ═══════════════════════════════════════════════════════════════
// DEAL TYPE
// ═══════════════════════════════════════════════════════════════
function setDealType(type) {
  dealType = type;
  // Highlight whichever button was last used
  const isBtn  = document.getElementById('btn-select-is');
  const oosBtn = document.getElementById('btn-select-oos');
  if (isBtn)  isBtn.className  = 'btn ' + (type === 'in'  ? 'btn-primary' : 'btn-secondary');
  if (oosBtn) oosBtn.className = 'btn ' + (type === 'out' ? 'btn-primary' : 'btn-secondary');
}

// ═══════════════════════════════════════════════════════════════
// DATE RANGE
// ═══════════════════════════════════════════════════════════════
function onWeekChange() {
  const val = document.getElementById('weekOf').value;
  if (!val) { document.getElementById('dateRangeBadge').style.display = 'none'; return; }
  const from = new Date(val + 'T12:00:00');
  const to   = new Date(from); to.setDate(from.getDate() + 6);
  const badge = document.getElementById('dateRangeBadge');
  badge.style.display = 'inline-block';
  badge.textContent   = `${fmtDate(from)} – ${fmtDate(to)}`;
  refreshHighbeam();
}

function getDateRange() {
  const val = document.getElementById('weekOf').value;
  if (!val) return null;
  const from = new Date(val + 'T00:00:00');
  const to   = new Date(val + 'T00:00:00'); to.setDate(from.getDate() + 6); to.setHours(23, 59, 59);
  return { from, to };
}

function fmtDate(d) { return `${d.getMonth()+1}/${d.getDate()}/${d.getFullYear()}`; }
function fmtISO(d)  { return d.toISOString().split('T')[0]; }

// ═══════════════════════════════════════════════════════════════
// HIGHBEAM LINKS + AUTO-FETCH
// ═══════════════════════════════════════════════════════════════
function refreshHighbeam() {
  const container = document.getElementById('hbLinks');
  const dr = getDateRange();
  if (!selectedStates.length || !dr) {
    container.innerHTML = '<span class="hb-placeholder">Add state(s) and select a week above to generate links</span>';
    return;
  }
  container.innerHTML = '';
  const isExtension = typeof chrome !== 'undefined' && chrome.runtime?.id;

  selectedStates.forEach(state => {
    const dateParam = encodeURIComponent(`min:${fmtISO(dr.from)},max:${fmtISO(dr.to)}`);
    const url = `${HIGHBEAM_BASE}?dealer_license_state=${state}&sale_date=${dateParam}`;

    const wrap = document.createElement('div');
    wrap.className = 'hb-state-group';

    // Manual link (always shown as fallback)
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.className = 'hb-btn';
    a.innerHTML = `📊 ${state}`;
    wrap.appendChild(a);

    // Auto-fetch button (extension only)
    if (isExtension) {
      const fetchBtn = document.createElement('button');
      fetchBtn.className = 'btn btn-fetch';
      fetchBtn.innerHTML = '⬇ Auto-fetch';
      fetchBtn.dataset.state = state;
      fetchBtn.addEventListener('click', () => autoFetchHighbeam(state));
      wrap.appendChild(fetchBtn);

      const statusEl = document.createElement('span');
      statusEl.className = 'hb-fetch-status';
      statusEl.id = `hb-status-${state}`;
      wrap.appendChild(statusEl);
    }

    container.appendChild(wrap);
  });
}

function autoFetchHighbeam(state) {
  const dr = getDateRange();
  if (!dr) { showToast('⚠️ Set a week first'); return; }

  const fetchBtn = document.querySelector(`button.btn-fetch[data-state="${state}"]`);
  const statusEl = document.getElementById(`hb-status-${state}`);

  if (fetchBtn) { fetchBtn.disabled = true; fetchBtn.innerHTML = '⏳ Fetching…'; }
  if (statusEl) statusEl.textContent = 'Opening Highbeam…';

  chrome.runtime.sendMessage(
    { action: 'fetchHighbeamExcel', state, dateFrom: fmtISO(dr.from), dateTo: fmtISO(dr.to), senderTabId: myTabId },
    response => {
      if (fetchBtn) { fetchBtn.disabled = false; fetchBtn.innerHTML = '⬇ Auto-fetch'; }

      if (!response?.ok) {
        const err = response?.error || 'Unknown error';
        if (statusEl) statusEl.textContent = '❌ ' + err;
        showToast('❌ Auto-fetch failed: ' + err);
        return;
      }

      // Decode base64 → ArrayBuffer → process as xlsx file
      try {
        const bin    = atob(response.data);
        const bytes  = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const ok = processFileFromBuffer(bytes.buffer, `Highbeam_${state}_${fmtISO(dr.from)}.xlsx`);
        if (ok) {
          if (statusEl) statusEl.textContent = '✅ Loaded!';
          showToast(`✅ Highbeam ${state} loaded`);
        } else {
          if (statusEl) statusEl.textContent = '❌ Could not parse file';
        }
      } catch (err) {
        if (statusEl) statusEl.textContent = '❌ Parse error';
        console.error('[HB] parse error:', err);
      }
    }
  );
}

function handleHighbeamProgress(msg) {
  const statusEl = document.getElementById(`hb-status-${msg.state}`);
  if (!statusEl) return;
  const labels = {
    opening:  '🔄 Opening Highbeam…',
    loading:  '⏳ Loading dashboard…',
    clicking: '🖱️ Looking for download button…',
    waiting:  '📥 Waiting for file…',
    manual:   '👆 Click the export/download button in Highbeam — file will load here automatically'
  };
  statusEl.textContent = labels[msg.status] || msg.status;
  if (msg.status === 'manual') {
    statusEl.style.color = '#d97706'; // amber — action needed
    if (msg.buttons) console.log('[HB] Buttons found on page:', msg.buttons);
  } else {
    statusEl.style.color = '';
  }
}

// ═══════════════════════════════════════════════════════════════
// COLUMN DETECTION
// ═══════════════════════════════════════════════════════════════
function detectColumns(headerRow) {
  const result = {};
  const norm   = headerRow.map((h, i) => ({ i, k: (h||'').toString().toLowerCase().trim() }));
  for (const [field, aliases] of Object.entries(COL_ALIASES)) {
    for (const alias of aliases) {
      const f = norm.find(h => h.k === alias);
      if (f) { result[field] = f.i; break; }
    }
    if (result[field] === undefined) {
      for (const alias of aliases) {
        const f = norm.find(h => h.k.includes(alias) || alias.includes(h.k));
        if (f) { result[field] = f.i; break; }
      }
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════
// FILE HANDLING
// ═══════════════════════════════════════════════════════════════
function handleDrop(e) {
  e.preventDefault();
  document.getElementById('dropZone').classList.remove('drag-over');
  [...e.dataTransfer.files].forEach(processFile);
}

function processFileFromBuffer(buffer, filename) {
  try {
    const wb   = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    if (rows.length < 2) { showToast(`⚠️ ${filename} appears empty`); return false; }

    const header = rows[0].map(h => (h||'').toString().trim());
    const cols   = detectColumns(header);
    const hubCol = cols.hub ?? 1;

    let lastHub = null;
    const filled = [];
    for (const row of rows.slice(1)) {
      const v = (row[hubCol]||'').toString().trim();
      if (v) lastHub = v;
      if (!lastHub) continue;
      const r = [...row]; r[hubCol] = lastHub;
      filled.push(r);
    }

    loadedFiles.push({ name: filename, rows: filled, cols, header });
    console.log('[RR] Column detection for', filename, '→', JSON.stringify(
      Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, `col ${i}: "${header[i]}"`]))
    ));
    rebuildRaw();
    renderFileChips();
    renderFileStatus();
    return true;
  } catch(err) { showToast(`❌ Could not read ${filename}`); console.error(err); return false; }
}

function processFile(file) {
  const reader = new FileReader();
  reader.onload = e => processFileFromBuffer(e.target.result, file.name);
  reader.readAsArrayBuffer(file);
}

function removeFile(i) {
  loadedFiles.splice(i, 1); rebuildRaw(); renderFileChips(); renderFileStatus();
}

function rebuildRaw() {
  rawData      = loadedFiles.flatMap(f => f.rows);
  detectedCols = loadedFiles[0]?.cols ?? {};
}

function renderFileChips() {
  const el = document.getElementById('fileChips');
  el.innerHTML = '';
  loadedFiles.forEach((f, i) => {
    const chip = document.createElement('span');
    chip.className = 'file-chip';
    chip.innerHTML = `✅ ${f.name} <span style="color:#6b7280;font-weight:400">(${f.rows.length.toLocaleString()} rows)</span>`;
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.addEventListener('click', () => removeFile(i));
    chip.appendChild(btn);
    el.appendChild(chip);
  });
  const dz = document.getElementById('dropZone');
  if (loadedFiles.length) dz.classList.add('file-loaded');
  else dz.classList.remove('file-loaded');
}

function setSelectBtnsDisabled(disabled) {
  const isBtn  = document.getElementById('btn-select-is');
  const oosBtn = document.getElementById('btn-select-oos');
  if (isBtn)  isBtn.disabled  = disabled;
  if (oosBtn) oosBtn.disabled = disabled;
}

function renderFileStatus() {
  const el = document.getElementById('fileStatus');
  if (!loadedFiles.length) { el.style.display = 'none'; setSelectBtnsDisabled(true); return; }

  const missing = Object.keys(COL_ALIASES).filter(k => detectedCols[k] === undefined);

  // Auto-populate states from data
  if (!selectedStates.length) {
    const dlrCol = detectedCols.dlrState;
    if (dlrCol !== undefined) {
      const found = [...new Set(rawData.map(r => (r[dlrCol]||'').toString().trim()).filter(Boolean))].sort();
      found.forEach(addState);
    }
  }

  el.style.display = 'block';
  if (missing.includes('hub') || missing.includes('regState') || missing.includes('dlrState')) {
    el.className = 'warn';
    el.innerHTML = `⚠️ Missing required columns: <strong>${missing.join(', ')}</strong><br>
      <small>Headers found: ${(loadedFiles[0]?.header||[]).map(h=>`"${h}"`).join(', ')}</small>`;
    setSelectBtnsDisabled(true);
  } else {
    const h = loadedFiles[0]?.header || [];
    const regLabel  = h[detectedCols.regState]  || `col ${detectedCols.regState}`;
    const dlrLabel  = h[detectedCols.dlrState]  || `col ${detectedCols.dlrState}`;
    el.className = 'info';
    el.innerHTML = `✅ <strong>${rawData.length.toLocaleString()} rows</strong> loaded &nbsp;·&nbsp;
      Reg State → <em>"${regLabel}"</em> &nbsp;·&nbsp; Dealer State → <em>"${dlrLabel}"</em>`;
    setSelectBtnsDisabled(false);
  }
}

// ═══════════════════════════════════════════════════════════════
// DEAL SELECTION
// ═══════════════════════════════════════════════════════════════
function parseDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  const d = new Date(v); return isNaN(d) ? null : d;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}

function runSelection() {
  if (!selectedStates.length) { showToast('⚠️ Add at least one state'); return; }

  const dr = getDateRange();
  const c  = {
    hub:      detectedCols.hub      ?? 1,
    vin:      detectedCols.vin      ?? 2,
    pid:      detectedCols.pid      ?? 11,
    saleDate: detectedCols.saleDate ?? 15,
    buyer:    detectedCols.buyer    ?? 19,
    regState: detectedCols.regState ?? 21,
    dlrState: detectedCols.dlrState ?? 0,
  };

  const byHub = {};
  for (const row of rawData) {
    const dlrState = (row[c.dlrState]||'').toString().trim();
    if (!selectedStates.includes(dlrState)) continue;
    const regState = (row[c.regState]||'').toString().trim();
    if (!regState) continue;  // skip rows with no registration state — can't classify in/out
    const isIn     = regState.toUpperCase() === dlrState.toUpperCase();
    if (dealType === 'in'  && !isIn) continue;
    if (dealType === 'out' && isIn)  continue;

    const saleDate = parseDate(row[c.saleDate]);
    if (dr) {
      if (saleDate && saleDate < dr.from) continue;
      if (saleDate && saleDate > dr.to)   continue;
    }

    const hub = (row[c.hub]||'').toString().trim();
    if (!hub) continue;
    if (!byHub[hub]) byHub[hub] = [];
    byHub[hub].push({
      hub, dlrState, regState,
      pid:      (row[c.pid]    ||'').toString().trim(),
      vin:      (row[c.vin]    ||'').toString().trim(),
      buyer:    (row[c.buyer]  ||'').toString().replace(/,/g,' ').trim(),
      saleDate: saleDate ? fmtDate(saleDate) : '',
      weekOf:   document.getElementById('weekOf').value
                ? fmtDate(new Date(document.getElementById('weekOf').value + 'T12:00:00'))
                : '',
    });
  }

  if (!Object.keys(byHub).length) {
    showToast('⚠️ No matching deals found — check your filters'); return;
  }

  selectedDeals = [];
  carmaResults  = {};
  const warnings = [];
  for (const [hub, deals] of Object.entries(byHub)) {
    const picked = shuffle(deals).slice(0, 3);
    selectedDeals.push(...picked);
    if (deals.length < 3) warnings.push(`${hub} (${deals.length} available)`);
  }

  renderResults(warnings);

  // Show CARMA scan button
  document.getElementById('carmaBtn').style.display = 'inline-block';
  document.getElementById('statDocs').textContent = '—';
}

// ═══════════════════════════════════════════════════════════════
// RENDER RESULTS
// ═══════════════════════════════════════════════════════════════
function renderResults(warnings) {
  document.getElementById('results').style.display    = 'block';
  document.getElementById('emptyState').style.display = 'none';
  document.getElementById('rerunBtn').style.display   = 'inline-block';
  document.getElementById('copyBtn').style.display    = 'inline-block';

  const hubs = [...new Set(selectedDeals.map(d => d.hub))];
  document.getElementById('statDeals').textContent = selectedDeals.length;
  document.getElementById('statHubs').textContent  = hubs.length;
  document.getElementById('statWarn').textContent  = warnings.length;

  document.getElementById('warnBanner').innerHTML = warnings.length
    ? `<div class="warn">⚠️ Fewer than 3 deals available for: ${warnings.join(' · ')}</div>` : '';

  const byState = {};
  for (const d of selectedDeals) {
    if (!byState[d.dlrState]) byState[d.dlrState] = {};
    if (!byState[d.dlrState][d.hub]) byState[d.dlrState][d.hub] = [];
    byState[d.dlrState][d.hub].push(d);
  }

  const tables = document.getElementById('resultTables');
  tables.innerHTML = '';

  for (const state of Object.keys(byState).sort()) {
    let html = `<div style="margin-bottom:22px">
      <div style="font-size:12px;font-weight:800;color:#0f3460;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px;padding-left:2px">
        ${state} — ${dealType === 'in' ? 'In-State' : 'Out-of-State'} Deals
      </div>`;

    for (const [hub, deals] of Object.entries(byState[state])) {
      html += `<div class="hub-section">
        <div class="hub-header">
          <span>${hub}</span>
          <span class="sub">${deals.length} deal${deals.length!==1?'s':''} selected</span>
        </div>
        <table><thead><tr>
          <th>PID</th><th>VIN</th><th>Buyer</th><th>Sale Date</th>
          <th>Reg State</th><th>CARMA</th><th>Compliance Docs</th><th>Review</th>
        </tr></thead><tbody>`;

      deals.forEach(d => {
        const carmaUrl  = `https://carma.cvnacorp.com/research/search/${d.pid}`;
        const badgeCls  = dealType === 'in' ? 'badge-in' : 'badge-out';
        html += `<tr data-pid="${d.pid}">
          <td style="font-family:monospace">${d.pid}</td>
          <td style="font-family:monospace;font-size:11px">${d.vin}</td>
          <td>${d.buyer}</td>
          <td>${d.saleDate}</td>
          <td><span class="badge ${badgeCls}">${d.regState}</span></td>
          <td><a href="${carmaUrl}" target="_blank" class="carma-link">🔗 Open</a></td>
          <td class="doc-status-cell" id="docs-${d.pid}">
            <span style="color:#d1d5db;font-size:11px">Not scanned</span>
          </td>
          <td class="review-cell" id="rv-${d.pid}"></td>
        </tr>`;
      });

      html += `</tbody></table></div>`;
    }
    html += `</div>`;
    tables.innerHTML += html;
  }
  // Populate review cells after HTML is set
  selectedDeals.forEach(d => renderReviewCell(d));
}

// ═══════════════════════════════════════════════════════════════
// CARMA SCANNER
// ═══════════════════════════════════════════════════════════════
function stopCarmaScan() {
  if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
    chrome.runtime.sendMessage({ action: 'stopCarmaScan' }, () => {});
  }
  document.getElementById('stopBtn').style.display  = 'none';
  document.getElementById('carmaBtn').disabled = false;
  document.getElementById('scanStatusText').textContent = 'Stopped';
  showToast('⏹ Scan stopped');
}

function startCarmaScan() {
  if (!selectedDeals.length) return;
  if (typeof chrome === 'undefined' || !chrome.runtime) {
    showToast('⚠️ Open this tool via the Chrome extension — direct file:// mode cannot scan CARMA');
    return;
  }

  carmaResults = {};
  const section = document.getElementById('carmaScanSection');
  section.style.display = 'block';
  document.getElementById('carmaBtn').disabled = true;
  document.getElementById('stopBtn').style.display = 'inline-block';
  document.getElementById('scanProgressFill').style.width = '0%';
  document.getElementById('scanStatusText').textContent = 'Starting…';
  document.getElementById('scanSummary').textContent = '';
  document.getElementById('statDocs').textContent = '⏳';

  // Mark all deals as "scanning"
  selectedDeals.forEach(d => {
    const cell = document.getElementById(`docs-${d.pid}`);
    if (cell) cell.innerHTML = '<span class="doc-status-scanning">⏳ Scanning…</span>';
  });

  const deals = selectedDeals.map(d => ({ pid: d.pid, hub: d.hub, dlrState: d.dlrState, regState: d.regState }));

  chrome.runtime.sendMessage(
    { action: 'scanCarmaDeals', deals, senderTabId: myTabId },
    response => {
      document.getElementById('carmaBtn').disabled = false;
      document.getElementById('stopBtn').style.display = 'none';
      if (!response?.ok) {
        showToast('❌ CARMA scan failed — check that you are logged into CARMA in Chrome');
        document.getElementById('scanStatusText').textContent = 'Failed';
        return;
      }
      // Final tally
      const found   = Object.values(carmaResults).filter(r => r.status === 'ok').length;
      const missing = Object.values(carmaResults).filter(r => r.status === 'missing').length;
      const other   = Object.values(carmaResults).filter(r => !['ok','missing'].includes(r.status)).length;
      document.getElementById('statDocs').textContent = found;
      document.getElementById('scanStatusText').textContent = 'Complete';
      document.getElementById('scanSummary').innerHTML =
        `✅ ${found} with docs &nbsp;·&nbsp; ⚠️ ${missing} missing &nbsp;·&nbsp; ❓ ${other} unknown`;
      document.getElementById('scanProgressFill').style.width = '100%';
    }
  );
}

function handleCarmaProgress(msg) {
  const pct = Math.round((msg.current / msg.total) * 100);
  document.getElementById('scanProgressFill').style.width = pct + '%';
  document.getElementById('scanStatusText').textContent =
    `${msg.current}/${msg.total} · ${msg.hub || msg.pid}`;
}

function handleCarmaDealResult(msg) {
  const { pid, result } = msg;
  carmaResults[pid] = result;
  updateDocCell(pid, result);
}

// Short labels for each compliance doc type
const DOC_LABELS = {
  'registration packet':                    'Reg Packet',
  'record retention compliance doc':        'RR Compliance',
  'record retention compliance docs':       'RR Compliance',
  'vehicle inspection':                     'Vehicle Insp'
};
function docShortLabel(type) {
  return DOC_LABELS[(type||'').toLowerCase().replace(/\(s\)$/,'').trim()] || type;
}

function updateDocCell(pid, result) {
  const cell = document.getElementById(`docs-${pid}`);
  if (!cell) return;

  const carmaUrl = result.customerUrl || `https://carma.cvnacorp.com/research/search/${pid}`;

  if (result.status === 'ok' && result.docs?.length) {
    const div = document.createElement('div');
    div.className = 'doc-status-ok';

    result.docs.forEach(doc => {
      const label = docShortLabel(doc.type);
      const row   = document.createElement('div');
      row.style.cssText = 'display:flex;gap:4px;align-items:center;margin-bottom:3px';

      const makeBtn = (icon, actionLabel, action2) => {
        const btn = document.createElement('button');
        btn.className = 'doc-link';
        btn.title = `${actionLabel} ${doc.type}`;
        btn.innerHTML = `${icon} ${actionLabel === 'View' ? label : ''}`.trim();
        btn.addEventListener('click', () => {
          if (typeof chrome !== 'undefined' && chrome.runtime?.id) {
            btn.disabled = true;
            btn.innerHTML = '⏳';
            chrome.runtime.sendMessage(
              { action: 'openCarmaDocument', customerUrl: carmaUrl, docType: doc.type, action2 },
              () => { btn.disabled = false; btn.innerHTML = `${icon} ${actionLabel === 'View' ? label : ''}`; }
            );
          } else {
            window.open(carmaUrl, '_blank');
          }
        });
        return btn;
      };

      row.appendChild(makeBtn('📄', 'View', 'view'));
      row.appendChild(makeBtn('⬇', 'Download', 'download'));
      div.appendChild(row);
    });

    cell.innerHTML = '';
    cell.appendChild(div);
  } else if (result.status === 'missing') {
    cell.innerHTML = `<span class="doc-missing-badge">⚠️ None found</span>
      <br><a href="${carmaUrl}" target="_blank" class="doc-link" style="margin-top:3px;background:#fff1f2;color:#be123c">Open CARMA →</a>`;
  } else if (result.status === 'not_found') {
    cell.innerHTML = '<span style="color:#9ca3af;font-size:11px">Deal not found in CARMA</span>';
  } else if (result.status === 'timeout') {
    cell.innerHTML = `<a href="${carmaUrl}" target="_blank" class="doc-link">⏱️ Timed out — open manually</a>`;
  } else {
    cell.innerHTML = `<a href="${carmaUrl}" target="_blank" class="doc-link">❓ Open CARMA</a>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// COPY TO CLIPBOARD
// ═══════════════════════════════════════════════════════════════
function copyAll() {
  if (!selectedDeals.length) return;
  const rows = selectedDeals.map(d => {
    const carmaUrl = d.pid ? `https://carma.cvnacorp.com/research/search/${d.pid}` : '';
    return [d.weekOf, d.dlrState, d.hub, d.pid, d.vin, d.saleDate, d.regState, 'FALSE', '', carmaUrl].join('\t');
  });
  const text = rows.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    showToast('✅ Copied! Paste into your Google Sheet');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); document.body.removeChild(ta);
    showToast('✅ Copied!');
  });
}

// ═══════════════════════════════════════════════════════════════
// REVIEW RECORDS
// ═══════════════════════════════════════════════════════════════

function reviewKey(pid, weekOf) { return `${pid}_${weekOf}`; }

function saveReview(pid, weekOf, status, notes, dealData) {
  const key = reviewKey(pid, weekOf);
  reviewRecords[key] = { ...dealData, status, notes, savedAt: new Date().toISOString() };
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.set({ rrReviews: reviewRecords });
  }
}

function renderReviewCell(d) {
  const cell = document.getElementById(`rv-${d.pid}`);
  if (!cell) return;

  const weekOf  = d.weekOf || document.getElementById('weekOf').value;
  const key     = reviewKey(d.pid, weekOf);
  const rec     = reviewRecords[key] || {};
  const status  = rec.status || null;
  const notes   = rec.notes  || '';

  cell.innerHTML = '';

  // Button row
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:4px;margin-bottom:4px';

  const mkBtn = (label, cls) => {
    const b = document.createElement('button');
    b.className = cls; b.textContent = label; return b;
  };

  const passBtn = mkBtn('✅ Pass', status === 'pass' ? 'rv-btn rv-pass-on' : 'rv-btn rv-pass');
  const failBtn = mkBtn('❌ Fail', status === 'fail' ? 'rv-btn rv-fail-on' : 'rv-btn rv-fail');

  // Notes textarea
  const notesEl = document.createElement('textarea');
  notesEl.className    = 'rv-notes';
  notesEl.placeholder  = status === 'fail' ? 'Notes required for fail...' : 'Optional notes...';
  notesEl.value        = notes;
  notesEl.style.display = status !== null ? 'block' : 'none';

  // Row highlight
  const applyHighlight = (s) => {
    const tr = cell.closest('tr');
    if (!tr) return;
    tr.style.borderLeft = s === 'pass' ? '4px solid #22c55e' : s === 'fail' ? '4px solid #ef4444' : '';
  };
  applyHighlight(status);

  const commit = (newStatus) => {
    const docs = (carmaResults[d.pid]?.docs || []).map(x => x.type);
    saveReview(d.pid, weekOf, newStatus, notesEl.value, {
      pid: d.pid, weekOf, dlrState: d.dlrState,
      dealType: dealType === 'in' ? 'IS' : 'OOS',
      hub: d.hub, vin: d.vin, buyer: d.buyer,
      saleDate: d.saleDate, regState: d.regState, docs
    });
    renderReviewCell(d);
  };

  passBtn.addEventListener('click', () => commit(status === 'pass' ? null : 'pass'));
  failBtn.addEventListener('click', () => commit(status === 'fail' ? null : 'fail'));
  notesEl.addEventListener('change', () => {
    if (status) commit(status);
  });

  btnRow.appendChild(passBtn);
  btnRow.appendChild(failBtn);
  cell.appendChild(btnRow);
  cell.appendChild(notesEl);
}

// ── Records Panel ────────────────────────────────────────────────
function openRecordsPanel() {
  // Wire up panel controls once (guard with data attribute)
  const panel = document.getElementById('recordsPanel');
  if (!panel.dataset.wired) {
    panel.dataset.wired = '1';
    document.getElementById('rfState').addEventListener('change',  renderRecordsPanel);
    document.getElementById('rfWeek').addEventListener('change',   renderRecordsPanel);
    document.getElementById('rfStatus').addEventListener('change', renderRecordsPanel);
    document.getElementById('recordsCopyBtn').addEventListener('click',  copyRecords);
    document.getElementById('recordsClearBtn').addEventListener('click', clearWeekRecords);
    // Event delegation for delete buttons inside the tbody
    document.getElementById('recordsBody').addEventListener('click', e => {
      const btn = e.target.closest('.rv-del-btn');
      if (!btn) return;
      // First click → show inline confirm; second click on "Yes" → delete
      if (btn.dataset.confirming) {
        deleteReviewRecord(btn.dataset.key);
      } else {
        btn.dataset.confirming = '1';
        const orig = btn.innerHTML;
        btn.innerHTML = 'Delete? <strong>Yes</strong>';
        btn.style.cssText = 'background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;border-radius:5px;padding:3px 8px;font-size:11px;cursor:pointer';
        // Cancel on outside click
        const cancel = (ev) => {
          if (!btn.contains(ev.target)) {
            btn.innerHTML = orig;
            btn.style.cssText = '';
            delete btn.dataset.confirming;
            document.removeEventListener('click', cancel);
          }
        };
        setTimeout(() => document.addEventListener('click', cancel), 50);
      }
    });
  }
  renderRecordsPanel();
  panel.style.display = 'flex';
}

function renderRecordsPanel() {
  const panel    = document.getElementById('recordsBody');
  const stateF   = document.getElementById('rfState').value;
  const weekF    = document.getElementById('rfWeek').value;
  const statusF  = document.getElementById('rfStatus').value;

  // Populate week/state filter dropdowns if empty
  const allRecs  = Object.values(reviewRecords);
  const weeks    = [...new Set(allRecs.map(r => r.weekOf))].sort().reverse();
  const states   = [...new Set(allRecs.map(r => r.dlrState))].sort();

  const wkSel = document.getElementById('rfWeek');
  const curWk = wkSel.value;
  wkSel.innerHTML = '<option value="">All Weeks</option>' +
    weeks.map(w => `<option value="${w}" ${w===curWk?'selected':''}>${w}</option>`).join('');

  const stSel = document.getElementById('rfState');
  const curSt = stSel.value;
  stSel.innerHTML = '<option value="">All States</option>' +
    states.map(s => `<option value="${s}" ${s===curSt?'selected':''}>${s}</option>`).join('');

  const filtered = allRecs.filter(r => {
    if (stateF  && r.dlrState !== stateF) return false;
    if (weekF   && r.weekOf   !== weekF)  return false;
    if (statusF === 'pass'    && r.status !== 'pass') return false;
    if (statusF === 'fail'    && r.status !== 'fail') return false;
    if (statusF === 'pending' && r.status !== null)   return false;
    return true;
  }).sort((a,b) => (b.savedAt||'').localeCompare(a.savedAt||''));

  if (!filtered.length) {
    panel.innerHTML = '<tr><td colspan="9" style="text-align:center;color:#aaa;padding:24px">No records found</td></tr>';
    return;
  }

  panel.innerHTML = filtered.map(r => {
    const statusBadge = r.status === 'pass'
      ? `<span class="rv-badge-pass">✅ Pass</span>`
      : r.status === 'fail'
      ? `<span class="rv-badge-fail">❌ Fail</span>`
      : `<span class="rv-badge-none">—</span>`;
    const key = reviewKey(r.pid, r.weekOf);
    return `<tr>
      <td>${r.weekOf||''}</td>
      <td>${r.dlrState||''} ${r.dealType||''}</td>
      <td style="max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.hub||''}</td>
      <td style="font-family:monospace">${r.pid||''}</td>
      <td style="font-family:monospace;font-size:11px">${r.vin||''}</td>
      <td>${r.buyer||''}</td>
      <td>${statusBadge}</td>
      <td style="max-width:150px;font-size:11px;color:#555">${r.notes||''}</td>
      <td><button class="rv-del-btn" data-key="${key}">🗑</button></td>
    </tr>`;
  }).join('');

  // Update count
  document.getElementById('recordsCount').textContent = `${filtered.length} record${filtered.length!==1?'s':''}`;
}

function deleteReviewRecord(key) {
  delete reviewRecords[key];
  if (typeof chrome !== 'undefined' && chrome.storage) {
    chrome.storage.local.set({ rrReviews: reviewRecords });
  }
  renderRecordsPanel();
  // Refresh review cell if the deal is currently displayed
  const pid = key.split('_')[0];
  const d = selectedDeals.find(x => x.pid === pid);
  if (d) renderReviewCell(d);
}

function clearWeekRecords() {
  const weekF = document.getElementById('rfWeek').value;
  if (!weekF) { showToast('⚠️ Select a specific week first'); return; }

  const btn = document.getElementById('recordsClearBtn');
  if (btn.dataset.confirming) {
    // Confirmed — do the clear
    delete btn.dataset.confirming;
    btn.textContent = '🗑 Clear Week';
    btn.style.cssText = 'padding:7px 14px;font-size:12px;background:#fee2e2;color:#dc2626';
    Object.keys(reviewRecords).forEach(k => {
      if (reviewRecords[k].weekOf === weekF) delete reviewRecords[k];
    });
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ rrReviews: reviewRecords });
    }
    renderRecordsPanel();
    selectedDeals.forEach(d => renderReviewCell(d));
    showToast(`✅ Records cleared for week ${weekF}`);
  } else {
    // First click — show confirm state
    btn.dataset.confirming = '1';
    btn.textContent = `Clear ${weekF}? Confirm`;
    btn.style.cssText = 'padding:7px 14px;font-size:12px;background:#dc2626;color:white;font-weight:700;border-radius:8px;border:none;cursor:pointer';
    // Cancel if user clicks elsewhere
    const cancel = (ev) => {
      if (!btn.contains(ev.target)) {
        delete btn.dataset.confirming;
        btn.textContent = '🗑 Clear Week';
        btn.style.cssText = 'padding:7px 14px;font-size:12px;background:#fee2e2;color:#dc2626';
        document.removeEventListener('click', cancel);
      }
    };
    setTimeout(() => document.addEventListener('click', cancel), 50);
  }
}

function copyRecords() {
  const stateF  = document.getElementById('rfState').value;
  const weekF   = document.getElementById('rfWeek').value;
  const statusF = document.getElementById('rfStatus').value;
  const filtered = Object.values(reviewRecords).filter(r => {
    if (stateF  && r.dlrState !== stateF) return false;
    if (weekF   && r.weekOf   !== weekF)  return false;
    if (statusF === 'pass'    && r.status !== 'pass') return false;
    if (statusF === 'fail'    && r.status !== 'fail') return false;
    if (statusF === 'pending' && r.status !== null)   return false;
    return true;
  });
  const header = 'Week\tState\tType\tHub\tPID\tVIN\tBuyer\tSale Date\tReg State\tStatus\tNotes\tDocs\tReviewed At';
  const rows = filtered.map(r =>
    [r.weekOf, r.dlrState, r.dealType, r.hub, r.pid, r.vin, r.buyer,
     r.saleDate, r.regState, r.status||'', r.notes||'',
     (r.docs||[]).join('; '), r.savedAt||''].join('\t')
  );
  const text = [header, ...rows].join('\n');
  navigator.clipboard.writeText(text).then(() => showToast(`✅ Copied ${filtered.length} records`))
    .catch(() => { showToast('❌ Copy failed'); });
}

// ═══════════════════════════════════════════════════════════════
// AUTO-UPDATE CHECK
// ═══════════════════════════════════════════════════════════════
// Fetches version.json from GitHub. If a newer version exists,
// shows the update banner with a direct download link.
async function checkForUpdates() {
  if (typeof chrome === 'undefined' || !chrome.runtime?.getManifest) return;
  const current = chrome.runtime.getManifest().version;
  try {
    const resp = await fetch(
      'https://raw.githubusercontent.com/aaronfain/record-retention-extension/main/version.json',
      { cache: 'no-store' }
    );
    if (!resp.ok) return;
    const data = await resp.json();
    if (isNewerVersion(data.version, current)) {
      const banner  = document.getElementById('updateBanner');
      document.getElementById('updateVersion').textContent     = `v${data.version}`;
      document.getElementById('updateNotes').textContent       = data.releaseNotes || '';
      document.getElementById('updateDownloadBtn').href        = data.downloadUrl;
      banner.style.display = 'flex';
    }
  } catch (_) {
    // Silently fail — no GitHub access or offline
  }
}

function isNewerVersion(latest, current) {
  const parse = v => (v || '0.0.0').split('.').map(Number);
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  return la > ca || (la === ca && lb > cb) || (la === ca && lb === cb && lc > cc);
}

// ═══════════════════════════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════════════════════════
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3500);
}
