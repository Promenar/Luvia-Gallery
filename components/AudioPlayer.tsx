import React, { useRef, useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MediaItem } from '../types';
import { Icons } from './ui/Icon';
import { getAuthUrl } from '../utils/fileUtils';

interface AudioPlayerProps {
    audio: MediaItem;
    isMinimized: boolean;
    onMinimize: () => void;
    onExpand: () => void;
    onClose: () => void;
    playlist?: MediaItem[];
    onNext?: () => void;
    onPrevious?: () => void;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
    audio,
    isMinimized,
    onMinimize,
    onExpand,
    onClose,
    playlist = [],
    onNext,
    onPrevious
}) => {
    const audioRef = useRef<HTMLAudioElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1.0);
    const [isSeeking, setIsSeeking] = useState(false);

    // Format time as MM:SS
    const formatTime = (seconds: number): string => {
        if (!isFinite(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    // Load and play audio when audio prop changes
    // Load and play audio when audio prop changes
    useEffect(() => {
        if (audioRef.current && audio) {
            audioRef.current.src = getAuthUrl(audio.url || `/api/file/${audio.id}`);
            audioRef.current.load();
            audioRef.current.play().then(() => {
                setIsPlaying(true);
            }).catch(err => {
                console.error('Audio playback failed:', err);
                setIsPlaying(false);
            });
        }
    }, [audio]);

    // Update progress
    const handleTimeUpdate = () => {
        if (audioRef.current && !isSeeking) {
            setCurrentTime(audioRef.current.currentTime);
        }
    };

    // Set duration when loaded
    const handleLoadedMetadata = () => {
        if (audioRef.current) {
            setDuration(audioRef.current.duration);
        }
    };

    // Handle track end
    const handleEnded = () => {
        setIsPlaying(false);
        if (onNext) {
            onNext();
        }
    };

    // Play/Pause toggle
    const togglePlayPause = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
                setIsPlaying(false);
            } else {
                audioRef.current.play();
                setIsPlaying(true);
            }
        }
    };

    // Seek to position
    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newTime = parseFloat(e.target.value);
        setCurrentTime(newTime);
        if (audioRef.current) {
            audioRef.current.currentTime = newTime;
        }
    };

    // Volume control
    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = parseFloat(e.target.value);
        setVolume(newVolume);
        if (audioRef.current) {
            audioRef.current.volume = newVolume;
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyPress = (e: KeyboardEvent) => {
            if (!isMinimized) {
                if (e.code === 'Space') {
                    e.preventDefault();
                    togglePlayPause();
                } else if (e.code === 'ArrowLeft') {
                    e.preventDefault();
                    if (audioRef.current) {
                        audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 5);
                    }
                } else if (e.code === 'ArrowRight') {
                    e.preventDefault();
                    if (audioRef.current) {
                        audioRef.current.currentTime = Math.min(duration, audioRef.current.currentTime + 5);
                    }
                }
            }
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [isMinimized, isPlaying, duration]);

    const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

    // Mini Player (Bottom Bar)
    if (isMinimized) {
        return (
            <>
                <audio
                    ref={audioRef}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onEnded={handleEnded}
                />
                <motion.div
                    initial={{ x: -100, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: -100, opacity: 0 }}
                    className="fixed bottom-4 left-4 w-80 max-w-[calc(100vw-2rem)] bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-2xl z-50 overflow-hidden"
                >
                    {/* Progress bar */}
                    <div className="h-1 bg-gray-200 dark:bg-gray-700">
                        <div
                            className="h-full bg-purple-600 dark:bg-purple-500 transition-all duration-100"
                            style={{ width: `${progress}%` }}
                        />
                    </div>

                    {/* Controls */}
                    <div className="p-3">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-12 h-12 bg-gradient-to-br from-purple-500/20 to-blue-500/20 dark:from-purple-500/30 dark:to-blue-500/30 rounded-xl flex items-center justify-center flex-shrink-0">
                                <Icons.Music size={24} className="text-purple-600 dark:text-purple-400" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                                    {audio.name}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                    {formatTime(currentTime)} / {formatTime(duration)}
                                </p>
                            </div>
                            <button
                                onClick={onClose}
                                className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors flex-shrink-0"
                                title="Close"
                            >
                                <Icons.X size={18} className="text-gray-500 dark:text-gray-400" />
                            </button>
                        </div>

                        <div className="flex items-center justify-center gap-2 mb-2">
                            {onPrevious && (
                                <button
                                    onClick={onPrevious}
                                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                    title="Previous"
                                >
                                    <Icons.SkipBack size={18} className="text-gray-700 dark:text-gray-300" />
                                </button>
                            )}
                            <button
                                onClick={togglePlayPause}
                                className="p-3 bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 rounded-full transition-colors shadow-lg"
                                title={isPlaying ? 'Pause' : 'Play'}
                            >
                                {isPlaying ? (
                                    <Icons.Pause size={20} className="text-white" />
                                ) : (
                                    <Icons.Play size={20} className="text-white ml-0.5" />
                                )}
                            </button>
                            {onNext && (
                                <button
                                    onClick={onNext}
                                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                    title="Next"
                                >
                                    <Icons.SkipForward size={18} className="text-gray-700 dark:text-gray-300" />
                                </button>
                            )}
                            <button
                                onClick={onExpand}
                                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                title="Expand"
                            >
                                <Icons.ChevronUp size={18} className="text-gray-700 dark:text-gray-300" />
                            </button>
                        </div>
                    </div>
                </motion.div>
            </>
        );
    }

    // Full Player (Expanded Modal)
    return (
        <>
            <audio
                ref={audioRef}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={handleEnded}
            />
            <AnimatePresence>
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                    onClick={onMinimize}
                >
                    <motion.div
                        initial={{ scale: 0.9, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0.9, opacity: 0 }}
                        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-8 relative"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Header */}
                        <div className="flex items-center justify-between mb-8">
                            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Now Playing</h3>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={onMinimize}
                                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                    title="Minimize"
                                >
                                    <Icons.ChevronDown size={20} className="text-gray-700 dark:text-gray-300" />
                                </button>
                                <button
                                    onClick={onClose}
                                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                                    title="Close"
                                >
                                    <Icons.X size={20} className="text-gray-700 dark:text-gray-300" />
                                </button>
                            </div>
                        </div>

                        {/* Album Art / Icon */}
                        <div className="mb-8 flex justify-center">
                            <div className="w-48 h-48 bg-gradient-to-br from-purple-500/20 to-blue-500/20 dark:from-purple-500/30 dark:to-blue-500/30 rounded-2xl flex items-center justify-center shadow-lg">
                                <Icons.Music size={80} className="text-purple-600 dark:text-purple-400" />
                            </div>
                        </div>

                        {/* Track Info */}
                        <div className="text-center mb-8">
                            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
                                {audio.name}
                            </h2>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                {(audio.size / (1024 * 1024)).toFixed(1)} MB
                            </p>
                        </div>

                        {/* Progress Bar */}
                        <div className="mb-2">
                            <input
                                type="range"
                                min="0"
                                max={duration || 0}
                                value={currentTime}
                                onChange={handleSeek}
                                onMouseDown={() => setIsSeeking(true)}
                                onMouseUp={() => setIsSeeking(false)}
                                className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-600"
                            />
                        </div>
                        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-8">
                            <span>{formatTime(currentTime)}</span>
                            <span>{formatTime(duration)}</span>
                        </div>

                        {/* Playback Controls */}
                        <div className="flex items-center justify-center gap-4 mb-8">
                            {onPrevious && (
                                <button
                                    onClick={onPrevious}
                                    className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                                    title="Previous"
                                >
                                    <Icons.SkipBack size={24} className="text-gray-700 dark:text-gray-300" />
                                </button>
                            )}
                            <button
                                onClick={togglePlayPause}
                                className="p-4 bg-purple-600 hover:bg-purple-700 dark:bg-purple-500 dark:hover:bg-purple-600 rounded-full transition-colors shadow-lg"
                                title={isPlaying ? 'Pause' : 'Play'}
                            >
                                {isPlaying ? (
                                    <Icons.Pause size={32} className="text-white" />
                                ) : (
                                    <Icons.Play size={32} className="text-white ml-1" />
                                )}
                            </button>
                            {onNext && (
                                <button
                                    onClick={onNext}
                                    className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors"
                                    title="Next"
                                >
                                    <Icons.SkipForward size={24} className="text-gray-700 dark:text-gray-300" />
                                </button>
                            )}
                        </div>

                        {/* Volume Control */}
                        <div className="flex items-center gap-3">
                            <Icons.Volume2 size={20} className="text-gray-700 dark:text-gray-300" />
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={volume}
                                onChange={handleVolumeChange}
                                className="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-600"
                            />
                            <span className="text-sm text-gray-500 dark:text-gray-400 w-12 text-right">
                                {Math.round(volume * 100)}%
                            </span>
                        </div>
                    </motion.div>
                </motion.div>
            </AnimatePresence>
        </>
    );
};
