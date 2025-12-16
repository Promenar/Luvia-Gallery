import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';

interface AuthContextType {
    token: string | null;
    isLoading: boolean;
    signIn: (token: string) => Promise<void>;
    signOut: () => Promise<void>;
    serverUrl: string;
    setServerUrl: (url: string) => Promise<void>;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType>({
    token: null,
    isLoading: true,
    signIn: async () => { },
    signOut: async () => { },
    serverUrl: '',
    setServerUrl: async () => { },
    isAuthenticated: false,
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [token, setToken] = useState<string | null>(null);
    const [serverUrl, setServerUrlState] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Load token and url from storage
        const loadStorage = async () => {
            try {
                const [storedToken, storedUrl] = await Promise.all([
                    SecureStore.getItemAsync('userToken'),
                    SecureStore.getItemAsync('serverUrl')
                ]);

                if (storedUrl) setServerUrlState(storedUrl);
                if (storedToken) setToken(storedToken);
            } catch (e) {
                console.error('Failed to load storage', e);
            } finally {
                setIsLoading(false);
            }
        };
        loadStorage();
    }, []);

    const signIn = async (newToken: string) => {
        setToken(newToken);
        await SecureStore.setItemAsync('userToken', newToken);
    };

    const signOut = async () => {
        setToken(null);
        await SecureStore.deleteItemAsync('userToken');
    };

    const setServerUrl = async (url: string) => {
        // Ensure no trailing slash
        const cleanUrl = url.replace(/\/$/, "");
        setServerUrlState(cleanUrl);
        await SecureStore.setItemAsync('serverUrl', cleanUrl);
    };

    return (
        <AuthContext.Provider value={{
            token,
            isLoading,
            signIn,
            signOut,
            serverUrl: serverUrl || '',
            setServerUrl,
            isAuthenticated: !!token && !!serverUrl
        }}>
            {children}
        </AuthContext.Provider>
    );
};
