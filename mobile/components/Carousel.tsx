import React from 'react';
import { View, Text, FlatList, Image, Dimensions, TouchableOpacity } from 'react-native';
import { MediaItem } from '../types';
import { getThumbnailUrl } from '../utils/api';
import { Play } from 'lucide-react-native';

interface CarouselProps {
    data: MediaItem[];
    onPress: (item: MediaItem) => void;
}

const { width } = Dimensions.get('window');
const ITEM_WIDTH = width * 0.8;
const SPACING = 10;

export const Carousel: React.FC<CarouselProps> = ({ data, onPress }) => {
    if (!data.length) return null;

    return (
        <View>
            <FlatList
                data={data}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: SPACING, paddingVertical: 10 }}
                snapToInterval={ITEM_WIDTH + SPACING * 2}
                decelerationRate="fast"
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                    <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => onPress(item)}
                        style={{ width: ITEM_WIDTH, marginHorizontal: SPACING }}
                        className="h-48 rounded-2xl overflow-hidden bg-gray-200 shadow-md elevation-4 relative"
                    >
                        <Image
                            source={{ uri: getThumbnailUrl(item.id) }}
                            className="w-full h-full object-cover"
                        />
                        {item.mediaType === 'video' && (
                            <View className="absolute inset-0 items-center justify-center bg-black/20">
                                <View className="bg-black/40 p-3 rounded-full backdrop-blur-md">
                                    <Play size={24} color="white" fill="white" />
                                </View>
                            </View>
                        )}
                        <View className="absolute bottom-0 left-0 right-0 bg-black/40 p-3">
                            <Text className="text-white font-medium" numberOfLines={1}>{item.name}</Text>
                        </View>
                    </TouchableOpacity>
                )}
            />
        </View>
    );
};
