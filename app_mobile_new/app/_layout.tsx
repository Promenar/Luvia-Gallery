import FontAwesome from '@expo/vector-icons/FontAwesome';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider as NavigationThemeProvider, DarkTheme as NavigationDarkTheme } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider, adaptNavigationTheme } from 'react-native-paper';
import { SolidTheme } from '../constants/SolidTheme';
import 'react-native-reanimated';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { HeaderProvider, useHeader } from '../contexts/HeaderContext';
import { useRouter, useSegments } from 'expo-router';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const { DarkTheme: NavigationAdaptedTheme } = adaptNavigationTheme({
  reactNavigationLight: NavigationDarkTheme, // Force dark
  reactNavigationDark: NavigationDarkTheme,
  materialLight: SolidTheme,
  materialDark: SolidTheme,
});

const CombinedTheme = {
  ...NavigationAdaptedTheme,
  colors: {
    ...NavigationAdaptedTheme.colors,
    ...SolidTheme.colors,
  },
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    SpaceMono: require('../assets/fonts/SpaceMono-Regular.ttf'),
    ...FontAwesome.font,
  });

  // Expo Router uses Error Boundaries to catch errors in the navigation tree.
  useEffect(() => {
    if (error) throw error;
  }, [error]);

  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync();
    }
  }, [loaded]);

  if (!loaded) {
    return null;
  }

  return <RootLayoutNav />;
}

// Remove duplicate imports that were here


function RootLayoutNav() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AuthProvider>
        <PaperProvider theme={SolidTheme}>
          <NavigationThemeProvider value={CombinedTheme}>
            <HeaderProvider>
              <MainLayoutContent />
            </HeaderProvider>
          </NavigationThemeProvider>
        </PaperProvider>
      </AuthProvider>
    </GestureHandlerRootView>
  );
}

// Extract MainContent to use useHeader hook
function MainLayoutContent() {
  const headerState = useHeader();
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!isAuthenticated && !inAuthGroup) {
      // Redirect to Server Setup if not authenticated
      router.replace('/auth/server-setup');
    } else if (isAuthenticated && inAuthGroup) {
      // Redirect to Main if authenticated
      router.replace('/(drawer)/' as any);
    }
  }, [isAuthenticated, isLoading, segments]);

  // Hide Global Header on Auth Routes
  const showGlobalHeader = segments[0] !== 'auth';

  if (isLoading) {
    return <View style={{ flex: 1, backgroundColor: SolidTheme.colors.background }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: SolidTheme.colors.background }}>
      {/* 1. Global Custom Header (Hidden on Auth) */}

      {/* 2. Main Content */}
      <Stack
        screenOptions={{
          // 1. Hide System Header
          headerShown: false,

          // 2. Native Android 10+ Slide Animation
          animation: 'slide_from_right',

          // 3. Enable Full Screen Gestures (Critical for Native Feel)
          gestureEnabled: true,
          gestureDirection: 'horizontal',

          // 4. Optimize Duration and Presentation
          animationDuration: 350,
          presentation: 'card',

          // 5. Prevent Flickering
          contentStyle: { backgroundColor: SolidTheme.colors.background }
        }}
      >
        <Stack.Screen name="(drawer)" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
      </Stack>

      <StatusBar style="light" backgroundColor={SolidTheme.colors.background} />
    </View>
  );
}
