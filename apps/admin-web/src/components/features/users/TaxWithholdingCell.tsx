import { useState } from 'react';
import { ChevronDown, ChevronRight, Info } from 'lucide-react';

interface TaxWithholdingCellProps {
  tax: number | null;
}

export function TaxWithholdingCell({ tax }: TaxWithholdingCellProps) {
  const [expanded, setExpanded] = useState(false);

  if (tax === null || tax === undefined) {
    return <span className="text-blue-light/30">—</span>;
  }

  if (tax <= 0) {
    return <span className="text-blue-light/30">—</span>;
  }

  const isrAmount = tax / 9;
  const ivaAmount = (tax * 8) / 9;

  return (
    <div className="space-y-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 group cursor-pointer"
        aria-label={expanded ? 'Ocultar desglose fiscal' : 'Ver desglose fiscal'}
        aria-expanded={expanded}
      >
        <span className="text-xs font-medium text-fire">
          -${tax.toLocaleString()}
        </span>
        {expanded ? (
          <ChevronDown size={12} className="text-blue-light/50" />
        ) : (
          <ChevronRight
            size={12}
            className="text-blue-light/30 group-hover:text-blue-light/60"
          />
        )}
      </button>
      {expanded && (
        <div className="pl-2 border-l border-white/10 space-y-0.5">
          <div
            className="flex items-center gap-1"
            title="Acreditable en declaración anual"
          >
            <Info size={10} className="text-blue-light/30 shrink-0" />
            <span className="text-[10px] text-blue-light/70">
              ISR 1%: -$
              {isrAmount.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          <div
            className="flex items-center gap-1"
            title="Acreditable en declaración anual"
          >
            <Info size={10} className="text-blue-light/30 shrink-0" />
            <span className="text-[10px] text-blue-light/70">
              IVA 8%: -$
              {ivaAmount.toLocaleString(undefined, {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
            </span>
          </div>
          <span className="text-[9px] text-blue-light/40 italic block pt-0.5">
            Acreditables en declaración anual
          </span>
        </div>
      )}
    </div>
  );
}