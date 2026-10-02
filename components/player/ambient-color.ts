// 氛围取色：从当前媒体的缩略图提取主色，作为查看器背后低对比光晕（暗房影院契约 1.1）。
import { useEffect, useState } from 'react';

/** 默认氛围色：低饱和黄铜（与 --ambient 默认值一致），取色失败或尚未完成时使用 */
export const DEFAULT_AMBIENT_RGB = '201, 141, 69';

const SAMPLE_SIZE = 24;

/**
 * 由 RGBA 像素计算氛围色：按饱和度与中等亮度加权平均，
 * 避免大面积纯黑、纯白或灰色背景把主色冲淡；结果再压暗、限饱和，保证作为光晕时不刺眼。
 * 返回 "r, g, b" 形式（可直接用于 rgb(var(--x) / a)），像素全部透明时返回 null。
 */
export const computeAmbientColor = (pixels: ArrayLike<number>): string | null => {
    let weightSum = 0;
    let red = 0;
    let green = 0;
    let blue = 0;
    for (let index = 0; index + 3 < pixels.length; index += 4) {
        const alpha = pixels[index + 3] / 255;
        if (alpha < 0.5) continue;
        const r = pixels[index];
        const g = pixels[index + 1];
        const b = pixels[index + 2];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const lightness = (max + min) / 510;
        const saturation = max === 0 ? 0 : (max - min) / max;
        // 中等亮度、较高饱和的像素权重最大；极暗或极亮像素仍保留小权重，防止全灰图无结果
        const weight = 0.05 + saturation * (1 - Math.abs(lightness - 0.5) * 1.6);
        if (weight <= 0) continue;
        weightSum += weight;
        red += r * weight;
        green += g * weight;
        blue += b * weight;
    }
    if (weightSum === 0) return null;

    let r = red / weightSum;
    let g = green / weightSum;
    let b = blue / weightSum;

    // 压到适合暗场光晕的亮度区间（最亮分量不超过 220）
    const peak = Math.max(r, g, b);
    if (peak > 220) {
        const scale = 220 / peak;
        r *= scale;
        g *= scale;
        b *= scale;
    }
    return `${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}`;
};

const cache = new Map<string, string>();

/** 读取缩略图并取色；同一地址结果缓存，跨域或解码失败时回落默认色。 */
export const useAmbientColor = (src: string | null | undefined): string => {
    const [color, setColor] = useState<string>(() => (src && cache.get(src)) || DEFAULT_AMBIENT_RGB);

    useEffect(() => {
        if (!src) {
            setColor(DEFAULT_AMBIENT_RGB);
            return;
        }
        const cached = cache.get(src);
        if (cached) {
            setColor(cached);
            return;
        }
        let cancelled = false;
        const image = new Image();
        image.decoding = 'async';
        image.onload = () => {
            if (cancelled) return;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = SAMPLE_SIZE;
                canvas.height = SAMPLE_SIZE;
                const context = canvas.getContext('2d', { willReadFrequently: true });
                if (!context) return;
                context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
                const result = computeAmbientColor(context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data);
                if (result) {
                    cache.set(src, result);
                    setColor(result);
                }
            } catch {
                // 画布被跨域污染等情况：保持默认色
            }
        };
        image.src = src;
        return () => {
            cancelled = true;
            image.onload = null;
        };
    }, [src]);

    return color;
};

/** 取当前媒体可用于取色的缩略图地址（服务端缩略图同源，可安全读取像素）。 */
export const getAmbientSource = (item: { thumbnailUrl?: string; url?: string; mediaType?: string } | null | undefined): string | null => {
    if (!item) return null;
    if (item.thumbnailUrl) return item.thumbnailUrl;
    return item.mediaType === 'image' && item.url ? item.url : null;
};
