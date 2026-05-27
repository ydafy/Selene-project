import { Wallet, Clock } from 'lucide-react';

interface Props {
  available: number;
  pending: number;
}

export const UserWalletCard = ({ available, pending }: Props) => (
  <div className="bg-state-gray rounded-3xl border border-white/5 p-8 shadow-xl relative overflow-hidden">
    <div className="absolute top-0 right-0 p-4 opacity-5">
      <Wallet size={80} />
    </div>

    <div className="flex flex-col md:flex-row justify-between gap-8">
      <div>
        <p className="text-[10px] text-forest font-bold uppercase tracking-widest mb-1 flex items-center gap-2">
          <div className="w-1.5 h-1.5 bg-forest rounded-full animate-pulse" />
          Saldo Disponible para Cobro
        </p>
        <p className="text-4xl font-black text-platinum">
          ${(available || 0).toLocaleString()}
        </p>
        <p className="text-xs text-blue-light mt-2 italic">
          Dinero que el usuario ya puede retirar a su banco.
        </p>
      </div>

      <div className="border-l border-white/5 pl-8">
        <p className="text-[10px] text-lion font-bold uppercase tracking-widest mb-1 flex items-center gap-2">
          <Clock size={12} />
          Saldo en Escrow (Pendiente)
        </p>
        <p className="text-2xl font-bold text-platinum/60">
          ${(pending || 0).toLocaleString()}
        </p>
        <p className="text-xs text-blue-light/50 mt-2">
          Ventas en tránsito o en periodo de garantía.
        </p>
      </div>
    </div>
  </div>
);
