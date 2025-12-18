import React, { createContext, useContext, useState, useEffect } from 'react';
import { useColorScheme } from 'nativewind';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';

type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextType {
    mode: ThemeMode;
    setMode: (mode: ThemeMode) => void;
    isDark: boolean;
    paperTheme: any;
}

const ThemeContext = createContext<ThemeContextType>({
    mode: 'system',
    setMode: () => { },
    isDark: false,
    paperTheme: MD3LightTheme,
});

export const useTheme = () => useContext(ThemeContext);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const { colorScheme, setColorScheme } = useColorScheme();
    const [mode, setModeState] = useState<ThemeMode>('system');

    useEffect(() => {
        AsyncStorage.getItem('app_theme').then(stored => {
            if (stored) {
                const mode = stored as ThemeMode;
                setModeState(mode);
                setColorScheme(mode);
            } else {
                // Default to system
                setColorScheme('system');
            }
        });
    }, []);

    const setMode = async (newMode: ThemeMode) => {
        setModeState(newMode);
        setColorScheme(newMode);
        await AsyncStorage.setItem('app_theme', newMode);
    };

    const isDark = colorScheme === 'dark';
    const paperTheme = isDark ? { ...MD3DarkTheme, colors: { ...MD3DarkTheme.colors, primary: '#fff' } } : { ...MD3LightTheme, colors: { ...MD3LightTheme.colors, primary: '#000' } };

    return (
        <ThemeContext.Provider value={{ mode, setMode, isDark, paperTheme }}>
            {children}
        </ThemeContext.Provider>
    );
};
