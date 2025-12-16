import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { TextInput, Button, Text, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { SolidHeader } from '../../components/SolidHeader';

export default function ServerSetupScreen() {
    const theme = useTheme();
    const router = useRouter();
    const { setServerUrl } = useAuth();
    const [url, setInputUrl] = useState('');
    const [loading, setLoading] = useState(false);

    const handleConnect = async () => {
        if (!url) return;
        setLoading(true);
        try {
            // Normalize URL
            let testUrl = url.trim().replace(/\/$/, "");
            if (!testUrl.startsWith('http')) {
                testUrl = `http://${testUrl}`;
            }

            // Ping health or safe endpoint
            // Assuming /api/health exists, or fallback to root /
            const res = await fetch(`${testUrl}/api/health`).catch(() => null);

            // If /api/health not implemented, maybe just check if can reach server?
            // For now, let's just proceed if we get *any* response or if user insists.
            // But ideally we get a 200.

            let success = false;
            if (res && res.ok) success = true;
            else {
                // Try simple fetch to root?
                const rootRes = await fetch(`${testUrl}/`).catch(() => null);
                if (rootRes) success = true;
            }

            if (success) {
                await setServerUrl(testUrl);
                router.replace('/auth/login');
            } else {
                Alert.alert("Connection Failed", "Could not reach server. Check IP and Port.");
            }

        } catch (e) {
            Alert.alert("Error", "Invalid URL or Network Error");
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
            <SolidHeader title="Welcome" showBack={false} />
            <View style={styles.container}>
                <Text variant="headlineSmall" style={{ color: '#fff', marginBottom: 24 }}>Connect to Server</Text>

                <TextInput
                    label="Server URL (e.g. 192.168.1.5:3001)"
                    value={url}
                    onChangeText={setInputUrl}
                    mode="outlined"
                    autoCapitalize="none"
                    style={{ marginBottom: 16 }}
                />

                <Button
                    mode="contained"
                    onPress={handleConnect}
                    loading={loading}
                    disabled={loading}
                    style={{ borderRadius: 8 }}
                >
                    Connect
                </Button>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        padding: 24,
        justifyContent: 'center'
    }
});
