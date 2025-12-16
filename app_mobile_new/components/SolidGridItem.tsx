import React, { useMemo } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Text, useTheme, Checkbox } from 'react-native-paper';
import { Image } from 'expo-image';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { MediaItem } from '../types';

interface SolidGridItemProps {
    item: MediaItem;
    onPress: (item: MediaItem) => void;
    onLongPress: (item: MediaItem) => void;
    selected: boolean;
    selectionMode: boolean; // If true, showing checkboxes?
    authHeaders?: Record<string, string>;
}

export const SolidGridItem: React.FC<SolidGridItemProps> = ({
    item,
    onPress,
    onLongPress,
    selected,
    selectionMode,
    authHeaders
}) => {
    const theme = useTheme();

    // "Solid Explorer" visual style based on screenshots:
    // Folders are Blue Icons. Files are Thumbnails. 
    // Selected items have a Blue rounded background (Azure Blue #448AFF).

    const isFolder = item.mediaType === 'folder';

    // Construct source with headers
    const imageSource = useMemo(() => {
        if (!item.thumbnailUrl) return null;
        return {
            uri: item.thumbnailUrl,
            headers: authHeaders
        };
    }, [item.thumbnailUrl, authHeaders]);

    return (
        <TouchableOpacity
            onPress={() => onPress(item)}
            onLongPress={() => onLongPress(item)}
            delayLongPress={300}
            activeOpacity={0.7}
            style={[
                styles.container,
                selected && { backgroundColor: 'rgba(68, 138, 255, 0.2)', borderRadius: 12 }
            ]}
        >
            <View style={styles.iconContainer}>
                {isFolder ? (
                    // Folder Icon
                    <MaterialCommunityIcons
                        name="folder"
                        size={64}
                        color="#448AFF" // Azure Blue to match Screenshot
                    />
                ) : (
                    // Media Thumbnail
                    <View style={styles.imageWrapper}>
                        {imageSource ? (
                            <Image
                                source={imageSource}
                                style={styles.image}
                                contentFit="cover"
                                cachePolicy="disk"
                                transition={200}
                            />
                        ) : (
                            <MaterialCommunityIcons
                                name="file-image"
                                size={64}
                                color={theme.colors.onSurfaceVariant}
                            />
                        )}
                        {/* Type Indicator (Video) */}
                        {item.mediaType === 'video' && (
                            <View style={styles.typeIcon}>
                                <MaterialCommunityIcons name="play-circle" size={20} color="#fff" />
                            </View>
                        )}
                    </View>
                )}

                {/* Selection Checkmark Overlay */}
                {(selected || selectionMode) && (
                    <View style={styles.selectionOverlay}>
                        <Checkbox
                            status={selected ? 'checked' : 'unchecked'}
                            color="#448AFF"
                            uncheckedColor="rgba(255,255,255,0.7)"
                        />
                    </View>
                )}
            </View>

            <Text
                variant="bodySmall"
                style={styles.label}
                numberOfLines={2}
                ellipsizeMode="middle"
            >
                {item.name}
            </Text>
        </TouchableOpacity>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        padding: 8,
        margin: 2,
        maxWidth: '50%', // 2 columns mostly
    },
    iconContainer: {
        width: '100%',
        aspectRatio: 1,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 4,
    },
    imageWrapper: {
        width: '90%',
        height: '90%',
        borderRadius: 8,
        overflow: 'hidden',
        backgroundColor: '#2C3038',
    },
    image: {
        width: '100%',
        height: '100%',
    },
    label: {
        textAlign: 'center',
        color: '#E0E0E0',
        fontSize: 12,
    },
    typeIcon: {
        position: 'absolute',
        bottom: 4,
        left: 4,
        backgroundColor: 'rgba(0,0,0,0.5)',
        borderRadius: 10,
    },
    selectionOverlay: {
        position: 'absolute',
        top: -4,
        left: -4,
    }
});
