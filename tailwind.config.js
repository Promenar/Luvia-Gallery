/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./index.html",
        "./{components,contexts,utils}/**/*.{js,ts,jsx,tsx}",
        "./*.{js,ts,jsx,tsx}" // Catches App.tsx, etc in root
    ],
    theme: {
        extend: {},
    },
    plugins: [],
    darkMode: 'class',
}
