import type { ReactNode } from 'react';

interface SelectionActionSummaryProps {
  label: string;
  title: string;
  amountLabel: string;
  amount: string;
  unit: string;
  selection: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}

/** Presentation only: callers retain eligibility, selection and mutation authority. */
export function SelectionActionSummary({
  label,
  title,
  amountLabel,
  amount,
  unit,
  selection,
  description,
  actions,
  children,
}: SelectionActionSummaryProps) {
  return (
    <section
      aria-label={label}
      className="mb-5 w-fit min-w-0 max-w-full rounded-2xl border border-white/10 bg-state-gray p-5"
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-blue-light">
        {title}
      </p>
      <p
        aria-label={amountLabel}
        className="mt-1 break-words text-3xl font-bold tabular-nums tracking-tight text-lion"
      >
        {amount}{' '}
        <span className="text-xs font-medium tracking-normal text-blue-light">
          {unit}
        </span>
      </p>
      <p className="mt-2 text-xs text-blue-light">{selection}</p>
      {actions}
      <p className="mt-3 max-w-md text-xs leading-relaxed text-blue-light">
        {description}
      </p>
      {children}
    </section>
  );
}
