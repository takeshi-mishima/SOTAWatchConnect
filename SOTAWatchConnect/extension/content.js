/* 
 * SOTAWatch Connect
 *
 * Browser extension that sets rig frequency and mode based on the
 * SOTAwatch3 spots list and the POTA (pota.app) spots list.
 *
 * (c) 2026 Takeshi Mishima JK1VUZ
 */

// --- USER CONFIGURATION ---
const BRIDGE_PORT = 5001;
const STORAGE_KEY = 'activeRig'; // must match popup.js

console.log("SOTAWatch Connect: monitoring for rig control...");

async function sendToRig(freq, mode) {
    // Which rig to target is chosen in the extension popup and
    // stored in chrome.storage.local (see popup.js).
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const rigName = stored[STORAGE_KEY];

    if (!rigName) {
        alert("SOTAWatch Connect: アクティブなリグが選択されていません。\n拡張機能アイコンのポップアップからリグを選択してください。");
        return;
    }

    console.log(`[RIGCTL] Sending to Bridge... Rig: ${rigName}, Freq: ${freq}, Mode: ${mode}`);

    // Endpoint
    fetch(`http://localhost:${BRIDGE_PORT}/set_rig`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rig: rigName, freq: freq, mode: mode })
    })
    .then(async res => {
        // The bridge returns JSON { success, message } even on errors
        // (e.g. 503 when rigctld fails), so show its message.
        let json = null;
        try {
            json = await res.json();
        } catch (e) {
            // non-JSON body; fall back to the HTTP status below
        }
        if (!res.ok || !json || !json.success) {
            const msg = (json && json.message) || `HTTP error! status: ${res.status}`;
            console.error("Bridge Error:", msg);
            alert(`SOTAWatch Connect: Rig control error.\n${msg}`);
            return;
        }
        console.log("Success:", json.message);
    })
    .catch(err => {
        console.error('Bridge Connection Error:', err.message);
        const errorMsg = err.message || "Unknown Error";
        alert(`SOTAWatch Connect: Can not connect bridge.\n${errorMsg}`);
    });
}

/* --------------------------------------------------------------------
 * SOTAwatch3 (sotawatch.sota.org.uk)
 * Mode badges (e.g. "CW", "SSB") in the spot table become clickable.
 * ------------------------------------------------------------------ */
function injectSotaButtons() {
    // Find the element with "badge" class that displays the mode
    const badges = document.querySelectorAll('.badge:not(.rig-ctl-processed)');

    badges.forEach(badge => {
        const modeText = badge.innerText.trim();
        
        // Validate mode string (Note: "Other" is not supported)
        if (/^(AM|CW|DATA|FM|SSB)$/.test(modeText)) {	// "DV" and "Others" are not implementes yet.
            
            const row = badge.closest('tr');
            if (!row) return;

            const rowText = row.innerText;
            // Some languages (de, ca, nl, ...) use a decimal comma, e.g. "10,1109"
            const freqMatch = rowText.match(/(\d+[.,]\d+)/);
            const freqText = freqMatch ? freqMatch[1].replace(',', '.') : null;

            if (freqText) {
                badge.classList.add('rig-ctl-button');
                badge.classList.add('rig-ctl-processed');
                badge.title = `Set ${freqText}MHz / ${modeText} to the rig`;

                badge.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();

                    // visual feedback (flash)
                    badge.classList.add('rig-flash');
                    setTimeout(() => {
                        badge.classList.remove('rig-flash');
                    }, 150);
                    
                    sendToRig(freqText, modeText);
                };
            }
        }
    });
}

/* --------------------------------------------------------------------
 * POTA (pota.app) - Vuetify 3 version of the site
 * Spots are shown in several layouts, and the freq/mode is made
 * clickable in each of them:
 *
 *  - Card view:   <div class="v-list-item">
 *                   <div class="v-list-item__prepend"><i class="v-icon"/></div>
 *                   <div class="v-list-item__content">7035 kHz (CW)</div>
 *                 </div>
 *                 The antenna icon becomes the button.
 *  - Table / List view: <tr> ... <td>7074</td><td>FT8</td> ...
 *                 Both the freq cell and the mode cell become buttons.
 *                 (The header labels are localized and the column order
 *                 differs between Table and List, so the cells are found
 *                 by content: a kHz number followed by a mode cell.)
 *  - Map popup:   <div class="spot-popup__line">
 *                   <i class="v-icon"/>14052.5 kHz (CW) · 20M</div>
 *                 The antenna icon becomes the button.
 *
 * The freq/mode is read from the page when the button is clicked (not
 * when it is attached), because POTA re-renders the list periodically
 * and may reuse the same element for a different spot.
 *
 * Mode is omitted from the text for plain voice spots, so it
 * defaults to SSB when no "(MODE)" suffix is present. "SSB" is sent
 * as-is (same as the SOTAwatch side) and the bridge decides LSB/USB by
 * frequency. Any alphanumeric mode (CW, FM, FT4, FT8, ...) is passed
 * through as-is, so new modes need no code change here.
 * ------------------------------------------------------------------ */

