import React from 'react';
import { View, StyleSheet, TouchableOpacity, Image, Platform } from 'react-native';
import { DrawerContentScrollView, DrawerItem, DrawerContentComponentProps } from '@react-navigation/drawer';
import { Text, useTheme, Divider } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, usePathname } from 'expo-router';

export function SolidDrawerContent(props: DrawerContentComponentProps) {
    const theme = useTheme();
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const pathname = usePathname();

    // Define Menu Items
    const menuItems = [
        { label: 'Discover', icon: 'compass-outline', route: '/(drawer)/' }, // Root of drawer
        { label: 'Library', icon: 'image-multiple-outline', route: '/(drawer)/library' },
        { label: 'Favorites', icon: 'star-outline', route: '/(drawer)/favorites' },
        { label: 'Folders', icon: 'folder-outline', route: '/(drawer)/folders' },
    ];

    const handleNavigation = (route: string) => {
        router.push(route as any);
    };

    // Helper to check active state
    // Note: pathname might be "/(drawer)/library" or just "/library" depending on router state?
    // We'll do a simple includes check or exact match
    const isActive = (route: string) => {
        // Normalize: remove (drawer) for comparison if needed, or check exact match
        // For simplicity, let's assume route matches the start of pathname if not root
        if (route === '/(drawer)/' && (pathname === '/' || pathname === '/(drawer)/' || pathname === '/(drawer)')) return true;
        if (route !== '/(drawer)/' && pathname.includes(route.replace('/(drawer)', ''))) return true;
        return false;
    };

    return (
        <View style={{ flex: 1, backgroundColor: '#0F1115' }}>
            {/* 1. Header Area (180dp+) */}
            <LinearGradient
                colors={['#1E88E5', '#0D47A1']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.header, { paddingTop: insets.top + 24 }]}
            >
                <View>
                    {/* App Logo / Icon Placeholder */}
                    <MaterialCommunityIcons name="folder-multiple" size={48} color="rgba(255,255,255,0.9)" style={{ marginBottom: 16 }} />

                    <Text variant="headlineMedium" style={styles.appName}>Solid Gallery</Text>
                    <Text variant="bodySmall" style={styles.version}>v1.0.0 • Free</Text>
                </View>
            </LinearGradient>

            {/* 2. Menu Items */}
            <DrawerContentScrollView {...props} contentContainerStyle={{ paddingTop: 8 }}>
                {menuItems.map((item, index) => {
                    const active = isActive(item.route);
                    // Solid Explorer Active State: 
                    // - Icon: Yellow (#FFC107)
                    // - Text: White (Bold/Medium)
                    // - Background: Slight Light Overlay (#1E2228)

                    const color = active ? '#FFC107' : 'rgba(255,255,255,0.6)';
                    const bgColor = active ? '#1E2228' : 'transparent';
                    const fontWeight = active ? 'bold' : 'normal';

                    return (
                        <TouchableOpacity
                            key={index}
                            onPress={() => handleNavigation(item.route)}
                            style={[styles.item, { backgroundColor: bgColor }]}
                            activeOpacity={0.8}
                        >
                            <MaterialCommunityIcons
                                name={active ? item.icon.replace('-outline', '') as any : item.icon as any}
                                size={24}
                                color={color}
                                style={{ marginRight: 32 }}
                            />
                            <Text variant="bodyLarge" style={{ color: active ? '#fff' : 'rgba(255,255,255,0.7)', fontWeight: fontWeight as any }}>
                                {item.label}
                            </Text>
                        </TouchableOpacity>
                    )
                })}

                <Divider style={{ marginVertical: 8, backgroundColor: 'rgba(255,255,255,0.1)' }} />

                <TouchableOpacity
                    onPress={() => { }} // TODO: Settings
                    style={styles.item}
                >
                    <MaterialCommunityIcons name="cog-outline" size={24} color="rgba(255,255,255,0.6)" style={{ marginRight: 32 }} />
                    <Text variant="bodyLarge" style={{ color: 'rgba(255,255,255,0.7)' }}>Settings</Text>
                </TouchableOpacity>

            </DrawerContentScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    header: {
        height: 190,
        paddingHorizontal: 24,
        justifyContent: 'center',
        paddingBottom: 24
    },
    appName: {
        color: '#fff',
        fontWeight: 'bold',
    },
    version: {
        color: 'rgba(255,255,255,0.6)',
        marginTop: 4
    },
    item: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 24,
        marginBottom: 4,
        // No rounded corners in strict Material Drawer usually, but for "Solid" feel maybe full width?
        // Solid Explorer uses full width highlight.
    }
});
