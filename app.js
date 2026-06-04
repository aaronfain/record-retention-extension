// ═══════════════════════════════════════════════════════════════
// BACKGROUND SERVICE WORKER
// Opens the tool in a tab; handles CARMA scanning
// ═══════════════════════════════════════════════════════════════

// Open the tool tab when the extension icon is clicked
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

// ── Message router ───────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scanCarmaDeals') {
    scanAllDeals(msg.deals, msg.senderTabId)
      .then(results => sendResponse({ ok: true, results }))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.action === 'fetchHighbeamExcel') {
    fetchHighbeamData(msg.state, msg.dateFrom, msg.dateTo, msg.senderTabId)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.action === 'openCarmaDocument') {
    openCarmaDocument(msg.customerUrl, msg.docType, msg.action2 || 'view')
      .then(() => sendResponse({ ok: true }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }
  if (msg.action === 'stopCarmaScan') {
    chrome.storage.local.set({ carmaScanStop: true });
    sendResponse({ ok: true });
    return true;
  }
});

// ── Highbeam auto-fetch ──────────────────────────────────────────
async function fetchHighbeamData(state, dateFrom, dateTo, senderTabId) {
  let tabId = null;
  try {
    safeSend(senderTabId, { action: 'highbeamProgress', state, status: 'opening' });

    const dateParam = encodeURIComponent(`min:${dateFrom},max:${dateTo}`);
    const url = `https://highbeam.carvana.net/dashboards/police-book-0d07164a?dealer_license_state=${state}&sale_date=${dateParam}`;

    // Open tab visibly so user can see it (and click manually if auto-click fails)
    const tab = await chrome.tabs.create({ url, active: true });
    tabId = tab.id;

    safeSend(senderTabId, { action: 'highbeamProgress', state, status: 'loading' });
    await waitForTabLoad(tabId, 30000);
    await sleep(4000); // wait for React dashboard to render

    // Inject the blob interceptor + auto-click attempt into the page
    safeSend(senderTabId, { action: 'highbeamProgress', state, status: 'clicking' });
    const [setupResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: setupHighbeamCapture,
      world: 'MAIN'
    });

    const autoClicked = setupResult?.result?.clicked;
    console.log(`[HB] ${state} — auto-click: ${autoClicked ? 'yes' : 'no'}`, setupResult?.result);

    if (!autoClicked) {
      // Button not found — ask user to click it manually (tab is already visible)
      safeSend(senderTabId, {
        action: 'highbeamProgress', state, status: 'manual',
        buttons: setupResult?.result?.buttons // debug info
      });
    } else {
      safeSend(senderTabId, { action: 'highbeamProgress', state, status: 'waiting' });
    }

    // Poll window.__hbFileData every second for up to 90 s
    for (let i = 0; i < 90; i++) {
      await sleep(1000);
      const [poll] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => window.__hbFileData || null,
        world: 'MAIN'
      });
      if (poll?.result?.data) {
        return { data: poll.result.data, type: poll.result.type, state };
      }
    }

    throw new Error('No file downloaded within 90 seconds. Make sure you clicked the export button in Highbeam.');

  } finally {
    if (tabId) chrome.tabs.remove(tabId).catch(() => {});
  }
}

