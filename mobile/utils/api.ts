import { MediaItem } from '../types';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Default Remote Backend URL
export let API_URL = '';
let authToken: string | null = null;

export const setBaseUrl = (url: string) => {
    API_URL = url.replace(/\/$/, ''); // Remove trailing slash
};

export const setToken = (token: string | null) => {
    authToken = token;
};

// Initialize URL & Token from storage (call this early in App.tsx)
export const initApi = async () => {
    try {
        const storedUrl = await AsyncStorage.getItem('lumina_api_url');
        const storedToken = await AsyncStorage.getItem('lumina_token');
        if (storedUrl) API_URL = storedUrl;
        if (storedToken) authToken = storedToken;
        return { token: storedToken };
    } catch (e) {
        console.error("Failed to load API configuration", e);
        return { token: null };
    }
};

const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
    const headers = {
        ...options.headers,
        ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
    };

    const res = await fetch(url, { ...options, headers });
    if (res.status === 401) {
        // Token expired or invalid
        // Optionally trigger logout callback?
        throw new Error('Unauthorized');
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
                await AsyncStorage.setItem('lumina_token', data.token);
                return data;
            }
        }
        throw new Error('Login failed');
    } catch (e) {
        throw e;
    }
};

export const logout = async () => {
    authToken = null;
    await AsyncStorage.removeItem('lumina_token');
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

export const fetchFolders = async (path?: string) => {
    try {
        const url = path
            ? `${API_URL}/api/library/folders?parentPath=${encodeURIComponent(path)}`
            : `${API_URL}/api/library/folders?parentPath=root`;

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

export const fetchFiles = async (folderPath?: string, offset = 0, limit = 100, favorite?: boolean) => {
    try {
        let url = `${API_URL}/api/scan/results?offset=${offset}&limit=${limit}`;
        if (folderPath) {
            url += `&folder=${encodeURIComponent(folderPath)}`;
        }
        if (favorite) {
            url += `&favorites=true`;
        }
        const res = await authenticatedFetch(url);
        if (!res.ok) throw new Error(`API Error: ${res.status}`);
        return await res.json();
    } catch (error) {
        console.error(error);
        return { files: [] };
    }
};

export const toggleFavorite = async (id: string, isFavorite: boolean) => {
    try {
        const url = `${API_URL}/api/metadata/favorite`;
        const res = await authenticatedFetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id, isFavorite })
        });
        return await res.json();
    } catch (error) {
        console.error("Error toggling favorite:", error);
        return null;
    }
};
