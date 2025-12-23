import React, { useState } from 'react';
import { RefreshCw, Package, GitBranch, AlertTriangle } from 'lucide-react';

const SystemUpdater: React.FC = () => {
    const [updating, setUpdating] = useState(false);
    const [statusMsg, setStatusMsg] = useState('');
    const [errorMsg, setErrorMsg] = useState('');

    const handleUpdate = async () => {
        if (!window.confirm('Confirm System Update? The server will restart. This may take 1-2 minutes.')) return;

        setUpdating(true);
        setStatusMsg('Initiating update sequence...');
        setErrorMsg('');

        try {
            const res = await fetch('/api/admin/system/update', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });

            if (!res.ok) {
                if (res.status === 409) throw new Error('Update already in progress');
                if (res.status === 401) throw new Error('Unauthorized');
                throw new Error('Update request failed');
            }

            const data = await res.json();
            setStatusMsg(`Update Started: ${data.message}`);

            // Poll for liveness (reboot)
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
                const ping = await fetch('/api/config'); // Lightweight endpoint
                if (ping.ok) {
                    clearInterval(interval);
                    setStatusMsg('Update Complete! Reloading...');
                    setTimeout(() => window.location.reload(), 2000);
                }
            } catch (e) {
                if (retries > 60) { // 2 minutes timeout
                    clearInterval(interval);
                    setErrorMsg('Server restart timed out. Check logs manually.');
                    setUpdating(false);
                }
            }
        }, 2000);
    };

    return (
        <div className="p-6 rounded-2xl bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 space-y-4">
            <div className="flex items-center gap-3 mb-2">
                <Package className="text-primary-500" size={24} />
                <h2 className="text-xl font-bold text-gray-900 dark:text-white">System Update</h2>
            </div>

            <div className="flex flex-col gap-2">
                <div className="text-sm text-gray-500 flex items-center gap-2">
                    <GitBranch size={16} />
                    <span>Current Version: <strong>Tracking 'main' branch</strong></span>
                </div>

                <div className="bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-lg border border-yellow-100 dark:border-yellow-900/30 text-yellow-600 dark:text-yellow-400 text-sm flex items-start gap-2">
                    <AlertTriangle size={16} className="mt-0.5" />
                    <span>
                        This will pull the latest code from the remote repository and rebuild the application.
                        The service will be unavailable for a few minutes.
                    </span>
                </div>
            </div>

            {errorMsg && (
                <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-900/30 text-red-600 dark:text-red-400 rounded-lg text-sm">
                    Error: {errorMsg}
                </div>
            )}

            {statusMsg && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg text-sm font-mono animate-pulse">
                    &gt; {statusMsg}
                </div>
            )}

            <div className="pt-2">
                <button
                    onClick={handleUpdate}
                    disabled={updating}
                    className={`flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all transform active:scale-95 ${updating
                        ? 'bg-gray-600 cursor-not-allowed opacity-50 text-white'
                        : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-lg shadow-blue-900/20'
                        }`}
                >
                    <RefreshCw size={18} className={updating ? "animate-spin" : ""} />
                    {updating ? 'Updating...' : 'Update & Restart'}
                </button>
            </div>
        </div>
    );
};

export default SystemUpdater;
