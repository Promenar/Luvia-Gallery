import { Drawer } from 'expo-router/drawer';
import { useTheme } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { View } from 'react-native';
import { SolidDrawerContent } from '../../components/SolidDrawerContent';
import { SolidHeader } from '../../components/SolidHeader';
import { useHeader } from '../../contexts/HeaderContext';

export default function DrawerLayout() {
    const theme = useTheme();
    const headerState = useHeader();

    return (
        <Drawer
            drawerContent={(props) => <SolidDrawerContent {...props} />}
            screenOptions={{
                header: () => <SolidHeader />,
                headerShown: true,

                drawerStyle: {
                    backgroundColor: '#0F1115',
                    width: '80%',
                },
                drawerType: 'slide',
                overlayColor: 'rgba(0,0,0,0.7)',
                drawerActiveTintColor: '#FFC107',
                drawerInactiveTintColor: '#E0E0E0',
            }}
        >
            <Drawer.Screen
                name="index" // Discover
                options={{
                    drawerLabel: 'Discover',
                    title: 'Discover',
                    drawerIcon: ({ color, size }) => <MaterialCommunityIcons name="compass-outline" size={size} color={color} />,
                }}
            />
            <Drawer.Screen
                name="library"
                options={{
                    drawerLabel: 'Library',
                    title: 'Library',
                    drawerIcon: ({ color, size }) => <MaterialCommunityIcons name="image-multiple-outline" size={size} color={color} />,
                }}
            />
            <Drawer.Screen
                name="favorites"
                options={{
                    drawerLabel: 'Favorites',
                    title: 'Favorites',
                    drawerIcon: ({ color, size }) => <MaterialCommunityIcons name="star-outline" size={size} color={color} />,
                }}
            />
            <Drawer.Screen
                name="folders"
                options={{
                    drawerLabel: 'Folders',
                    title: 'Folders',
                    drawerIcon: ({ color, size }) => <MaterialCommunityIcons name="folder-outline" size={size} color={color} />,
                }}
            />
        </Drawer>
    );
}
