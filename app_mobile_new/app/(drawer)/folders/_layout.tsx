import { Stack } from 'expo-router';
import React from 'react';

export default function FoldersLayout() {
    return (
        <Stack screenOptions={{
            headerShown: false,
            animation: 'slide_from_right',
            gestureEnabled: true,
            gestureDirection: 'horizontal',
            animationDuration: 350,
            presentation: 'card'
        }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="browse" />
        </Stack>
    );
}
