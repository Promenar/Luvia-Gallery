/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./index.html",
        "./{components,contexts,utils}/**/*.{js,ts,jsx,tsx}",
        "./*.{js,ts,jsx,tsx}" // Catches App.tsx, etc in root
    ],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Roboto', 'sans-serif'],
            },
            colors: {
                primary: {
                    50: '#f0f3ff',
                    100: '#e0e7ff',
                    200: '#c7d2fe',
                    300: '#a5b4fc',
                    400: '#818cf8',
                    500: '#6366f1',
                    600: '#4f46e5',
                    700: '#4338ca',
                    800: '#3730a3',
                    900: '#312e81',
                },
                surface: {
                    primary: 'var(--surface-primary)',
                    secondary: 'var(--surface-secondary)',
                    tertiary: 'var(--surface-tertiary)',
                },
                text: {
                    primary: 'var(--text-primary)',
                    secondary: 'var(--text-secondary)',
                    tertiary: 'var(--text-tertiary)',
                },
                border: {
                    default: 'var(--border-default)',
                    subtle: 'var(--border-subtle)',
                }
            }
        },
    },
    plugins: [],
    darkMode: 'class',
}
