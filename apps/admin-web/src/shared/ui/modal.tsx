import { useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Mount while open; the native dialog owns focus containment and restoration. */
export function Modal({ title, onClose, children }: ModalProps) {
  const titleId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      aria-modal="true"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-3xl border border-white/10 bg-state-gray p-0 text-platinum shadow-2xl backdrop:bg-night/80 backdrop:backdrop-blur-sm"
    >
      <h2 id={titleId} className="sr-only">
        {title}
      </h2>
      <button
        type="button"
        aria-label="Cerrar detalle"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-lg p-2 text-blue-light hover:bg-white/5 hover:text-platinum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-lion"
      >
        <X size={18} />
      </button>
      {children}
    </dialog>
  );
}
