/*
 * SOTAWatch Connect - popup
 *
 * Lets the user pick which rig (rigctld instance) is currently
 * active. The selection is stored in chrome.storage.local and read
 * by content.js on every badge click.
 *
 * (c) 2026 Takeshi Mishima JK1VUZ
 */

const BRIDGE_PORT = 5001;
const STORAGE_KEY = 'activeRig';

const selectEl = document.getElementById('rig-select');
const statusEl = document.getElementById('status');
const reloadBtn = document.getElementById('reload');

function setStatus(message, isError) {
    statusEl.textContent = message;
    statusEl.classList.toggle('error', !!isError);
}

async function loadRigs() {
    setStatus('リグ一覧を取得中...', false);
    selectEl.innerHTML = '<option value="">読み込み中...</option>';

    let rigs;
    try {
        const res = await fetch(`http://localhost:${BRIDGE_PORT}/rigs`);
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
        const json = await res.json();
        rigs = json.rigs || [];
    } catch (err) {
        selectEl.innerHTML = '<option value="">(ブリッジに接続できません)</option>';
        setStatus(
            `ブリッジ(ポート${BRIDGE_PORT})に接続できません。start_rig_bridge.vbsが起動しているか確認してください。`,
            true
        );
        return;
    }

    if (rigs.length === 0) {
        selectEl.innerHTML = '<option value="">(rigs.csvにリグが未設定です)</option>';
        setStatus('bridge/rigs.csv にリグが設定されていません。bridge/rigs.sample.csv をコピーして rigs.csv を作り、編集してください。', true);
        return;
    }

    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const savedRig = stored[STORAGE_KEY];

    selectEl.innerHTML = '';
    rigs.forEach(rig => {
        const opt = document.createElement('option');
        opt.value = rig.name;
        opt.textContent = rig.name;
        selectEl.appendChild(opt);
    });

    // Restore the previous selection if it's still in the current
    // rig list, otherwise fall back to the first rig.
    if (savedRig && rigs.some(rig => rig.name === savedRig)) {
        selectEl.value = savedRig;
        setStatus(`現在のアクティブなリグ: ${savedRig}`, false);
    } else {
        selectEl.value = rigs[0].name;
        chrome.storage.local.set({ [STORAGE_KEY]: rigs[0].name });
        setStatus(`アクティブなリグ: ${rigs[0].name}`, false);
    }
}

selectEl.addEventListener('change', () => {
    const rigName = selectEl.value;
    chrome.storage.local.set({ [STORAGE_KEY]: rigName });
    setStatus(`アクティブなリグ: ${rigName}`, false);
});

reloadBtn.addEventListener('click', loadRigs);

loadRigs();