// ── Injected into Highbeam (MAIN world) ─────────────────────────
// State machine: find_export → panel_open → click_download_tab
//                → select_excel → click_dl_excel → done
function setupHighbeamCapture() {
  window.__hbFileData = null;

  // ── Blob intercept ───────────────────────────────────────────────
  const origCreate = URL.createObjectURL;
  URL.createObjectURL = function(obj) {
    const url = origCreate.call(this, obj);
    if (!window.__hbFileData && obj instanceof Blob && obj.size > 500) {
      URL.createObjectURL = origCreate;
      const reader = new FileReader();
      reader.onload = e => {
        window.__hbFileData = { data: e.target.result.split(',')[1], type: obj.type };
      };
      reader.readAsDataURL(obj);
    }
    return url;
  };

  // ── Helpers ──────────────────────────────────────────────────────
  const els   = (sel) => [...document.querySelectorAll(sel ||
    'button,[role="button"],[role="tab"],[role="menuitem"],[role="option"],a,li,option,span,div')];
  const txt   = el => [el.textContent.trim(), el.title||'',
                       el.getAttribute('aria-label')||''].join(' ').toLowerCase();
  const find  = (...kw) => els().find(el => kw.some(k => txt(el).includes(k)));
  const bodyT = ()  => (document.body.innerText || document.body.textContent || '').toLowerCase();

  // Export panel is open — require specific text unique to the export panel.
  // "schedule" alone is too broad (other Highbeam panels also contain that word).
  const panelOpen = () => {
    const t = bodyT();
    return t.includes('download excel') ||
           t.includes('excel (.xlsx)')  ||
           // "Send / Schedule" tab text is unique to the export panel
           t.includes('send / schedule') ||
           t.includes('send/schedule')   ||
           // Format dropdown only exists in export panel
           (t.includes('format') && t.includes('download') && t.includes('send'));
  };

  // ── State machine ────────────────────────────────────────────────
  let phase    = 'find_export';
  let exportEl = null;
  const SKIP   = new Set(['settings','published','main','duplicate to edit',
                           'connections','documents','docs','state abbreviation','column options']);

  // Icon buttons in DOM order. Export button is consistently #7 (index 6).
  // Start there directly; fall back to earlier buttons if the page changes.
  const iconBtns = els('button,[role="button"]').filter(el => {
    const t = txt(el);
    if (t.length > 25) return false;
    if (SKIP.has(t.trim())) return false;
    if (el.closest('table,thead,tbody,tr,td')) return false;
    return true;
  });
  let iconIdx = Math.min(6, Math.max(0, iconBtns.length - 1)); // start at #7 (index 6)

  // Find the export popout/dialog (scoped search for Format dropdown)
  const getPanel = () =>
    document.querySelector('[role="dialog"]') ||
    [...document.querySelectorAll('div,aside,section')].find(el => {
      if (el === document.body || el === document.documentElement) return false;
      const t = (el.innerText || el.textContent || '').toLowerCase();
      return (t.includes('send / schedule') || t.includes('send/schedule') ||
              t.includes('download excel')) && el.children.length > 1;
    });

  const tick = () => {
    if (window.__hbFileData || phase === 'done') return;

    // ── Phase 1: find and click the Export icon ──────────────────
    if (phase === 'find_export') {
      if (panelOpen()) {
        console.log('[HB] Export panel detected → moving to step 2');
        phase = 'click_download_tab';
        setTimeout(tick, 400);
        return;
      }
      // Try text/aria match first
      const byText = els('button,[role="button"],a')
        .find(el => txt(el).includes('export') && !txt(el).includes('duplicate'));
      if (byText) {
        exportEl = byText;
        console.log('[HB] Clicking Export (text match):', byText.textContent.trim()||byText.title);
        byText.click();
        setTimeout(tick, 1500);
        return;
      }
      // Try next icon button (reversed — rightmost first)
      if (iconIdx >= iconBtns.length) { console.log('[HB] No more buttons to try'); return; }
      const btn = iconBtns[iconIdx++];
      exportEl = btn;
      console.log('[HB] Trying icon btn', iconIdx, '/', iconBtns.length,
                  '| class:', btn.className.slice(0, 80));
      btn.click();
      setTimeout(tick, 1500);
      return;
    }

    // ── Phase 2: click "Download" tab ───────────────────────────
    if (phase === 'click_download_tab') {
      const dlTab = els('button,[role="button"],[role="tab"],a,span,div')
        .find(el => el !== exportEl && el.textContent.trim().toLowerCase() === 'download');
      if (dlTab) {
        console.log('[HB] Clicking Download tab');
        dlTab.click();
      } else {
        console.log('[HB] Download tab not found — may already be selected');
      }
      phase = 'select_excel';
      setTimeout(tick, 600);
      return;
    }

    // ── Phase 3: open Format dropdown, then select Excel (.xlsx) ──
    if (phase === 'select_excel') {
      // IMPORTANT: search for the Format combobox WITHIN the export panel/dialog,
      // not globally — the main page has other comboboxes (e.g. page-size = 100)
      // that would otherwise be matched first.
      const panel = getPanel();
      console.log('[HB] Export panel element:', panel ? panel.tagName + ' ' + panel.className.slice(0,50) : 'not found');

      const ctx = panel || document; // scope to panel if found

      // Handle native <select> within panel
      const sel = ctx.querySelector('select');
      if (sel) {
        const xlOpt = [...sel.options]
          .find(o => (o.text + o.value).toLowerCase().includes('excel') ||
                     (o.text + o.value).toLowerCase().includes('xlsx'));
        if (xlOpt && sel.value !== xlOpt.value) {
          console.log('[HB] <select> → Excel:', xlOpt.text);
          sel.value = xlOpt.value;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
          phase = 'click_dl_excel';
          setTimeout(tick, 600);
          return;
        }
      }

      // Find the FORMAT dropdown specifically — not the Widget dropdown.
      // The panel has two dropdowns: Widget ("Police Book") and Format ("CSV").
      // Locate by the "FORMAT" label, then grab its sibling combobox.
      let formatTrigger = null;

      // Strategy A: find element with text "FORMAT" or "Format", then get adjacent combobox
      const allCtxEls = [...ctx.querySelectorAll('*')];
      const formatLabel = allCtxEls.find(el =>
        el.childElementCount === 0 &&
        (el.textContent.trim().toUpperCase() === 'FORMAT' ||
         el.textContent.trim().toLowerCase() === 'format'));
      if (formatLabel) {
        const container = formatLabel.parentElement || formatLabel.closest('div,section');
        formatTrigger = container?.querySelector('[role="combobox"],[aria-haspopup="listbox"]') ||
                        container?.querySelector('button,[role="button"]');
        console.log('[HB] Found FORMAT label, adjacent trigger:', formatTrigger?.textContent.trim().slice(0,20));
      }

      // Strategy B: find combobox showing a format value (csv, pdf, excel) — not "Police Book"
      if (!formatTrigger) {
        const allCombos = [...ctx.querySelectorAll('[role="combobox"],[aria-haspopup="listbox"]')];
        console.log('[HB] Comboboxes in panel:', allCombos.map(el => el.textContent.trim()).join(' | '));
        formatTrigger = allCombos.find(el => {
          const t = txt(el);
          return t.includes('csv') || t.includes('pdf') || t.includes('png') ||
                 t.includes('excel') || t.includes('xlsx');
        }) || allCombos[1]; // fallback: second combobox (Format is after Widget)
      }

      // Strategy C: any button inside panel whose text is exactly a format name
      if (!formatTrigger) {
        formatTrigger = [...ctx.querySelectorAll('button,[role="button"]')].find(el => {
          if (el === exportEl) return false;
          const t = el.textContent.trim().toLowerCase();
          return t === 'csv' || t === 'pdf' || t === 'png' || t === 'excel';
        });
      }

      if (formatTrigger) {
        console.log('[HB] Opening Format dropdown (in panel):', formatTrigger.textContent.trim().slice(0, 40));
        formatTrigger.click();
        setTimeout(() => {
          // Options appear outside panel in a portal — search whole document
          const xlOpt = [...document.querySelectorAll('[role="option"],[role="menuitem"],li')]
            .find(el => el !== exportEl && el !== formatTrigger &&
                        (txt(el).includes('excel (.xlsx)') ||
                         txt(el).includes('excel') ||
                         txt(el).includes('xlsx')));
          if (xlOpt) {
            console.log('[HB] Selecting Excel:', xlOpt.textContent.trim());
            xlOpt.click();
          } else {
            console.log('[HB] Excel option not found after opening Format dropdown');
          }
          phase = 'click_dl_excel';
          setTimeout(tick, 600);
        }, 500);
        return;
      }

      // Fallback: Excel already visible directly
      const xlDirect = [...(panel || document).querySelectorAll('button,[role="button"],[role="option"],li')]
        .find(el => el !== exportEl && (txt(el).includes('excel (.xlsx)') ||
              (txt(el).includes('excel') && txt(el).includes('xlsx'))));
      if (xlDirect) {
        console.log('[HB] Excel direct:', xlDirect.textContent.trim());
        xlDirect.click();
      } else {
        console.log('[HB] Format dropdown not found in panel — skipping');
      }
      phase = 'click_dl_excel';
      setTimeout(tick, 600);
      return;
    }

    // ── Phase 4: click "Download Excel" ─────────────────────────
    if (phase === 'click_dl_excel') {
      const dlExcel = els('button,[role="button"]')
        .find(el => txt(el).includes('download excel') || txt(el).includes('download xlsx'));
      if (dlExcel) {
        console.log('[HB] Clicking Download Excel:', dlExcel.textContent.trim());
        phase = 'done';
        dlExcel.click();
      } else {
        console.log('[HB] Download Excel button not found yet — retrying…');
        setTimeout(tick, 600); // retry
      }
    }
  };

  setTimeout(tick, 300);
  return { started: true, iconCount: iconBtns.length };
}

