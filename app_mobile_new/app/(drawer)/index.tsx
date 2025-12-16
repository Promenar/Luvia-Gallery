import React, { useEffect } from 'react';
import { View, StyleSheet, ScrollView, FlatList, Dimensions, TouchableOpacity } from 'react-native';
import { useTheme, Text, Card, Button } from 'react-native-paper';
import { useRouter } from 'expo-router';
import { useHeader } from '../../contexts/HeaderContext';
import { useAuth } from '../../contexts/AuthContext';
import { LinearGradient } from 'expo-linear-gradient';

const { width } = Dimensions.get('window');

const CAROUSEL_ITEMS = [
    { id: '1', title: 'Recall 2024', subtitle: 'Your best moments', color: '#1E88E5' },
    { id: '2', title: 'Summer Trip', subtitle: 'Edited 2 days ago', color: '#43A047' },
    { id: '3', title: 'Videos', subtitle: 'Watch recent clips', color: '#E53935' },
];

export default function DiscoverScreen() {
    const theme = useTheme();
    const router = useRouter();
    const { setHeader } = useHeader();

    useEffect(() => {
        setHeader({
            title: "Discover",
            breadcrumb: "Home",
            showBack: false
        });
    }, [setHeader]);

    const renderCarouselItem = ({ item }: { item: typeof CAROUSEL_ITEMS[0] }) => (
        <View style={styles.carouselItem}>
            <LinearGradient
                colors={[item.color, '#000000']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.carouselCard}
            >
                <Text variant="headlineMedium" style={{ color: '#fff', fontWeight: 'bold' }}>{item.title}</Text>
                <Text variant="bodyMedium" style={{ color: 'rgba(255,255,255,0.8)' }}>{item.subtitle}</Text>
            </LinearGradient>
        </View>
    );

    return (
        <ScrollView
            style={[styles.container, { backgroundColor: theme.colors.background }]}
            contentContainerStyle={{ paddingBottom: 100 }}
        >
            {/* Carousel Section */}
            <View style={{ marginTop: 16, marginBottom: 24 }}>
                <FlatList
                    data={CAROUSEL_ITEMS}
                    horizontal
                    pagingEnabled
                    showsHorizontalScrollIndicator={false}
                    renderItem={renderCarouselItem}
                    keyExtractor={item => item.id}
                    snapToInterval={width - 32} // Card width + margin
                    decelerationRate="fast"
                    contentContainerStyle={{ paddingHorizontal: 16 }}
                />
            </View>

            {/* Recent Section */}
            <View style={styles.section}>
                <Text variant="titleLarge" style={[styles.sectionTitle, { color: theme.colors.primary }]}>
                    Recent Added
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingLeft: 16 }}>
                    {[1, 2, 3, 4, 5].map(i => (
                        <View key={i} style={[styles.recentItem, { backgroundColor: theme.colors.surfaceVariant }]}>
                            <Text style={{ color: '#fff' }}>Item {i}</Text>
                        </View>
                    ))}
                </ScrollView>
            </View>

            {/* Quick Actions */}
            <View style={styles.section}>
                <Text variant="titleLarge" style={[styles.sectionTitle, { color: theme.colors.primary }]}>
                    Quick Actions
                </Text>
                <View style={styles.grid}>
                    <Button mode="outlined" onPress={() => router.push('/(drawer)/library' as any)} style={styles.actionBtn}>
                        Library
                    </Button>
                    <Button mode="outlined" onPress={() => router.push('/(drawer)/folders' as any)} style={styles.actionBtn}>
                        Folders
                    </Button>
                </View>
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    carouselItem: {
        width: width - 48,
        height: 200,
        marginRight: 16,
    },
    carouselCard: {
        flex: 1,
        borderRadius: 16,
        padding: 24,
        justifyContent: 'flex-end'
    },
    section: {
        marginBottom: 24,
    },
    sectionTitle: {
        marginLeft: 16,
        marginBottom: 12,
        fontWeight: 'bold',
    },
    recentItem: {
        width: 120,
        height: 120,
        borderRadius: 12,
        marginRight: 12,
        justifyContent: 'center',
        alignItems: 'center'
    },
    grid: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        gap: 12
    },
    actionBtn: {
        flex: 1,
        borderColor: 'rgba(255,255,255,0.2)'
    }
});
