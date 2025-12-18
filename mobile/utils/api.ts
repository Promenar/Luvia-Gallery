import { MediaItem } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { getCachedFiles, saveMediaItems, updateFavoriteStatus, clearStaticCache } from './Database';
export { clearStaticCache };

// Default Remote Backend URL
export let API_URL = '';
let authToken: string | null = null;

export const setBaseUrl = async (url: string, persist: boolean = true) => {
    const cleanUrl = url.trim().replace(/\/$/, '');
    API_URL = cleanUrl;
    if (persist && cleanUrl) {
        await AsyncStorage.setItem('lumina_api_url', cleanUrl);
    }
};

export const setToken = (token: string | null) => {
    authToken = token;
};

// Initialize URL & Token from storage (call this early in App.tsx)
export const initApi = async () => {
    try {
        const storedUrl = await AsyncStorage.getItem('lumina_api_url');
        const storedToken = await SecureStore.getItemAsync('lumina_token');
        const storedUsername = await AsyncStorage.getItem('lumina_username');
        if (storedUrl) API_URL = storedUrl;
        if (storedToken) authToken = storedToken;
        return { token: storedToken, username: storedUsername };
    } catch (e) {
        console.error("Failed to load API configuration", e);
        return { token: null };
    }
};

// Logout Callback Mechanism
let logoutCallback: (() => void) | null = null;
let isEmittingLogout = false;

export const onLogout = (cb: () => void) => { logoutCallback = cb; };

const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
    const headers = {
        ...options.headers,
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
    };

    const res = await fetch(url, { ...options, headers });

    if (res.status === 401 || res.status === 403) {
        // Token expired or invalid
        // Debounce/Throttle the logout callback to prevent spamming
        if (logoutCallback && !isEmittingLogout) {
            isEmittingLogout = true;
            logoutCallback();
            // Reset flag after a delay to allow future warnings if re-login happens
            setTimeout(() => { isEmittingLogout = false; }, 5000);
        }
        throw new Error('Session Expired');
    }
    return res;
};

export const login = async (username: string, password: string) => {
    try {
        const res = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        if (res.ok) {
            const data = await res.json();
            if (data.token) {
                authToken = data.token;
                await SecureStore.setItemAsync('lumina_token', data.token);
                await AsyncStorage.setItem('lumina_username', username);
                return data;
            }
        }
        throw new Error('Login failed');
    } catch (e) {
        throw e;
    }
};

export const logout = async (isManual = false) => {
    authToken = null;
    await SecureStore.deleteItemAsync('lumina_token');
    await AsyncStorage.removeItem('lumina_username');
    if (logoutCallback && !isManual) {
        logoutCallback();
    }
};

// Use encodeURIComponent for IDs (paths)
// Use encodeURIComponent for IDs (paths)
export const getFileUrl = (id: string) => {
    const url = `${API_URL}/api/file/${encodeURIComponent(id)}`;
    return authToken ? `${url}?token=${authToken}` : url;
};
export const getThumbnailUrl = (id: string) => {
    const url = `${API_URL}/api/thumb/${encodeURIComponent(id)}`;
    return authToken ? `${url}?token=${authToken}` : url;
};

export const fetchFolders = async (path?: string, favorite: boolean = false) => {
    try {
        let url = `${API_URL}/api/library/folders`;
        const params = [];
        if (favorite) {
            params.push('favorites=true');
        } else {
            params.push(`parentPath=${encodeURIComponent(path || 'root')}`);
        }

        if (params.length > 0) {
            url += `?${params.join('&')}`;
        }

        // Use authenticatedFetch but headers must be explicit if no body?
        // fetch defaults are GET.
        const res = await authenticatedFetch(url);
        if (!res.ok) throw new Error('Failed to fetch folders');
        return await res.json();
    } catch (error) {
        console.error(error);
        return { folders: [] };
    }
};

