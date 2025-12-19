import React, { createContext, useContext, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MediaItem } from '../types';

export type CarouselSourceType = 'all' | 'folder' | 'file' | 'favorites';

interface CarouselConfig {
    sourceType: CarouselSourceType;
    sourceValue: string | null; // folderPath or fileId
    sourceName?: string; // friendly name for UI
}

interface ConfigContextType {
    carouselConfig: CarouselConfig;
    setCarouselConfig: (config: CarouselConfig) => Promise<void>;
    biometricsEnabled: boolean;
    setBiometricsEnabled: (enabled: boolean) => Promise<void>;
    resetConfig: () => Promise<void>;
    galleryLayout: 'grid' | 'masonry';
    setGalleryLayout: (layout: 'grid' | 'masonry') => Promise<void>;
    isConfigLoaded: boolean;
}

const ConfigContext = createContext<ConfigContextType | null>(null);

export const useConfig = () => {
    const context = useContext(ConfigContext);
    if (!context) throw new Error("useConfig must be used within ConfigProvider");
    return context;
};

const DEFAULT_CONFIG: CarouselConfig = {
    sourceType: 'all',
    sourceValue: null,
    sourceName: 'All Media'
};

export const ConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [carouselConfig, setConfigState] = useState<CarouselConfig>(DEFAULT_CONFIG);
    const [biometricsEnabled, setBiometricsEnabledState] = useState(false);
    const [galleryLayout, setGalleryLayoutState] = useState<'grid' | 'masonry'>('grid');
    const [isConfigLoaded, setIsConfigLoaded] = useState(false);

    useEffect(() => {
        loadConfig();
    }, []);

    const loadConfig = async () => {
        try {
            const savedCarousel = await AsyncStorage.getItem('carousel_config');
            if (savedCarousel) {
                setConfigState(JSON.parse(savedCarousel));
            }

            const savedBiometrics = await AsyncStorage.getItem('biometrics_enabled');
            if (savedBiometrics) {
                setBiometricsEnabledState(JSON.parse(savedBiometrics));
            }

            const savedLayout = await AsyncStorage.getItem('gallery_layout');
            if (savedLayout) {
                setGalleryLayoutState(JSON.parse(savedLayout) as 'grid' | 'masonry');
            }
        } catch (e) {
            console.error("Failed to load config", e);
        } finally {
            setIsConfigLoaded(true);
        }
    };

    const setCarouselConfig = async (newConfig: CarouselConfig) => {
        setConfigState(newConfig);
        await AsyncStorage.setItem('carousel_config', JSON.stringify(newConfig));
    };

    const setBiometricsEnabled = async (enabled: boolean) => {
        setBiometricsEnabledState(enabled);
        await AsyncStorage.setItem('biometrics_enabled', JSON.stringify(enabled));
    };

    const resetConfig = async () => {
        await setCarouselConfig(DEFAULT_CONFIG);
        await setBiometricsEnabled(false);
        await setGalleryLayout('grid');
    };

    const setGalleryLayout = async (layout: 'grid' | 'masonry') => {
        setGalleryLayoutState(layout);
        await AsyncStorage.setItem('gallery_layout', JSON.stringify(layout));
    };

    return (
        <ConfigContext.Provider value={{
            carouselConfig,
            setCarouselConfig,
            biometricsEnabled,
            setBiometricsEnabled,
            resetConfig,
            galleryLayout,
            setGalleryLayout,
            isConfigLoaded
        }}>
            {children}
        </ConfigContext.Provider>
    );
};
