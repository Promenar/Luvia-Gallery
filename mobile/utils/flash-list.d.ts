import { FlashListProps } from '@shopify/flash-list';
import { MediaItem } from './types';

declare module '@shopify/flash-list' {
    export interface FlashListProps<T> {
        estimatedItemSize: number;
    }
}
