/**
 * EmptyState 空状态组件
 * 用于显示空列表、无搜索结果、无收藏等场景
 */

import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { 
    Image as ImageIcon, 
    Heart, 
    FolderOpen, 
    Search, 
    WifiOff,
    Frown,
    Sparkles,
    Plus
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

type EmptyStateType = 
    | 'no-media' 
    | 'no-favorites' 
    | 'no-folders' 
    | 'no-search' 
    | 'no-network' 
    | 'error'
    | 'custom';

interface EmptyStateProps {
    type?: EmptyStateType;
    title?: string;
    description?: string;
    icon?: React.ReactNode;
    actionLabel?: string;
    onAction?: () => void;
}

const CONFIGS: Record<EmptyStateType, {
    icon: React.ReactNode;
    title: string;
    description: string;
    gradient: string[];
}> = {
    'no-media': {
        icon: <ImageIcon size={40} color="#a855f7" strokeWidth={1.5} />,
        title: '暂无媒体',
        description: '这里还没有任何媒体文件',
        gradient: ['rgba(168, 85, 247, 0.1)', 'rgba(168, 85, 247, 0.05)'],
    },
    'no-favorites': {
        icon: <Heart size={40} color="#ec4899" strokeWidth={1.5} />,
        title: '暂无收藏',
        description: '收藏的内容将显示在这里',
        gradient: ['rgba(236, 72, 153, 0.1)', 'rgba(236, 72, 153, 0.05)'],
    },
    'no-folders': {
        icon: <FolderOpen size={40} color="#f59e0b" strokeWidth={1.5} />,
        title: '暂无文件夹',
        description: '文件夹将显示在这里',
        gradient: ['rgba(245, 158, 11, 0.1)', 'rgba(245, 158, 11, 0.05)'],
    },
    'no-search': {
        icon: <Search size={40} color="#3b82f6" strokeWidth={1.5} />,
        title: '未找到结果',
        description: '尝试使用其他关键词搜索',
        gradient: ['rgba(59, 130, 246, 0.1)', 'rgba(59, 130, 246, 0.05)'],
    },
    'no-network': {
        icon: <WifiOff size={40} color="#ef4444" strokeWidth={1.5} />,
        title: '网络连接失败',
        description: '请检查网络连接后重试',
        gradient: ['rgba(239, 68, 68, 0.1)', 'rgba(239, 68, 68, 0.05)'],
    },
    'error': {
        icon: <Frown size={40} color="#ef4444" strokeWidth={1.5} />,
        title: '出错了',
        description: '发生了一些问题，请稍后重试',
        gradient: ['rgba(239, 68, 68, 0.1)', 'rgba(239, 68, 68, 0.05)'],
    },
    'custom': {
        icon: <Sparkles size={40} color="#a855f7" strokeWidth={1.5} />,
        title: '暂无内容',
        description: '',
        gradient: ['rgba(168, 85, 247, 0.1)', 'rgba(168, 85, 247, 0.05)'],
    },
};

export const EmptyState: React.FC<EmptyStateProps> = ({
    type = 'custom',
    title,
    description,
    icon,
    actionLabel,
    onAction,
}) => {
    const config = CONFIGS[type];

    const handleAction = () => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onAction?.();
    };

    return (
        <Animated.View 
            entering={FadeIn.duration(300)}
            className="flex-1 items-center justify-center px-8 py-12"
        >
            {/* 图标容器 */}
            <Animated.View 
                entering={FadeInDown.delay(100).duration(300)}
                className="mb-6"
            >
                <LinearGradient
                    colors={config.gradient as any}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    className="w-24 h-24 rounded-full items-center justify-center"
                >
                    {icon || config.icon}
                </LinearGradient>
            </Animated.View>

            {/* 标题 */}
            <Animated.Text 
                entering={FadeInDown.delay(200).duration(300)}
                className="text-xl font-bold text-zinc-900 dark:text-white text-center mb-2"
            >
                {title || config.title}
            </Animated.Text>

            {/* 描述 */}
            {(description || config.description) && (
                <Animated.Text 
                    entering={FadeInDown.delay(300).duration(300)}
                    className="text-sm text-zinc-500 dark:text-zinc-400 text-center mb-6 leading-5"
                >
                    {description || config.description}
                </Animated.Text>
            )}

            {/* 操作按钮 */}
            {actionLabel && onAction && (
                <Animated.View entering={FadeInDown.delay(400).duration(300)}>
                    <TouchableOpacity
                        onPress={handleAction}
                        className="flex-row items-center bg-brand-500 px-6 py-3 rounded-full"
                        style={{
                            shadowColor: '#a855f7',
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.3,
                            shadowRadius: 8,
                            elevation: 4,
                        }}
                    >
                        <Plus size={18} color="white" strokeWidth={2.5} />
                        <Text className="text-white font-semibold ml-2">
                            {actionLabel}
                        </Text>
                    </TouchableOpacity>
                </Animated.View>
            )}
        </Animated.View>
    );
};
