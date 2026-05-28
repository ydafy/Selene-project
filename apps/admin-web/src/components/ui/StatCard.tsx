import type { LucideIcon } from 'lucide-react';

interface Props {
  title: string;
  value: string | number;
  icon: LucideIcon;
  color?: string;
  isLoading?: boolean;
  children?: React.ReactNode;
}

export const StatCard = ({
  title,
  value,
  icon: Icon,
  color = 'text-platinum',
  isLoading = false,
  children,
}: Props) => (
  <div className="bg-state-gray p-5 rounded-2xl border border-white/5 flex flex-col justify-between h-full">
    <div className="flex justify-between items-start">
      <div>
        <p className="text-[10px] text-blue-light font-bold uppercase tracking-widest">
          {title}
        </p>
        {isLoading ? (
          <div className="h-8 w-24 bg-white/5 animate-pulse rounded mt-2" />
        ) : (
          <p className={`text-2xl font-bold mt-2 ${color}`}>{value}</p>
        )}
      </div>
      <div className="p-2 bg-white/5 rounded-lg text-blue-light">
        <Icon size={20} />
      </div>
    </div>

    {children && <div className="mt-3">{children}</div>}
  </div>
);
