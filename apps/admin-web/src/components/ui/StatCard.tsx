import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Props {
  title: string;
  value: string | number;
  icon: LucideIcon;
  color?: string;
  isLoading?: boolean;
  children?: React.ReactNode;
  /** Trend arrow + percentage below the value */
  trend?: {
    direction: 'up' | 'down' | 'neutral';
    percentage: number;
  } | null;
  /** Progress bar toward a target */
  target?: {
    current: number;
    max: number;
    label?: string;
  } | null;
  /** Click navigates to this route */
  href?: string;
  /** Trend goal comparison (e.g. "▲12% goal: 0%") */
  goal?: {
    value: number;
    label: string;
    /** When true, a lower trend value is better (e.g. disputes, pending) */
    lowerIsBetter?: boolean;
  } | null;
  /** 7-point sparkline via inline SVG */
  sparklineData?: number[];
}

/** Map Tailwind text-* classes to actual hex values from the theme */
const COLOR_MAP: Record<string, string> = {
  'text-lion': '#bd9f65',
  'text-platinum': '#e4e4e4',
  'text-blue-light': '#6f839f',
  'text-fire': '#dc3545',
  'text-forest': '#28a745',
  'text-purple-400': '#a78bfa',
};

function hexFromColorClass(cls = 'text-platinum'): string {
  return COLOR_MAP[cls] ?? '#e4e4e4';
}

function TrendBadge({ trend }: { trend: NonNullable<Props['trend']> }) {
  const arrow = trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→';
  const color =
    trend.direction === 'up'
      ? 'text-forest'
      : trend.direction === 'down'
        ? 'text-fire'
        : 'text-blue-light';

  return (
    <span className={`text-xs font-semibold ${color}`}>
      {arrow} {trend.percentage}%
    </span>
  );
}

function GoalBadge({
  trend,
  goal,
}: {
  trend: NonNullable<Props['trend']>;
  goal: NonNullable<Props['goal']>;
}) {
  // Para métricas donde lowerIsBetter (disputas, pendientes):
  //   meeting goal = trend.percentage <= goal.value
  //   otherwise:   meeting goal = trend.percentage >= goal.value
  const isMeeting = goal.lowerIsBetter
    ? trend.percentage <= goal.value
    : trend.percentage >= goal.value;

  const color = isMeeting ? 'text-forest' : 'text-fire';

  // No mostrar comparación si direction es 'neutral'
  if (trend.direction === 'neutral') return null;

  return (
    <span className={`text-[10px] ml-1.5 font-medium ${color}`}>
      {isMeeting ? '✓' : '✗'} goal: {goal.value}%
    </span>
  );
}

function TargetBar({ target }: { target: NonNullable<Props['target']> }) {
  const pct = target.max > 0 ? Math.min(Math.round((target.current / target.max) * 100), 100) : 0;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex justify-between text-[10px] text-blue-light">
        <span>{target.label ?? 'Progreso'}</span>
        <span>{pct}%</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full bg-forest transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Sparkline({ data, strokeColor }: { data: number[]; strokeColor: string }) {
  if (data.length < 2) return null;

  const width = 100;
  const height = 30;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map(
      (val, i) =>
        `${(i / (data.length - 1)) * width},${height - ((val - min) / range) * (height - 4) - 2}`,
    )
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-[30px]"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export const StatCard = ({
  title,
  value,
  icon: Icon,
  color = 'text-platinum',
  isLoading = false,
  children,
  trend,
  target,
  href,
  goal,
  sparklineData,
}: Props) => {
  const navigate = useNavigate();

  return (
  <div
    className={`bg-state-gray p-5 rounded-2xl border border-white/5 flex flex-col justify-between h-full transition-all duration-200 hover:border-lion/30 hover:shadow-[0_0_20px_rgba(189,159,101,0.05)] ${
      href ? 'cursor-pointer' : ''
    }`}
    onClick={() => href && navigate(href)}
    role={href ? 'button' : undefined}
    tabIndex={href ? 0 : undefined}
    onKeyDown={href ? (e) => { if (e.key === 'Enter' || e.key === ' ') navigate(href); } : undefined}
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

    {/* Trend indicator + goal comparison */}
    {!isLoading && trend && (
      <div className="mt-1 flex items-center">
        <TrendBadge trend={trend} />
        {goal && <GoalBadge trend={trend} goal={goal} />}
      </div>
    )}

    {/* Target progress bar */}
    {!isLoading && target && <TargetBar target={target} />}

    {/* Sparkline */}
    {!isLoading && sparklineData && sparklineData.length >= 2 && (
      <div className="mt-3">
        <Sparkline data={sparklineData} strokeColor={hexFromColorClass(color)} />
      </div>
    )}

    {children && <div className="mt-3">{children}</div>}
  </div>
);
};
