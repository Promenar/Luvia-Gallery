import { cn } from '@/lib/cn';

export interface BrandMarkProps {
  size?: number;
  className?: string;
}

/**
 * Luvia 定制矢量光圈徽标：6 片几何快门叶片与中心透光孔洞，
 * 兼具光学暗房镜头与美术馆画框的双重隐喻。
 */
export function BrandMark({ size = 28, className }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={cn('shrink-0 text-fg', className)}
    >
      <rect
        x="1.25"
        y="1.25"
        width="29.5"
        height="29.5"
        rx="9"
        stroke="currentColor"
        strokeOpacity="0.26"
        strokeWidth="1.25"
      />
      <circle
        cx="16"
        cy="16"
        r="10.2"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeOpacity="0.88"
      />
      <path
        d="M16 5.8L21.6 15.2M24.8 10.9L14.2 12.1M24.8 21.1L18.4 12.8M16 26.2L10.4 16.8M7.2 21.1L17.8 19.9M7.2 10.9L13.6 19.2"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeOpacity="0.72"
      />
      <circle cx="16" cy="16" r="3.4" fill="var(--accent)" fillOpacity="0.95" />
    </svg>
  );
}
