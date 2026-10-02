// 缩略图 → 大图的共享元素过渡（View Transitions API）。
// 浏览器不支持、用户偏好减少动态效果或找不到源缩略图时直接执行更新，不做动画。
import { flushSync } from 'react-dom';

export const HERO_TRANSITION_NAME = 'luvia-hero';

let pendingHeroId: string | null = null;

/** 查看器中承接过渡的元素读取此值：仅在过渡进行中的目标媒体上返回过渡名。 */
export const getHeroTransitionName = (mediaId: string | undefined): string | undefined =>
    mediaId && pendingHeroId === mediaId ? HERO_TRANSITION_NAME : undefined;

const findSourceThumbnail = (mediaId: string): HTMLElement | null => {
    const candidates = document.querySelectorAll<HTMLElement>('[data-media-thumb]');
    for (const element of candidates) {
        if (element.dataset.mediaThumb === mediaId) return element;
    }
    return null;
};

export const canRunHeroTransition = (): boolean =>
    typeof document !== 'undefined'
    && typeof (document as Document & { startViewTransition?: unknown }).startViewTransition === 'function'
    && !(typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * 以共享元素过渡执行 update：源缩略图与查看器图片在过渡期间共用同一过渡名，
 * 由浏览器补间位置与尺寸；过渡结束后清除标记，避免与后续过渡冲突。
 */
export const runHeroTransition = (mediaId: string, update: () => void): void => {
    const source = canRunHeroTransition() ? findSourceThumbnail(mediaId) : null;
    if (!source) {
        update();
        return;
    }

    source.style.viewTransitionName = HERO_TRANSITION_NAME;
    const startViewTransition = (document as Document & {
        startViewTransition: (callback: () => void) => { finished: Promise<void> };
    }).startViewTransition.bind(document);

    const transition = startViewTransition(() => {
        // 旧画面已截取：移除源标记，再同步提交新画面，使查看器图片成为过渡终点
        source.style.viewTransitionName = '';
        pendingHeroId = mediaId;
        flushSync(update);
    });

    transition.finished.finally(() => {
        source.style.viewTransitionName = '';
        if (pendingHeroId === mediaId) pendingHeroId = null;
    });
};
