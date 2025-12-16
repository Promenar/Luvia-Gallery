/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./index.html",
        "./{components,contexts,utils}/**/*.{js,ts,jsx,tsx}",
        "./*.{js,ts,jsx,tsx}" // Catches App.tsx, etc in root
    ],
    theme: {
        extend: {
            colors: {
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
