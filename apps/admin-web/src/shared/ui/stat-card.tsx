import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';

interface Props {
  title: string;
  value: string | number;
  icon: LucideIcon;
  children?: React.ReactNode;
  color?: string;
  isLoading?: boolean;
  href?: string;
  trend?: {
    direction: 'up' | 'down' | 'neutral';
    percentage: number;
  } | null;
}

function TrendBadge({ trend }: { trend: NonNullable<Props['trend']> }) {
  const arrow =
    trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→';
  const color =
    trend.direction === 'up'
      ? 'text-forest'
      : trend.direction === 'down'
        ? 'text-fire'
        : 'text-blue-light';

  return (
    <span
      className={`text-xs font-semibold ${color} mt-1 flex items-center gap-0.5`}
    >
      {arrow} {trend.percentage}% vs mes ant.
    </span>
  );
}

export const StatCard = ({
  title,
  value,
  icon: Icon,
  color = 'text-platinum',
  isLoading = false,
  href,
  trend,
  children,
}: Props) => {
  const content = (
    <div
      className={`bg-state-gray p-5 rounded-2xl border border-white/5 flex flex-col justify-between h-full transition-all duration-200 hover:border-lion/30 hover:shadow-[0_0_20px_rgba(189,159,101,0.05)] ${
        href ? 'cursor-pointer' : ''
      }`}
    >
      <div className="flex justify-between items-start">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] text-blue-light font-bold uppercase tracking-widest">
            {title}
          </p>
          {isLoading ? (
            <div className="h-8 w-24 bg-white/5 animate-pulse rounded mt-2" />
          ) : (
            <p className={`text-2xl font-bold mt-2 ${color}`}>{value}</p>
          )}
        </div>
        <div className="p-2 bg-white/5 rounded-lg text-blue-light shrink-0 ml-3">
          <Icon size={20} />
        </div>
      </div>

      {!isLoading && trend && <TrendBadge trend={trend} />}
      {children && <div className="mt-3">{children}</div>}
    </div>
  );

  if (href) {
    return (
      <Link to={href} className="block h-full text-inherit no-underline">
        {content}
      </Link>
    );
  }

  return content;
};
