import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS, AVPlaybackStatus } from 'expo-av';
import { MediaItem } from '../types';
import { getFileUrl } from './api';

interface AudioContextType {
    currentTrack: MediaItem | null;
    isPlaying: boolean;
    position: number;
    duration: number;
    playlist: MediaItem[];
    currentIndex: number;
    playTrack: (item: MediaItem, list: MediaItem[]) => Promise<void>;
    togglePlayPause: () => Promise<void>;
    seekTo: (millis: number) => Promise<void>;
    closePlayer: () => Promise<void>;
    minimizePlayer: () => void;
    maximizePlayer: () => void;
    isMinimized: boolean;
}

const AudioContext = createContext<AudioContextType | null>(null);

export const useAudio = () => {
    const context = useContext(AudioContext);
    if (!context) throw new Error('useAudio must be used within an AudioProvider');
    return context;
};

export const AudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const soundRef = useRef<Audio.Sound | null>(null);
    const [currentTrack, setCurrentTrack] = useState<MediaItem | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playlist, setPlaylist] = useState<MediaItem[]>([]);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [isMinimized, setIsMinimized] = useState(false);

    // Initialize Audio Mode
    useEffect(() => {
        Audio.setAudioModeAsync({
            playsInSilentModeIOS: true,
            staysActiveInBackground: true,
            interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
            interruptionModeIOS: InterruptionModeIOS.DoNotMix,
            shouldDuckAndroid: true,
        }).catch(e => console.error("Audio Mode Error:", e));

        return () => {
            if (soundRef.current) {
                soundRef.current.unloadAsync();
            }
        }
    }, []);

    const onPlaybackStatusUpdate = (status: AVPlaybackStatus) => {
        if (status.isLoaded) {
            setDuration(status.durationMillis || 0);
            setPosition(status.positionMillis);
            setIsPlaying(status.isPlaying);

            if (status.didJustFinish && !status.isLooping) {
                setIsPlaying(false);
                setPosition(0);
                // Auto-next could go here if we wanted
            }
        }
    };

    const playTrack = async (item: MediaItem, list: MediaItem[]) => {
        try {
            // If same track, just toggle or ensure playing
            if (currentTrack?.id === item.id && soundRef.current) {
                // Already loaded, just play
                await soundRef.current.playAsync();
                setIsPlaying(true);
                return;
            }

            // Unload play previous
            if (soundRef.current) {
                await soundRef.current.unloadAsync();
            }

            setCurrentTrack(item);
            setPlaylist(list);
            setCurrentIndex(list.findIndex(i => i.id === item.id));

            const { sound, status } = await Audio.Sound.createAsync(
                { uri: getFileUrl(item.id) },
                { shouldPlay: true },
                onPlaybackStatusUpdate
            );

            soundRef.current = sound;
            setIsPlaying(true);
            setIsMinimized(false); // Make sure we show full player initially or let UI decide
        } catch (error) {
            console.error("Play Track Error:", error);
        }
    };

    const togglePlayPause = async () => {
        if (!soundRef.current) return;
        if (isPlaying) {
            await soundRef.current.pauseAsync();
        } else {
            await soundRef.current.playAsync();
        }
    };

    const seekTo = async (millis: number) => {
        if (soundRef.current) {
            await soundRef.current.setPositionAsync(millis);
            setPosition(millis);
        }
    };

    const closePlayer = async () => {
        if (soundRef.current) {
            await soundRef.current.stopAsync();
            await soundRef.current.unloadAsync();
            soundRef.current = null;
        }
        setCurrentTrack(null);
        setIsPlaying(false);
        setPosition(0);
        setDuration(0);
        setIsMinimized(false);
    };

    const minimizePlayer = () => setIsMinimized(true);
    const maximizePlayer = () => setIsMinimized(false);

    return (
        <AudioContext.Provider value={{
            currentTrack,
            isPlaying,
            position,
            duration,
            playlist,
            currentIndex,
            playTrack,
            togglePlayPause,
            seekTo,
            closePlayer,
            minimizePlayer,
            maximizePlayer,
            isMinimized
        }}>
            {children}
        </AudioContext.Provider>
    );
};
