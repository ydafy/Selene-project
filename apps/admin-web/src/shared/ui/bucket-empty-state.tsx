import type { LucideIcon } from 'lucide-react';
import type { AccentTone } from './accent-tone';

const EMPTY_STATE_PRESENTATION: Record<AccentTone, string> = {
  lion: 'bg-lion/10 text-lion',
  amber: 'bg-amber-400/10 text-amber-400',
  forest: 'bg-forest/10 text-forest',
  muted: 'bg-white/5 text-blue-light',
};

interface BucketEmptyStateProps {
  icon: LucideIcon;
  tone: AccentTone;
  title: string;
  description: string;
}

/** Shared empty state for the read-only workbench buckets. */
export const BucketEmptyState = ({
  icon: Icon,
  tone,
  title,
  description,
}: BucketEmptyStateProps) => (
  <div className="bg-state-gray border border-white/5 rounded-3xl p-10 text-center flex flex-col items-center justify-center">
    <div className={`p-4 rounded-full mb-3 ${EMPTY_STATE_PRESENTATION[tone]}`}>
      <Icon size={28} />
    </div>
    <h3 className="text-base font-bold text-platinum">{title}</h3>
    <p className="text-xs text-blue-light mt-1 max-w-sm">{description}</p>
  </div>
);
