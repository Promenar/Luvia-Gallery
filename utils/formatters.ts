export const formatDate = (ts: number | Date | string | undefined, language: 'en' | 'zh' | string): string => {
    if (!ts) return '-';
    try {
        const date = new Date(ts);
        const locale = language === 'zh' ? 'zh-CN' : 'en-US';
        return date.toLocaleString(locale, {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    } catch {
        return '-';
    }
};

export const formatSize = (bytes: number | undefined): string => {
    if (bytes === undefined || bytes === null || isNaN(bytes)) return '0 B';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};
