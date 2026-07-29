function createRequestTimingMiddleware({ thresholdMs = 1000, now = Date.now, warn = console.warn } = {}) {
    return (req, res, next) => {
        const startedAt = now();
        let recorded = false;

        const record = outcome => {
            if (recorded) return;
            recorded = true;

            const durationMs = now() - startedAt;
            if (durationMs <= thresholdMs) return;

            warn(`[HTTP] Slow request method=${req.method} path=${req.path} status=${res.statusCode} duration=${durationMs}ms outcome=${outcome}`);
        };

        res.once('finish', () => record('finish'));
        res.once('close', () => record('close'));
        next();
    };
}

module.exports = { createRequestTimingMiddleware };
