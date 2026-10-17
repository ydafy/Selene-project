import { useState } from 'react';
import { Copy } from 'lucide-react';

interface CopyableReferenceProps {
  label: string;
  value: string;
}

export function CopyableReference({ label, value }: CopyableReferenceProps) {
  const [result, setResult] = useState<{ value: string; ok: boolean } | null>(
    null,
  );
  return (
    <div>
      <dt className="text-blue-light">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-start gap-2">
        <code className="min-w-0 break-all text-platinum">{value}</code>
        <button
          type="button"
          aria-label={`Copiar ${label}`}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setResult({ value, ok: true });
            } catch {
              setResult({ value, ok: false });
            }
          }}
          className="shrink-0 rounded-lg border border-white/10 p-2 text-blue-light hover:text-platinum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lion"
        >
          <Copy size={14} />
        </button>
        {result?.value === value ? (
          <span
            role={result.ok ? 'status' : 'alert'}
            className="basis-full text-xs text-blue-light"
          >
            {result.ok
              ? 'Copiado'
              : 'No se pudo copiar. Selecciona el texto y cópialo manualmente.'}
          </span>
        ) : null}
      </dd>
    </div>
  );
}