// ── Open CARMA document — view or download ───────────────────────
// Opens the customer page and clicks View (embedded viewer) or Download.
async function openCarmaDocument(customerUrl, docType, action) {
  const tab = await chrome.tabs.create({ url: customerUrl, active: true });
  await waitForTabLoad(tab.id, 20000);
  await sleep(2000); // let React render the documents table

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: clickDocumentAction,
    args: [docType, action || 'view'],
    world: 'MAIN'
  });
}

// Injected into CARMA customer page.
// action = 'view'  → clicks the View button (embedded PDF viewer)
// action = 'download' → clicks the Download button (saves PDF to disk)
function clickDocumentAction(docType, action) {
  const targetNorm = docType.toLowerCase().replace(/\(s\)$/, '').trim();

  return new Promise(resolve => {
    let attempts = 0;
    const poll = () => {
      attempts++;
      const allTds = document.querySelectorAll('td');
      for (const td of allTds) {
        const cellNorm = td.textContent.trim().toLowerCase().replace(/\(s\)$/, '').trim();
        if (cellNorm !== targetNorm) continue;

        const row = td.closest('tr');
        if (!row) continue;

        const allBtns = [...row.querySelectorAll('button,[role="button"],a')];
        let btn;
        if (action === 'download') {
          btn = allBtns.find(el => {
            const t = (el.textContent.trim()+(el.title||'')+(el.getAttribute('aria-label')||'')).toLowerCase();
            return t.includes('download');
          });
        }
        if (!btn) {
          // For 'view' or fallback: prefer View, accept Open, last resort Download
          btn = allBtns.find(el => {
            const t = (el.textContent.trim()+(el.title||'')+(el.getAttribute('aria-label')||'')).toLowerCase();
            return t.includes('view') || t.includes('open');
          }) || allBtns.find(el => {
            const t = (el.textContent.trim()+(el.title||'')+(el.getAttribute('aria-label')||'')).toLowerCase();
            return t.includes('download');
          });
        }

        if (btn) {
          btn.click();
          resolve(true);
          return;
        }
      }

      if (attempts < 24) setTimeout(poll, 500);
      else resolve(false);
    };
    setTimeout(poll, 1000);
  });
}


