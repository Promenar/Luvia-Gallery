/**
 * Skeleton 骨架屏组件
 * 用于加载状态的占位显示
 */

import React, { useEffect } from 'react';
import { View, ViewStyle } from 'react-native';
import Animated, { 
    useSharedValue, 
    useAnimatedStyle, 
    withRepeat, 
    withTiming, 
    withSequence,
    Easing 
} from 'react-native-reanimated';

interface SkeletonProps {
    width?: number | string;
    height?: number;
    borderRadius?: number;
    style?: ViewStyle;
    variant?: 'text' | 'circle' | 'rect' | 'card';
}

// 基础骨架元素
export const Skeleton: React.FC<SkeletonProps> = ({
    width = '100%',
    height = 16,
    borderRadius = 8,
    style,
    variant = 'rect',
}) => {
    const opacity = useSharedValue(0.4);

    useEffect(() => {
        opacity.value = withRepeat(
            withSequence(
                withTiming(0.8, { 
                    duration: 1000, 
                    easing: Easing.inOut(Easing.ease) 
                }),
                withTiming(0.4, { 
                    duration: 1000, 
                    easing: Easing.inOut(Easing.ease) 
                })
            ),
            -1,
            true
        );
    }, [opacity]);

    const animatedStyle = useAnimatedStyle(() => ({
        opacity: opacity.value,
    }));

    const getVariantStyle = (): ViewStyle => {
        switch (variant) {
            case 'text':
                return { borderRadius: 4, height: height || 14 };
            case 'circle':
                return { borderRadius: 9999, width: height, height };
            case 'card':
                return { borderRadius: 16, height: height || 200 };
            default:
                return { borderRadius };
        }
    };

    return (
        <Animated.View
            style={[
                {
                    width,
                    backgroundColor: '#e4e4e7',
                    ...getVariantStyle(),
                },
                animatedStyle,
                style,
            ]}
        />
    );
};

// 媒体卡片骨架
export const MediaCardSkeleton: React.FC<{ aspectRatio?: number }> = ({ aspectRatio = 1 }) => {
    return (
        <View className="w-full" style={{ aspectRatio }}>
            <Skeleton variant="card" height="100%" borderRadius={16} />
        </View>
    );
};

// 文件夹卡片骨架
export const FolderCardSkeleton: React.FC = () => {
    return (
        <View className="w-full aspect-[4/3]">
            <Skeleton variant="card" height="100%" borderRadius={24} />
        </View>
    );
};

// 列表项骨架
export const ListItemSkeleton: React.FC = () => {
    return (
        <View className="flex-row items-center py-3 px-4">
            <Skeleton variant="circle" height={48} width={48} />
            <View className="flex-1 ml-3">
                <Skeleton variant="text" height={16} width="60%" style={{ marginBottom: 8 }} />
                <Skeleton variant="text" height={12} width="40%" />
            </View>
        </View>
    );
};

// 头部骨架
export const HeaderSkeleton: React.FC = () => {
    return (
        <View className="px-6 py-4">
            <Skeleton variant="text" height={28} width="40%" />
        </View>
    );
};

// 搜索栏骨架
export const SearchBarSkeleton: React.FC = () => {
    return (
        <View className="px-4 pb-3">
            <Skeleton variant="rect" height={48} borderRadius={12} />
        </View>
    );
};

// 轮播骨架
export const CarouselSkeleton: React.FC<{ height?: number }> = ({ height = 300 }) => {
    return (
        <View className="px-4">
            <Skeleton variant="card" height={height} borderRadius={24} />
        </View>
    );
};

// 完整页面骨架
export const PageSkeleton: React.FC<{ 
    showHeader?: boolean; 
    showSearch?: boolean;
    gridColumns?: number;
    itemCount?: number;
}> = ({ 
    showHeader = true, 
    showSearch = false,
    gridColumns = 3,
    itemCount = 12 
}) => {
    return (
        <View className="flex-1 bg-white dark:bg-black">
            {showHeader && <HeaderSkeleton />}
            {showSearch && <SearchBarSkeleton />}
            
            <View className="flex-row flex-wrap px-3">
                {Array.from({ length: itemCount }).map((_, index) => (
                    <View key={index} className="p-1" style={{ width: `${100 / gridColumns}%` }}>
                        <MediaCardSkeleton />
                    </View>
                ))}
            </View>
        </View>
    );
};

// 设置项骨架
export const SettingItemSkeleton: React.FC = () => {
    return (
        <View className="flex-row items-center p-4 bg-gray-50 dark:bg-zinc-900 rounded-2xl mb-2">
            <Skeleton variant="circle" height={40} width={40} />
            <View className="flex-1 ml-3">
                <Skeleton variant="text" height={16} width="50%" style={{ marginBottom: 6 }} />
                <Skeleton variant="text" height={12} width="30%" />
            </View>
        </View>
    );
};