// POTA displays kHz, but the bridge expects MHz (same as the SOTAwatch side).
function potaToRigArgs(freqKHz, mode) {
    return {
        freq: (parseFloat(freqKHz) / 1000).toFixed(4),
        mode: mode ? mode.toUpperCase() : 'SSB'
    };
}

// e.g. "21058.0 kHz (CW)", "18148 kHz", "14052.5 kHz (CW) · 20M"
function potaParseText(text) {
    const m = text.trim().match(/^([\d.]+)\s*kHz(?:\s*\(([A-Za-z0-9]+)\))?/);
    return m ? potaToRigArgs(m[1], m[2]) : null;
}

// Make the elements clickable. resolve() returns {freq, mode} (or null)
// from the current page content.
function bindRigButton(targets, resolve) {
    targets.forEach(el => {
        const setTitle = () => {
            const r = resolve();
            el.title = r ? `Set ${r.freq}MHz / ${r.mode} to the rig` : '';
        };
        setTitle();
        el.onmouseenter = setTitle;

        el.classList.add('rig-ctl-button');
        el.classList.add('rig-ctl-processed');

        el.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();

            const r = resolve();
            if (!r) return;

            // visual feedback (flash)
            el.classList.add('rig-flash');
            setTimeout(() => {
                el.classList.remove('rig-flash');
            }, 150);

            sendToRig(r.freq, r.mode);
        };
    });
}

// Card view
function injectPotaCards() {
    document.querySelectorAll('.v-list-item').forEach(item => {
        const prepend = item.querySelector(':scope > .v-list-item__prepend');
        const button = prepend && (prepend.querySelector('.v-icon') || prepend);
        if (!button || button.classList.contains('rig-ctl-processed')) return;

        const resolve = () => {
            const content = item.querySelector(':scope > .v-list-item__content');
            return content ? potaParseText(content.textContent) : null;
        };
        if (!resolve()) return;

        bindRigButton([button], resolve);
    });
}

// Table / List view
function potaFindFreqModeCells(row) {
    const cells = Array.from(row.children);

    // Only rows of spot tables (they contain a park reference, e.g. "US-1833")
    if (!cells.some(td => /^[A-Z0-9]{1,3}-\d{4,6}$/.test(td.textContent.trim()))) return null;

    for (let i = 0; i < cells.length - 1; i++) {
        if (/^\d{3,6}(\.\d+)?$/.test(cells[i].textContent.trim()) &&
            /^[A-Za-z0-9]{2,6}$/.test(cells[i + 1].textContent.trim())) {
            return { freqCell: cells[i], modeCell: cells[i + 1] };
        }
    }
    return null;
}

function injectPotaTables() {
    document.querySelectorAll('table tbody tr').forEach(row => {
        const found = potaFindFreqModeCells(row);
        if (!found) return;

        const { freqCell, modeCell } = found;
        if (freqCell.classList.contains('rig-ctl-processed') &&
            modeCell.classList.contains('rig-ctl-processed')) return;

        const resolve = () => {
            const cur = potaFindFreqModeCells(row);
            return cur ? potaToRigArgs(cur.freqCell.textContent.trim(),
                                       cur.modeCell.textContent.trim()) : null;
        };
        bindRigButton([freqCell, modeCell], resolve);
    });
}

// Map popup
function injectPotaPopups() {
    document.querySelectorAll('.spot-popup__line').forEach(line => {
        const button = line.querySelector('.v-icon');
        if (!button || button.classList.contains('rig-ctl-processed')) return;

        const resolve = () => potaParseText(line.textContent);
        if (!resolve()) return;

        bindRigButton([button], resolve);
    });
}

function injectPotaButtons() {
    injectPotaCards();
    injectPotaTables();
    injectPotaPopups();
}

function injectAllButtons() {
    injectSotaButtons();
    injectPotaButtons();
}

// Monitor for dynamic content (SOTAwatch3 / POTA are both SPA-ish and
// re-render their spot lists periodically)
const observer = new MutationObserver(() => injectAllButtons());
observer.observe(document.body, { childList: true, subtree: true });

// Initial run
injectAllButtons();
