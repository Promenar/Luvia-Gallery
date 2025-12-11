app.post('/api/config', (req, res) => {
    let currentConfig = {};
    try {
        if (fs.existsSync(CONFIG_FILE)) {
            currentConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}

    const oldPaths = currentConfig.libraryPaths || [];
    const newPaths = req.body.libraryPaths || [];

    const newConfig = {
        ...req.body,
        watcherEnabled: currentConfig.watcherEnabled
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 2));
    
    // Detect and cleanup removed paths
    const removedPaths = oldPaths.filter(p => !newPaths.includes(p));
    if (removedPaths.length > 0) {
        console.log("Removing data for deleted paths:", removedPaths);
        try {
            const deleteStmt = db.prepare("DELETE FROM files WHERE source_id = ?");
            const txn = db.transaction((paths) => {
                for (const p of paths) {
                     // Normalize path string to match how it was stored (see startServerScan)
                     let cleanSource = p.trim();
                     if (cleanSource.length > 1 && cleanSource.endsWith('/')) cleanSource = cleanSource.slice(0, -1);
                     if (cleanSource.length > 1 && cleanSource.endsWith('\\')) cleanSource = cleanSource.slice(0, -1);
                     
                     const sourceId = `nas-${Buffer.from(cleanSource).toString('base64')}`;
                     deleteStmt.run(sourceId);
                }
            });
            txn(removedPaths);
            
            // Rebuild folder structure to remove empty folders left behind
            rebuildFolderStats();
        } catch (e) {
            console.error("Failed to cleanup DB:", e);
        }
    }
    
    if (isWatcherActive) {
        startWatcher(newConfig.libraryPaths || [MEDIA_ROOT]);
    }
    
    res.json({ success: true });
});