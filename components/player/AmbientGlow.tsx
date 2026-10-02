// 查看器背后的氛围光晕：颜色取自当前媒体主色，切换媒体时以颜色过渡平滑变化（不使用滤镜覆盖照片）。
import React from 'react';
import { getAuthUrl } from '../../utils/fileUtils';
import type { MediaItem } from '../../types';
import { getAmbientSource, useAmbientColor } from './ambient-color';

export const AmbientGlow: React.FC<{ item: MediaItem | null; intensity?: number }> = ({ item, intensity = 0.45 }) => {
    const source = getAmbientSource(item);
    const rgb = useAmbientColor(source ? getAuthUrl(source) : null);
    return (
        <div
            aria-hidden="true"
            data-testid="player-ambient-glow"
            data-ambient-rgb={rgb}
            className="pointer-events-none absolute inset-0 transition-[background-color] duration-700 ease-darkroom motion-reduce:transition-none"
            style={{
                backgroundColor: `rgba(${rgb}, ${intensity})`,
                maskImage: 'radial-gradient(closest-side, #000 0%, rgba(0,0,0,0.35) 55%, transparent 100%)',
                WebkitMaskImage: 'radial-gradient(closest-side, #000 0%, rgba(0,0,0,0.35) 55%, transparent 100%)',
            }}
        />
    );
};