// ── CARMA scanning ───────────────────────────────────────────────
async function scanAllDeals(deals, senderTabId) {
  const results = {};
  await chrome.storage.local.set({ carmaScanStop: false }); // reset stop flag

  for (let i = 0; i < deals.length; i++) {
    const deal = deals[i];

    // Check if user requested stop
    const stored = await chrome.storage.local.get('carmaScanStop');
    if (stored.carmaScanStop) {
      console.log('[CARMA] Scan stopped by user');
      break;
    }

    // Report progress back to the UI tab
    safeSend(senderTabId, {
      action: 'carmaProgress',
      current: i + 1,
      total: deals.length,
      pid: deal.pid,
      hub: deal.hub
    });

    results[deal.pid] = await scanOneDeal(deal.pid);

    // Send individual result as soon as it arrives
    safeSend(senderTabId, {
      action: 'carmaDealResult',
      pid: deal.pid,
      result: results[deal.pid]
    });
  }

  return results;
}

async function scanOneDeal(pid) {
  let tabId = null;
  try {
    console.log(`[CARMA] Starting scan for PID ${pid}`);

    // Step 1 — open the CARMA search page in a background tab
    const tab = await chrome.tabs.create({
      url: `https://carma.cvnacorp.com/research/search/${pid}`,
      active: false
    });
    tabId = tab.id;
    console.log(`[CARMA] Tab ${tabId} opened for PID ${pid}`);

    await waitForTabLoad(tabId, 20000);
    await sleep(800); // let React settle on search page

    // Step 2 — extract the "View Customer" link from search results
    const [searchResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractViewCustomerUrl
    });
    console.log(`[CARMA] PID ${pid} search result:`, JSON.stringify(searchResult?.result));

    if (!searchResult?.result?.customerUrl) {
      console.log(`[CARMA] PID ${pid} — no customer URL found (deal not in CARMA)`);
      return { status: 'not_found', docs: [], pid };
    }

    // Step 3 — navigate to customer details
    await chrome.tabs.update(tabId, { url: searchResult.result.customerUrl });
    await waitForTabLoad(tabId, 20000);
    await sleep(1200); // extra settle time for React details page
    console.log(`[CARMA] PID ${pid} — customer page loaded, extracting docs`);

    // Step 4 — wait for documents table and extract Registration Packet
    const [docsResult] = await chrome.scripting.executeScript({
      target: { tabId },
      func: extractRegistrationDocs,
      args: [pid]
    });
    console.log(`[CARMA] PID ${pid} docs result:`, JSON.stringify(docsResult?.result));

    return docsResult?.result ?? { status: 'error', docs: [], pid };

  } catch (err) {
    console.warn(`[CARMA] Error for PID ${pid}:`, err.message);
    return { status: 'error', docs: [], pid, error: err.message };
  } finally {
    if (tabId) {
      chrome.tabs.remove(tabId).catch(() => {});
    }
  }
}

