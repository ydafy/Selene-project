import { useState } from 'react';
import { CreditCard, Copy, Check, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import type { SellerBankAccount } from '@selene/types';

interface Props {
  bank: SellerBankAccount | null;
}

export const UserBankCard = ({ bank }: Props) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!bank?.clabe) return;
    navigator.clipboard.writeText(bank.clabe);
    setCopied(true);
    toast.success('CLABE copiada al portapapeles');
    setTimeout(() => setCopied(false), 2000);
  };

  if (!bank) {
    return (
      <div className="bg-state-gray rounded-3xl border border-white/5 p-8 text-center">
        <CreditCard size={40} className="text-blue-light/20 mx-auto mb-4" />
        <p className="text-blue-light italic text-sm">
          Sin cuenta bancaria registrada.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-state-gray to-night rounded-3xl border border-white/10 overflow-hidden shadow-2xl">
      <div className="p-6 border-b border-white/5 bg-white/5 flex justify-between items-center">
        <h3 className="font-bold text-platinum flex items-center gap-2 text-sm uppercase tracking-wider">
          <CreditCard size={18} className="text-lion" /> Datos Bancarios
        </h3>
        {bank.is_verified && (
          <div className="flex items-center gap-1.5 text-forest bg-forest/10 px-3 py-1 rounded-full border border-forest/20">
            <ShieldCheck size={12} />
            <span className="text-[10px] font-black uppercase">Auditada</span>
          </div>
        )}
      </div>

      <div className="p-8 space-y-6">
        <div>
          <p className="text-[10px] text-blue-light uppercase font-bold tracking-widest mb-1">
            Titular
          </p>
          <p className="text-xl font-bold text-platinum">
            {bank.account_holder_name || 'Titular no registrado'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] text-blue-light uppercase font-bold tracking-widest mb-1">
              Banco
            </p>
            <p className="text-sm font-medium text-platinum">
              {bank.bank_name || 'Desconocido'}
            </p>
          </div>
          <div>
            <p className="text-[10px] text-blue-light uppercase font-bold tracking-widest mb-1">
              CLABE
            </p>
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 group hover:text-lion transition-colors"
            >
              <code className="text-sm font-mono text-lion bg-lion/5 px-2 py-1 rounded border border-lion/10">
                {bank.clabe}
              </code>
              {copied ? (
                <Check size={14} className="text-forest" />
              ) : (
                <Copy
                  size={14}
                  className="text-blue-light group-hover:text-lion"
                />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
