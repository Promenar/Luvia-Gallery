import React, { useState, useEffect } from 'react';
import { RefreshCw, Package, GitBranch, AlertTriangle, Search, Save, CheckCircle, XCircle } from 'lucide-react';
import { useLanguage } from '../contexts/LanguageContext';

const SystemUpdater: React.FC = () => {
    const { t } = useLanguage();
    const [authToken, setAuthToken] = useState<string>(localStorage.getItem('update_token') || '');
    const [updating, setUpdating] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [checking, setChecking] = useState(false);
    const [config, setConfig] = useState({ repoUrl: 'git@github.com:NarcisWL/Luvia-Gallery.git', branch: 'main' });
    const [updateStatus, setUpdateStatus] = useState<{ updatable: boolean, local: string, remote: string } | null>(null);
    const [saveStatus, setSaveStatus] = useState('');

    useEffect(() => {
        checkUpdate();
    }, []);

    const getHeaders = (token?: string) => {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        const activeToken = token || authToken;
        if (activeToken) {
            headers['Authorization'] = `Bearer ${activeToken}`;
        }
        return headers;
    };

    const checkUpdate = async (token?: string) => {
        setChecking(true);
        setErrorMsg('');
        try {
            const res = await fetch('/api/admin/system/update/status', {
                headers: getHeaders(token)
            });

            if (res.status === 401) {
                const userInput = window.prompt("Security Check: Please enter the Update Token to check status.");
                if (userInput) {
                    setAuthToken(userInput);
                    localStorage.setItem('update_token', userInput);
                    return checkUpdate(userInput);
                }
                throw new Error("Unauthorized");
            }

            if (res.ok) {
                const data = await res.json();
                setUpdateStatus(data);
                if (data.config) {
                    setConfig(data.config);
                }
            } else {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || data.details || t('update_error'));
            }
        } catch (e: any) {
            setErrorMsg(e.message);
        } finally {
            setChecking(false);
        }
    };

    const handleSaveConfig = async (token?: string) => {
        setSaveStatus('saving');
        setErrorMsg('');
        try {
            const res = await fetch('/api/admin/system/update/config', {
                method: 'POST',
                headers: getHeaders(token),
                body: JSON.stringify(config)
            });

            if (res.status === 401) {
                const userInput = window.prompt("Security Check: Please enter the Update Token to save config.");
                if (userInput) {
                    setAuthToken(userInput);
                    localStorage.setItem('update_token', userInput);
                    return handleSaveConfig(userInput);
                }
                throw new Error("Unauthorized");
            }

            if (res.ok) {
                setSaveStatus('success');
                setTimeout(() => setSaveStatus(''), 2000);
                checkUpdate(token || authToken);
            } else {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Failed to save');
            }
        } catch (e: any) {
            setErrorMsg(e.message);
            setSaveStatus('error');
        }
    };

    const handleUpdate = async (token?: string) => {
        if (!token && !window.confirm(t('update_description'))) return;

        setUpdating(true);
        setStatusMsg('Initiating update sequence...');
        setErrorMsg('');

        try {
            const res = await fetch('/api/admin/system/update', {
                method: 'POST',
                headers: getHeaders(token)
            });

            if (!res.ok) {
                if (res.status === 409) throw new Error('Update already in progress');
                if (res.status === 401) {
                    const userInput = window.prompt("Security Check: Please enter the Update Token to proceed.");
                    if (userInput) {
                        setAuthToken(userInput);
                        localStorage.setItem('update_token', userInput);
                        return handleUpdate(userInput);
                    } else {
                        throw new Error('Update cancelled (Token required).');
                    }
                }
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Update request failed');
            }

            const data = await res.json();
            setStatusMsg(`Update Started: ${data.message}`);
            checkLiveness();

        } catch (e: any) {
            setErrorMsg(e.message);
            setUpdating(false);
        }
    };

    const checkLiveness = async () => {
        let retries = 0;
        setStatusMsg('Server restarting... waiting for connection...');

        const interval = setInterval(async () => {
            retries++;
            try {
                const ping = await fetch('/api/config');
                if (ping.ok) {
                    clearInterval(interval);
                    setStatusMsg('Update Complete! Reloading...');
                    setTimeout(() => window.location.reload(), 2000);
                }
            } catch (e) {
                if (retries > 60) {
                    clearInterval(interval);
                    setErrorMsg('Server restart timed out. Check logs manually.');
                    setUpdating(false);
                }
            }
        }, 2000);
    };

    return (
        <div className="p-6 rounded-2xl bg-white/5 border border-white/5 space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Package className="text-accent-500" size={24} />
                    <h2 className="text-xl font-bold text-text-primary">{t('system_update')}</h2>
                </div>
                {updateStatus && (
                    <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold border ${updateStatus.updatable ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30 animate-pulse' : 'bg-green-500/10 text-green-500 border-green-500/30'}`}>
                        {updateStatus.updatable ? (
                            <><AlertTriangle size={14} /> {t('update_available')}</>
                        ) : (
                            <><CheckCircle size={14} /> {t('already_latest')}</>
                        )}
                    </div>
                )}
            </div>

            <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-text-tertiary uppercase tracking-wider">{t('repo_url')}</label>
                        <div className="flex gap-2">
                            <input
                                value={config.repoUrl}
                                onChange={e => setConfig(prev => ({ ...prev, repoUrl: e.target.value }))}
                                placeholder="git@github.com:user/repo.git or https://github.com/user/repo.git"
                                className="flex-1 px-3 py-2 bg-black/20 border border-white/5 rounded-xl text-sm font-mono text-text-secondary outline-none focus:border-accent-500/30"
                            />
                        </div>
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-bold text-text-tertiary uppercase tracking-wider">Branch</label>
                        <div className="flex gap-2">
                            <input
                                value={config.branch}
                                onChange={e => setConfig(prev => ({ ...prev, branch: e.target.value }))}
                                placeholder="main"
                                className="flex-1 px-3 py-2 bg-black/20 border border-white/5 rounded-xl text-sm font-mono text-text-secondary outline-none focus:border-accent-500/30"
                            />
                            <button
                                onClick={() => handleSaveConfig()}
                                disabled={saveStatus === 'saving'}
                                className={`h-[38px] px-4 rounded-xl border flex items-center justify-center gap-2 transition-all active:scale-95 shrink-0 ${saveStatus === 'success' ? 'bg-green-500/20 border-green-500/30 text-green-400 shadow-glow' : 'bg-white/5 border-transparent text-text-secondary hover:bg-white/10'}`}
                            >
                                {saveStatus === 'success' ? <CheckCircle size={18} /> : <Save size={18} />}
                                <span className="text-sm font-medium whitespace-nowrap">{saveStatus === 'success' ? t('config_saved') : t('save_config')}</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div className="bg-yellow-500/5 p-4 rounded-xl border border-yellow-500/10 text-yellow-500/80 text-sm flex items-start gap-3 leading-relaxed">
                    <AlertTriangle size={18} className="shrink-0 mt-0.5" />
                    <span>{t('update_description')}</span>
                </div>
            </div>

            {errorMsg && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-sm flex items-center gap-2">
                    <XCircle size={16} /> {errorMsg}
                </div>
            )}

            {statusMsg && (
                <div className="p-3 bg-accent-500/10 border border-accent-500/20 text-accent-400 rounded-xl text-sm font-mono animate-pulse">
                    &gt; {statusMsg}
                </div>
            )}

            <div className="flex items-center gap-3 pt-2">
                <button
                    onClick={() => handleUpdate()}
                    disabled={updating}
                    className={`flex-1 flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold transition-all transform active:scale-95 shadow-glow ${updating
                        ? 'bg-gray-600 cursor-not-allowed opacity-50 text-white'
                        : 'bg-accent-600 hover:bg-accent-500 text-white'
                        }`}
                >
                    <RefreshCw size={20} className={updating ? "animate-spin" : ""} />
                    {updating ? t('updating') : t('update_restart')}
                </button>
                <button
                    onClick={() => checkUpdate()}
                    disabled={checking || updating}
                    className="p-3 bg-white/5 hover:bg-white/10 border border-transparent rounded-xl text-text-secondary transition-all active:scale-95 flex items-center justify-center min-w-[48px]"
                    title={t('check_update')}
                >
                    <Search size={22} className={`transition-all duration-500 ${checking ? "opacity-40 scale-90" : "opacity-100 scale-100"}`} />
                </button>
            </div>
        </div>
    );
};

export default SystemUpdater;