// ── Injected into CARMA search page ─────────────────────────────
// Polls until React renders the "View Customer" link (up to 15 s)
function extractViewCustomerUrl() {
  return new Promise(resolve => {
    let attempts = 0;
    const MAX = 30;

    const poll = () => {
      attempts++;
      const link = document.querySelector('a[href*="/research/customer/"]');
      if (link) {
        const href = link.getAttribute('href');
        return resolve({
          customerUrl: href.startsWith('http') ? href : 'https://carma.cvnacorp.com' + href
        });
      }
      // Also check for "no results" state so we don't wait the full 15 s
      const bodyText = document.body?.innerText || '';
      const noResults = bodyText.includes('No results') || bodyText.includes('0 results') ||
                        (bodyText.includes('Customers (0)'));
      if (noResults) return resolve({ customerUrl: null });

      if (attempts < MAX) setTimeout(poll, 500);
      else resolve({ customerUrl: null });
    };

    setTimeout(poll, 800); // initial wait for React first paint
  });
}

// ── Injected into CARMA customer details page ────────────────────
// Scans for three compliance doc types:
//   • Registration Packet
//   • Record Retention Compliance Doc(s)
//   • Vehicle Inspection
function extractRegistrationDocs(pid) {
  const TARGET_TYPES = [
    'Registration Packet',
    'Record Retention Compliance Doc',
    'Record Retention Compliance Docs',
    'Vehicle Inspection'
  ];
  const normalize = s => (s||'').trim().toLowerCase().replace(/\(s\)$/, '').trim();
  const targetNorm = TARGET_TYPES.map(normalize);

  return new Promise(resolve => {
    let attempts = 0;
    const MAX = 32; // up to ~16 s

    const poll = () => {
      attempts++;
      const allTds = document.querySelectorAll('td');

      // Table "loaded" = enough real data cells present
      const meaningfulTds = [...allTds].filter(td => td.textContent.trim().length > 1);
      const tableLoaded   = meaningfulTds.length >= 4 ||
                            (attempts >= 16 && allTds.length > 0);

      const targetDocs = []; // Registration Packet / RR Compliance / Vehicle Inspection
      const otherDocs  = [];
      const seenTypes  = new Set(); // deduplicate by type

      for (const td of allTds) {
        const cellText = td.textContent.trim();
        if (!cellText) continue;

        const row = td.closest('tr');
        if (!row) continue;

        // ── Strategy 1: React fiber ──────────────────────────────────
        const fiberKey = Object.keys(row).find(k => k.startsWith('__reactProps')) ||
                         Object.keys(row).find(k => k.startsWith('__reactFiber'));

        if (fiberKey) {
          try {
            const props = row[fiberKey];
            const candidates = [];
            const children = props?.children;
            if (Array.isArray(children)) {
              for (const child of children) {
                const orig = child?.props?.cell?.row?.original
                          || child?.props?.row?.original;
                if (orig) candidates.push(orig);
              }
            }
            const directOrig = props?.cell?.row?.original || props?.row?.original;
            if (directOrig) candidates.push(directOrig);

            for (const orig of candidates) {
              if (!orig?.type) continue;

              // Build direct PDF URL — use orig.url if present, otherwise
              // construct from the known CARMA document API endpoint using the doc ID
              const pdfUrl = orig.url ||
                (orig.id ? `https://apik.carvana.io/customercare/documentmanager/api/v1/Documents/GetDocument/${orig.id}/file` : null);

              // Log fields on first target doc found (helps debug URL issues)
              if (targetNorm.includes(normalize(orig.type))) {
                console.log('[CARMA] Doc fields:', Object.keys(orig).join(', '));
                console.log('[CARMA] Doc id:', orig.id, '| url:', orig.url, '| constructed:', pdfUrl);
              }

              const doc = {
                id:         orig.id,
                name:       orig.name,
                type:       orig.type,
                uploadedOn: orig.uploadedOn,
                url:        pdfUrl
              };
              const n = normalize(orig.type);
              if (targetNorm.includes(n) && !seenTypes.has(n)) {
                seenTypes.add(n);
                targetDocs.push(doc);
              } else if (!targetNorm.includes(n)) {
                otherDocs.push(doc);
              }
              break;
            }
          } catch (_) {}
        }

        // ── Strategy 2: text-based fallback ─────────────────────────
        // If a td literally contains one of our target type names, record it
        const cellNorm = normalize(cellText);
        if (targetNorm.includes(cellNorm) && !seenTypes.has(cellNorm)) {
          seenTypes.add(cellNorm);
          const links = row.querySelectorAll('a[href]');
          targetDocs.push({
            id: null,
            name: cellText,
            type: cellText,
            uploadedOn: null,
            url: links.length ? links[0].getAttribute('href') : null
          });
        }
      }

      if (targetDocs.length > 0) {
        return resolve({ status: 'ok', docs: targetDocs, otherDocs, pid,
                         customerUrl: window.location.href });
      }

      if (tableLoaded) {
        return resolve({ status: 'missing', docs: [], otherDocs, pid,
                         customerUrl: window.location.href });
      }

      if (attempts < MAX) {
        setTimeout(poll, 500);
      } else {
        resolve({ status: 'timeout', docs: [], otherDocs: [], pid,
                  customerUrl: window.location.href });
      }
    };

    setTimeout(poll, 1000);
  });
}

// ── Helpers ──────────────────────────────────────────────────────
function waitForTabLoad(tabId, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Tab load timed out'));
    }, timeoutMs);

    const listener = (id, info) => {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function safeSend(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}
