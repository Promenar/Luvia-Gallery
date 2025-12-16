import React, { useState } from 'react';
import { View, StyleSheet, Alert } from 'react-native';
import { TextInput, Button, Text, useTheme } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useAuth } from '../../contexts/AuthContext';
import { SolidHeader } from '../../components/SolidHeader';

export default function LoginScreen() {
    const theme = useTheme();
    const router = useRouter();
    const { serverUrl, signIn } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);

    const handleLogin = async () => {
        if (!username || !password) return;
        setLoading(true);
        try {
            const res = await fetch(`${serverUrl}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });

            const data = await res.json();
            if (res.ok && data.token) {
                await signIn(data.token);
                router.replace('/(drawer)/' as any);
            } else {
                Alert.alert("Login Failed", data.message || "Invalid credentials");
            }
        } catch (e: any) {
            Alert.alert("Error", e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
            <SolidHeader title="Login" showBack={true} onBack={() => router.replace('/auth/server-setup')} />
            <View style={styles.container}>
                <Text variant="bodyMedium" style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 24 }}>
                    Connecting to: {serverUrl}
                </Text>

                <TextInput
                    label="Username"
                    value={username}
                    onChangeText={setUsername}
                    mode="outlined"
                    autoCapitalize="none"
                    style={{ marginBottom: 12 }}
                />

                <TextInput
                    label="Password"
                    value={password}
                    onChangeText={setPassword}
                    mode="outlined"
                    secureTextEntry
                    style={{ marginBottom: 24 }}
                />

                <Button
                    mode="contained"
                    onPress={handleLogin}
                    loading={loading}
                    disabled={loading}
                    style={{ borderRadius: 8 }}
                >
                    Sign In
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
