import { MD3DarkTheme, configureFonts } from 'react-native-paper';

export const SolidTheme = {
    ...MD3DarkTheme,
    colors: {
        ...MD3DarkTheme.colors,
        background: '#0F1115', // Deep Blue/Black
        surface: '#1E2228',    // Card color
        surfaceVariant: '#252930', // Slightly lighter
        primary: '#FFC107',    // Amber
        secondary: '#448AFF',  // Azure Blue
        tertiary: '#29B6F6',   // Light Blue
        onBackground: '#FFFFFF',
        onSurface: '#FFFFFF',
        outline: '#444A55',
        elevation: {
            level0: 'transparent',
            level1: '#1E2228',
            level2: '#23282E',
            level3: '#282E35',
            level4: '#2D343C',
            level5: '#323A43',
        },
    },
    // We can customize fonts here if needed
};
