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
                sans: ['"Space Grotesk"', 'Manrope', 'Inter', 'system-ui', 'sans-serif'],
                display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
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
                accent: {
                    50: 'var(--accent-50)',
                    100: 'var(--accent-100)',
                    200: 'var(--accent-200)',
                    300: 'var(--accent-300)',
                    400: 'var(--accent-400)',
                    500: 'var(--accent-500)',
                    600: 'var(--accent-600)',
                    700: 'var(--accent-700)',
                },
                surface: {
                    primary: 'var(--surface-primary)',
                    secondary: 'var(--surface-secondary)',
                    tertiary: 'var(--surface-tertiary)',
                    deep: 'var(--surface-deep)',
                    glass: 'var(--surface-glass)',
                },
                text: {
                    primary: 'var(--text-primary)',
                    secondary: 'var(--text-secondary)',
                    tertiary: 'var(--text-tertiary)',
                    muted: 'var(--text-muted)',
                },
                border: {
                    default: 'var(--border-default)',
                    subtle: 'var(--border-subtle)',
                    glow: 'var(--border-glow)',
                },
                overlay: {
                    veil: 'var(--overlay-veil)',
                    strong: 'var(--overlay-strong)',
                }
            },
            boxShadow: {
                glow: '0 10px 40px rgba(0, 0, 0, 0.35)',
                'inner-glow': 'inset 0 1px 0 rgba(255, 255, 255, 0.12)',
            }
        },
    },
    plugins: [],
    darkMode: 'class',
}
