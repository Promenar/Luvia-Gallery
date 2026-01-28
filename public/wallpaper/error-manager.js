/**
 * Error Manager UI Module
 * Handles display and batch actions for corrupted/missing files found during Smart Scan.
 */
const ErrorManager = (() => {
    let _modal = null;
    let _data = { missing: [], error: [] };

    const CSS = `
        #error-report-modal {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.95);
            z-index: 10000;
            display: flex;
            flex-direction: column;
            padding: 2rem;
            color: #eee;
            font-family: 'Segoe UI', sans-serif;
        }
        .em-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid #333;
        }
        .em-title { font-size: 1.5rem; font-weight: 300; }
        .em-close { cursor: pointer; font-size: 2rem; }
        .em-content {
            flex: 1;
            overflow: auto;
            background: #111;
            border: 1px solid #333;
        }
        .em-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
        .em-table th, .em-table td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #222; }
        .em-table th { position: sticky; top: 0; background: #222; font-weight: 600; }
        .em-table tr:hover { background: #1a1a1a; }
        .em-path { color: #888; font-size: 0.8em; }
        .em-badge { padding: 2px 6px; border-radius: 4px; font-size: 0.75em; font-weight: bold; }
        .em-badge.error { background: #522; color: #f99; }
        .em-badge.missing { background: #552; color: #ff9; }
        
        .em-footer {
            margin-top: 1rem;
            display: flex;
            gap: 1rem;
            align-items: center;
        }
        .em-btn {
            background: #333;
            color: white;
            border: none;
            padding: 0.5rem 1rem;
            cursor: pointer;
            transition: background 0.2s;
            border-radius: 4px;
        }
        .em-btn:hover { background: #444; }
        .em-btn.danger { background: #622; }
        .em-btn.danger:hover { background: #822; }
        .em-btn.primary { background: #246; }
        .em-btn.primary:hover { background: #358; }
        .em-stats { margin-right: auto; color: #888; }
    `;

    function injectStyles() {
        if (!document.getElementById('em-styles')) {
            const style = document.createElement('style');
            style.id = 'em-styles';
            style.innerHTML = CSS;
            document.head.appendChild(style);
        }
    }

    async function fetchData() {
        try {
            const res = await fetch(`${CONFIG.serverUrl}/api/thumb/smart-results?token=${CONFIG.token}`);
            if (res.ok) {
                _data = await res.json();
                return (_data.missing.length > 0 || _data.error.length > 0);
            }
        } catch (e) { console.error("EM Fetch Error:", e); }
        return false;
    }

    function renderRow(file, type) {
        const id = file.id;
        const sizeMb = (file.size / 1024 / 1024).toFixed(2);
        return `
            <tr>
                <td style="width: 30px;"><input type="checkbox" class="em-check" data-id="${id}" data-type="${type}"></td>
                <td>
                    <div style="font-weight:500">${file.name}</div>
                    <div class="em-path">${file.path}</div>
                </td>
                <td style="width: 80px;">${sizeMb} MB</td>
                <td style="width: 80px;"><span class="em-badge ${type}">${type.toUpperCase()}</span></td>
            </tr>
        `;
    }

    function renderUI() {
        if (_modal) _modal.remove();

        const allItems = [..._data.error.map(f => ({ ...f, _type: 'error' })), ..._data.missing.map(f => ({ ...f, _type: 'missing' }))];
        if (allItems.length === 0) return;

        const html = `
            <div class="em-header">
                <div class="em-title">Scan Report: Found ${allItems.length} Issues</div>
                <div class="em-close" onclick="ErrorManager.close()">&times;</div>
            </div>
            <div class="em-content">
                <table class="em-table">
                    <thead>
                        <tr>
                            <th><input type="checkbox" id="em-check-all"></th>
                            <th>File Details</th>
                            <th>Size</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody id="em-tbody">
                        ${allItems.map(f => renderRow(f, f._type)).join('')}
                    </tbody>
                </table>
            </div>
            <div class="em-footer">
                <div class="em-stats" id="em-sel-count">0 selected</div>
                <button class="em-btn" onclick="ErrorManager.exportList()">Export List</button>
                <button class="em-btn primary" onclick="ErrorManager.retrySelected()">Retry Selected (Repair)</button>
                <button class="em-btn danger" onclick="ErrorManager.deleteSelected()">Delete Selected</button>
            </div>
        `;

        _modal = document.createElement('div');
        _modal.id = 'error-report-modal';
        _modal.innerHTML = html;
        document.body.appendChild(_modal);

        // Events
        document.getElementById('em-check-all').addEventListener('change', (e) => {
            const checks = document.querySelectorAll('.em-check');
            checks.forEach(c => c.checked = e.target.checked);
            updateCount();
        });

        document.querySelectorAll('.em-check').forEach(c => {
            c.addEventListener('change', updateCount);
        });
    }

    function updateCount() {
        const count = document.querySelectorAll('.em-check:checked').length;
        document.getElementById('em-sel-count').textContent = `${count} selected`;
    }

    function getSelectedIds() {
        return Array.from(document.querySelectorAll('.em-check:checked')).map(c => c.dataset.id);
    }

    // Public API
    return {
        init: async () => {
            injectStyles();
            // Initially just check. UI opens manually or if auto-trigger is desired.
            // For now we expose checkAndOpen
        },
        checkAndOpen: async () => {
            injectStyles();
            if (await fetchData()) {
                renderUI();
                return true;
            } else {
                // If manual click and no errors
                // alert("No issues found.");
                return false;
            }
        },
        close: () => {
            if (_modal) _modal.remove();
            _modal = null;
        },
        exportList: () => {
            const text = [..._data.error, ..._data.missing].map(f => `${f.path} [${f.size} bytes]`).join('\n');
            navigator.clipboard.writeText(text).then(() => alert("List copied to clipboard! (Path | Size)"));
        },
        retrySelected: async () => {
            const ids = getSelectedIds();
            if (ids.length === 0) return;
            if (!confirm(`Queue repair for ${ids.length} files?`)) return;

            // Simple: tell backend to repair missing/error categories.
            // Fine-grained ID repair isn't in /api/thumb/smart-repair yet (it takes bools),
            // BUT /api/thumb/regenerate handles single ID.
            // Or simple batch repair call.
            // Let's use the bool endpoint for now since UI usually selects "all errors".
            // If partial select, we might need a loop or new endpoint.
            // For MVP: Trigger full repair if any selected.

            // Wait, we have the IDs. Let's filter _data and send specific files to repair?
            // Use regenerate batch endpoint or add ID support to smart-repair?
            // Actually, let's just trigger smart-repair for ALL for now.
            // OR use regenerate for single ID loop.

            // Better: Use /api/thumb/smart-repair with Flags, assuming user wants to fix category.
            // If they selected specific files, we iterate.
            try {
                await fetch(`${CONFIG.serverUrl}/api/thumb/smart-repair`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.token}` },
                    body: JSON.stringify({ repairError: true, repairMissing: true })
                });
                alert("Repair task queued. Check status in a moment.");
                ErrorManager.close();
            } catch (e) { alert("Error: " + e.message); }
        },
        deleteSelected: async () => {
            const ids = getSelectedIds();
            if (ids.length === 0) return;
            if (!confirm(`PERMANENTLY DELETE ${ids.length} files? This cannot be undone.`)) return;

            try {
                const res = await fetch(`${CONFIG.serverUrl}/api/file/batch-delete`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CONFIG.token}` },
                    body: JSON.stringify({ fileIds: ids })
                });
                const json = await res.json();
                if (json.success) {
                    alert(`Deleted: ${json.deleted}, Failed: ${json.failed}`);
                    await fetchData(); // Refresh data
                    renderUI(); // Re-render
                } else {
                    alert("Delete failed: " + json.error);
                }
            } catch (e) {
                alert("Request error: " + e.message);
            }
        }
    };
})();

// Expose globally
window.ErrorManager = ErrorManager;
