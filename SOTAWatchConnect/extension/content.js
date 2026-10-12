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
            const freqMatch = rowText.match(/(\d+\.\d+)/);
            const freqText = freqMatch ? freqMatch[1] : null;

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
 * POTA (pota.app)
 * Each spot card is a Vuetify v-list-item:
 *   <div class="v-list-item">
 *     <div class="v-list-item__action"><icon/></div>
 *     <div class="v-list-item__content">21058.0 kHz (CW)</div>
 *   </div>
 * The freq/mode icon (v-list-item__action) becomes clickable.
 * Mode is omitted from the text for plain voice spots, so it
 * defaults to SSB when no "(MODE)" suffix is present.
 * ------------------------------------------------------------------ */
function injectPotaButtons() {
    const contents = document.querySelectorAll('.v-list-item__content:not(.rig-ctl-processed)');

    contents.forEach(content => {
        const text = content.innerText.trim();

        // e.g. "21058.0 kHz (CW)"  or  "18148 kHz"
        const match = text.match(/^([\d.]+)\s*kHz(?:\s*\(([A-Za-z0-9]+)\))?$/);
        if (!match) return;

        // Mark processed even if we bail out below, so we don't
        // re-check this node on every DOM mutation.
        content.classList.add('rig-ctl-processed');

        const listItem = content.closest('.v-list-item');
        if (!listItem) return;

        const action = listItem.querySelector('.v-list-item__action');
        if (!action) return;

        const freqKHz = match[1];

        // Bridge expects MHz (same convention as the SOTAwatch side),
        // POTA displays kHz, so convert.
        const freqMHz = parseFloat(freqKHz) / 1000;
        const freqText = freqMHz.toFixed(4);

        // Mode is omitted from the text for plain voice spots.
        // Send "SSB" as-is (same as the SOTAwatch side) and let the
        // bridge decide LSB/USB by frequency - don't duplicate that
        // logic here. Explicit modes seen in the wild: FM, CW, FT4,
        // FT8 (any alphanumeric mode text in parentheses is passed
        // through as-is, so new modes need no code change here).
        const modeText = match[2] ? match[2].toUpperCase() : 'SSB';

        action.classList.add('rig-ctl-button');
        action.classList.add('rig-ctl-processed');
        action.title = `Set ${freqText}MHz / ${modeText} to the rig`;

        action.onclick = (e) => {
            e.preventDefault();
            e.stopPropagation();

            // visual feedback (flash)
            action.classList.add('rig-flash');
            setTimeout(() => {
                action.classList.remove('rig-flash');
            }, 150);

            sendToRig(freqText, modeText);
        };
    });
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
