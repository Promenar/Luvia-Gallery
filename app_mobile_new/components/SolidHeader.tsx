import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, Appbar, useTheme } from 'react-native-paper';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { DrawerActions, useNavigation } from '@react-navigation/native';

import { useHeader } from '../contexts/HeaderContext';

interface SolidHeaderProps {
    title?: string;
    breadcrumb?: string;
    onBack?: () => void;
    showBack?: boolean;
}

export const SolidHeader: React.FC<SolidHeaderProps> = (props) => {
    const router = useRouter();
    const navigation = useNavigation();

    // Consume state from Context
    const contextState = useHeader();

    // Props override Context (Useful for Auth screens which are outside standard flow)
    const title = props.title ?? contextState.title;
    const breadcrumb = props.breadcrumb ?? contextState.breadcrumb;
    const showBack = props.showBack ?? contextState.showBack;
    const onBack = props.onBack ?? contextState.onBack;

    const insets = useSafeAreaInsets();

    const handleBack = () => {
        if (onBack) {
            onBack();
        } else if (navigation.canGoBack()) {
            navigation.goBack();
        } else if (router.canGoBack()) {
            router.back();
        } else {
            console.log("Cannot go back, history empty");
        }
    };

    return (
        <LinearGradient
            colors={['#1E88E5', '#0D47A1']} // Top-Left to Bottom-Right Gradient
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
                styles.container,
                { paddingTop: insets.top, height: 80 + insets.top }
            ]}
        >
            <View style={styles.content}>
                <View style={styles.headerRow}>
                    {/* Left Icon (Back or Menu) based on Context or Props */}
                    <Appbar.Action
                        icon={showBack ? 'arrow-left' : (contextState.leftIcon === 'menu' ? 'menu' : 'arrow-left')}
                        color="#fff"
                        size={24}
                        onPress={() => {
                            if (showBack) handleBack();
                            else if (contextState.onLeftPress) contextState.onLeftPress();
                            else if (contextState.leftIcon === 'menu') navigation.dispatch(DrawerActions.openDrawer());
                            else handleBack();
                        }}
                        style={{ marginLeft: -8 }}
                    />

                    <View style={styles.textContainer}>
                        {/* Breadcrumb (Small, opaque) */}
                        <Text
                            numberOfLines={1}
                            style={[styles.breadcrumb, { color: 'rgba(255,255,255,0.7)' }]}
                        >
                            {breadcrumb || "Storage"}
                        </Text>

                        {/* Main Title */}
                        <Text
                            variant="headlineMedium"
                            style={[styles.title, { color: '#fff' }]}
                        >
                            {title}
                        </Text>
                    </View>

                    <View style={styles.actions}>
                        <Appbar.Action icon="magnify" onPress={() => { }} color="#fff" />
                        <Appbar.Action icon="dots-vertical" onPress={() => { }} color="#fff" />
                    </View>
                </View>
            </View>
        </LinearGradient>
    );
};

const styles = StyleSheet.create({
    container: {
        // Height handled inline
        justifyContent: 'flex-end',
        paddingBottom: 8,
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    content: {
        paddingHorizontal: 8,
        flex: 1,
        justifyContent: 'center',
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    textContainer: {
        flex: 1,
        marginLeft: 8,
        justifyContent: 'center',
    },
    breadcrumb: {
        fontSize: 12,
        marginBottom: 0,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    title: {
        fontWeight: '500', // Medium
        fontSize: 22,
        lineHeight: 28,
    },
    actions: {
        flexDirection: 'row',
    }
});
