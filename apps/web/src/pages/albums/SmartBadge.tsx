import { Funnel } from 'lucide-react';
import { cn } from '@/lib/cn';

/** 智能相册标记（原型 .ac .smart）。 */
export function SmartBadge({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-[5px] rounded-full bg-black/45 px-[9px] py-[3px] text-[11.5px] text-white backdrop-blur-[8px]', className)}>
      <Funnel className="size-3" strokeWidth={1.8} />智能
    </span>
  );
}
