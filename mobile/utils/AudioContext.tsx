import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
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
    playNext: () => Promise<void>;
    playPrevious: () => Promise<void>;
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
    const [currentTrack, setCurrentTrack] = useState<MediaItem | null>(null);
    const [playlist, setPlaylist] = useState<MediaItem[]>([]);
    const [currentIndex, setCurrentIndex] = useState(-1);
    const [isMinimized, setIsMinimized] = useState(false);

    // Reactive states for UI sync
    const [isPlaying, setIsPlaying] = useState(false);
    const [position, setPosition] = useState(0);
    const [duration, setDuration] = useState(0);

    // useAudioPlayer from expo-audio
    const player = useAudioPlayer('');

    // Configure Audio Mode globally
    useEffect(() => {
        setAudioModeAsync({
            playsInSilentMode: true,
        }).catch((e: Error) => console.error("Audio Mode Error:", e));
    }, []);

    // Status synchronization - 使用事件监听和快速轮询
    useEffect(() => {
        if (!player) return;

        const subscriptions: any[] = [];

        try {
            if (typeof (player as any).addListener === 'function') {
                const playingSub = (player as any).addListener('playingChange', (isPlaying: boolean) => {
                    setIsPlaying(isPlaying);
                });
                subscriptions.push(playingSub);

                const timeSub = (player as any).addListener('timeUpdate', (time: number) => {
                    setPosition(time * 1000);
                });
                subscriptions.push(timeSub);

                const durationSub = (player as any).addListener('durationChange', (dur: number) => {
                    setDuration(dur * 1000);
                });
                subscriptions.push(durationSub);
            } else {
                throw new Error("Events not supported");
            }
        } catch (e) {
            // 如果事件监听不支持，回退到轮询（提高频率至 100ms）
            const interval = setInterval(() => {
                if (player) {
                    setIsPlaying(player.playing);
                    setPosition(player.currentTime * 1000);
                    setDuration(player.duration * 1000);
                }
            }, 100);
            return () => clearInterval(interval);
        }

        return () => {
            subscriptions.forEach(sub => {
                try {
                    if (sub && typeof sub.remove === 'function') sub.remove();
                } catch (e) { }
            });
        };
    }, [player]);

    const playTrack = async (item: MediaItem, list: MediaItem[]) => {
        try {
            console.log("AudioContext: Playing track", item.name, getFileUrl(item.id));
            if (currentTrack?.id === item.id) {
                player.play();
                return;
            }

            setCurrentTrack(item);
            setPlaylist(list);
            setCurrentIndex(list.findIndex(i => i.id === item.id));

            // Important: Replace and play
            player.replace(getFileUrl(item.id));
            player.play();
            setIsMinimized(false);
        } catch (error) {
            console.error("Play Track Error:", error);
        }
    };

    const playNext = async () => {
        if (playlist.length === 0 || currentIndex === -1) return;
        const nextIndex = (currentIndex + 1) % playlist.length;
        await playTrack(playlist[nextIndex], playlist);
    };

    const playPrevious = async () => {
        if (playlist.length === 0 || currentIndex === -1) return;
        const prevIndex = (currentIndex - 1 + playlist.length) % playlist.length;
        await playTrack(playlist[prevIndex], playlist);
    };

    const togglePlayPause = async () => {
        if (player.playing) {
            player.pause();
            setIsPlaying(false); // 即时更新
        } else {
            player.play();
            setIsPlaying(true); // 即时更新
        }
    };

    const seekTo = async (millis: number) => {
        player.seekTo(millis / 1000);
        // Optimistic update for UI smoothness
        setPosition(millis);
    };

    const closePlayer = async () => {
        player.pause();
        player.replace('');
        setCurrentTrack(null);
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
            playNext,
            playPrevious,
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
