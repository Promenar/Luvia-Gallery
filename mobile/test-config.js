const { getDefaultConfig } = require('expo/metro-config');
try {
    const config = getDefaultConfig(__dirname);
    console.log('Config loaded successfully');
} catch (e) {
    console.error('Error loading config:', e);
}