interface FetchFilesOptions {
    folderPath?: string;
    offset?: number;
    limit?: number;
    favorite?: boolean;
    random?: boolean;
    mediaType?: string | string[];
    excludeMediaType?: string | string[];
    refresh?: boolean; // New flag to force network
}

export const fetchFiles = async (options: FetchFilesOptions = {}) => {
    try {
        const { folderPath, offset = 0, limit = 100, favorite, random, mediaType, excludeMediaType, refresh = false } = options;

        // 1. Try Cache First (if not random and not forcing refresh)
        if (!random && !refresh) {
            const cached = await getCachedFiles({ folderPath, favorite, limit, offset });
            // Only return from cache if it fills a whole page (to ensure infinite scroll works correctly)
            if (cached.length === limit) {
                return { files: cached, fromCache: true };
            }
        }

        // 2. Fetch from Network
        let url = `${API_URL}/api/scan/results?offset=${offset}&limit=${limit}`;

        if (folderPath) url += `&folder=${encodeURIComponent(folderPath)}`;
        if (favorite) url += `&favorites=true`;
        if (random) url += `&random=true`;

        if (mediaType) {
            if (Array.isArray(mediaType)) {
                mediaType.forEach(t => url += `&mediaType=${t}`);
            } else {
                url += `&mediaType=${mediaType}`;
            }
        }

        if (excludeMediaType) {
            if (Array.isArray(excludeMediaType)) {
                excludeMediaType.forEach(t => url += `&excludeMediaType=${t}`);
            } else {
                url += `&excludeMediaType=${excludeMediaType}`;
            }
        }

        const res = await authenticatedFetch(url);
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        const data = await res.json();

        // 3. Save to Cache (if not random)
        if (!random && data.files && data.files.length > 0) {
            // Await to ensure DB is consistent before UI allows interaction (blocking delete race condition)
            try {
                await saveMediaItems(data.files, folderPath || 'root');
            } catch (e) {
                console.error("Cache save error", e);
            }
        }

        return data;
    } catch (error) {
        console.error(error);
        return { files: [] };
    }
};

export const getFileInfo = async (id: string) => {
    try {
        // We might not have a specific 'get info' endpoint efficiently, 
        // but we can query by ID if backend supports it? 
        // Or simply query all and find? checking backend... backend `queryFiles` doesn't filter by ID directly except `sourceId`?
        // Wait, `database.js` `queryFiles` does NOT have `id` filter.
        // But `server.js` usually has `/api/file/:id/info`?
        // Let's check server.js or just add `id` filter to `queryFiles` in `database.js` later if needed.
        // For now, let's use what we have.
        return null;
    } catch (e) {
        return null;
    }
}

export const toggleFavorite = async (id: string, isFavorite: boolean, type: 'file' | 'folder' = 'file') => {
    try {
        // Sync to local SQLite cache first (Optimistic) - Only for files currently
        if (type === 'file') {
            updateFavoriteStatus(id, isFavorite).catch(e => console.error("Local sync favorite error", e));
        }

        const url = `${API_URL}/api/favorites/toggle`;
        const res = await authenticatedFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, type })
        });
        return await res.json();
    } catch (error) {
        console.error("Error toggling favorite:", error);
        return null;
    }
};

export const deleteFile = async (filePath: string) => {
    const url = `${API_URL}/api/file/delete`;
    const res = await authenticatedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filePath })
    });
    if (!res.ok) throw new Error('Failed to delete file');
    return await res.json();
};

export const deleteFolder = async (path: string) => {
    const url = `${API_URL}/api/folder/delete`;
    const res = await authenticatedFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path })
    });
    if (!res.ok) throw new Error('Failed to delete folder');
    return await res.json();
};

export const fetchExif = async (id: string) => {
    try {
        const url = `${API_URL}/api/file/${encodeURIComponent(id)}/exif`;
        const res = await authenticatedFetch(url);
        if (!res.ok) return null;
        return await res.json();
    } catch (error) {
        console.error('Fetch EXIF error:', error);
        return null;
    }
};
