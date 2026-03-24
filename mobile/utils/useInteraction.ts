/**
 * Luvia Gallery 交互动画Hooks
 * 提供统一的交互反馈动画
 */

import { useCallback, useRef } from 'react';
import {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  withSequence,
  withRepeat,
  withDelay,
  Easing,
  interpolate,
  runOnJS,
  Animated,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { interaction, duration } from './designTokens';

// ============================================
// 按压缩放动画 Hook
// ============================================

interface UsePressScaleOptions {
  scale?: number;
  tension?: number;
  friction?: number;
  hapticStyle?: Haptics.ImpactFeedbackStyle;
}

export function usePressScale(options: UsePressScaleOptions = {}) {
  const {
    scale = interaction.scalePressed,
    tension = 300,
    friction = 20,
    hapticStyle = Haptics.ImpactFeedbackStyle.Light,
  } = options;

  const pressed = useSharedValue(false);
  const scaleValue = useSharedValue(1);

  const handlePressIn = useCallback(() => {
    pressed.value = true;
    scaleValue.value = withSpring(scale, {
      tension,
      friction,
    });
    Haptics.impactAsync(hapticStyle);
  }, [scale, tension, friction, hapticStyle, pressed, scaleValue]);

  const handlePressOut = useCallback(() => {
    pressed.value = false;
    scaleValue.value = withSpring(1, {
      tension,
      friction,
    });
  }, [tension, friction, pressed, scaleValue]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scaleValue.value }],
  }));

  return {
    animatedStyle,
    handlers: {
      onPressIn: handlePressIn,
      onPressOut: handlePressOut,
    },
    pressed,
  };
}

// ============================================
// 收藏心跳动画 Hook
// ============================================

export function useFavoriteAnimation() {
  const scale = useSharedValue(1);
  const isAnimating = useRef(false);

  const animate = useCallback(() => {
    if (isAnimating.current) return;
    isAnimating.current = true;

    // 心跳效果：快速放大 -> 缩小 -> 放大 -> 恢复
    scale.value = withSequence(
      withSpring(1.3, { tension: 300, friction: 10 }),
      withSpring(0.9, { tension: 300, friction: 10 }),
      withSpring(1.15, { tension: 300, friction: 10 }),
      withSpring(1, { tension: 200, friction: 12 })
    );

    // 触觉反馈
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    setTimeout(() => {
      isAnimating.current = false;
    }, 600);
  }, [scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return {
    animatedStyle,
    animate,
  };
}

// ============================================
// 淡入淡出动画 Hook
// ============================================

interface UseFadeOptions {
  duration?: number;
  initialOpacity?: number;
}

export function useFade(options: UseFadeOptions = {}) {
  const { duration: animDuration = 200, initialOpacity = 0 } = options;
  const opacity = useSharedValue(initialOpacity);

  const fadeIn = useCallback(() => {
    opacity.value = withTiming(1, { duration: animDuration });
  }, [opacity, animDuration]);

  const fadeOut = useCallback(() => {
    opacity.value = withTiming(0, { duration: animDuration });
  }, [opacity, animDuration]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return {
    animatedStyle,
    opacity,
    fadeIn,
    fadeOut,
  };
}

// ============================================
// 滑动动画 Hook
// ============================================

interface UseSlideOptions {
  direction?: 'up' | 'down' | 'left' | 'right';
  distance?: number;
  duration?: number;
}

export function useSlide(options: UseSlideOptions = {}) {
  const { direction = 'up', distance = 20, duration: animDuration = 300 } = options;

  const translateValue = useSharedValue(direction === 'down' || direction === 'right' ? -distance : distance);
  const opacity = useSharedValue(0);

  const slideIn = useCallback(() => {
    translateValue.value = withSpring(0, { tension: 200, friction: 20 });
    opacity.value = withTiming(1, { duration: animDuration });
  }, [translateValue, opacity, animDuration]);

  const slideOut = useCallback(() => {
    const targetDistance = direction === 'down' || direction === 'right' ? -distance : distance;
    translateValue.value = withTiming(targetDistance, { duration: animDuration });
    opacity.value = withTiming(0, { duration: animDuration });
  }, [translateValue, opacity, direction, distance, animDuration]);

  const animatedStyle = useAnimatedStyle(() => {
    const transform =
      direction === 'up' || direction === 'down'
        ? [{ translateY: translateValue.value }]
        : [{ translateX: translateValue.value }];

    return {
      opacity: opacity.value,
      transform,
    };
  });

  return {
    animatedStyle,
    slideIn,
    slideOut,
  };
}

// ============================================
// 缩放弹跳动画 Hook
// ============================================

export function useScaleBounce() {
  const scale = useSharedValue(0);

  const animateIn = useCallback(() => {
    scale.value = withSpring(1, {
      tension: 200,
      friction: 12,
    });
  }, [scale]);

  const animateOut = useCallback(() => {
    scale.value = withTiming(0, { duration: 150 });
  }, [scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return {
    animatedStyle,
    scale,
    animateIn,
    animateOut,
  };
}

// ============================================
// 脉冲动画 Hook (用于骨架屏、加载指示器)
// ============================================

export function usePulse() {
  const opacity = useSharedValue(0.5);

  const startPulse = useCallback(() => {
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.5, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      true
    );
  }, [opacity]);

  const stopPulse = useCallback(() => {
    opacity.value = withTiming(1, { duration: 200 });
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return {
    animatedStyle,
    startPulse,
    stopPulse,
  };
}

// ============================================
// 涟漪动画 Hook
// ============================================

export function useRipple() {
  const scale = useSharedValue(0);
  const opacity = useSharedValue(0.5);

  const triggerRipple = useCallback(() => {
    scale.value = 0;
    opacity.value = 0.5;

    scale.value = withTiming(2, { duration: 400 });
    opacity.value = withTiming(0, { duration: 400 });
  }, [scale, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return {
    animatedStyle,
    triggerRipple,
  };
}

// ============================================
// 触觉反馈工具
// ============================================

export const haptic = {
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  warning: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  selection: () => Haptics.selectionAsync(),
};

// ============================================
// 组合 Hook: 完整的按钮交互
// ============================================

interface UseButtonInteractionOptions {
  onPress?: () => void;
  hapticStyle?: Haptics.ImpactFeedbackStyle;
  scale?: number;
}

export function useButtonInteraction(options: UseButtonInteractionOptions = {}) {
  const { onPress, hapticStyle = Haptics.ImpactFeedbackStyle.Medium, scale = 0.97 } = options;

  const { animatedStyle, handlers, pressed } = usePressScale({ scale, hapticStyle });

  const handlePress = useCallback(() => {
    if (onPress) {
      onPress();
    }
  }, [onPress]);

  return {
    animatedStyle,
    handlers: {
      ...handlers,
      onPress: handlePress,
    },
    pressed,
  };
}

// ============================================
// 卡片交互 Hook
// ============================================

export function useCardInteraction(onPress?: () => void, onLongPress?: () => void) {
  const { animatedStyle, handlers, pressed } = usePressScale({
    scale: 0.98,
    hapticStyle: Haptics.ImpactFeedbackStyle.Light,
  });

  const handlePress = useCallback(() => {
    if (onPress) {
      onPress();
    }
  }, [onPress]);

  const handleLongPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (onLongPress) {
      onLongPress();
    }
  }, [onLongPress]);

  return {
    animatedStyle,
    handlers: {
      ...handlers,
      onPress: handlePress,
      onLongPress: handleLongPress,
    },
    pressed,
  };
}
