import { MapPin, Phone } from 'lucide-react';
import type { Address } from '@selene/types';

interface Props {
  addresses: Address[];
}

export const UserAddressesList = ({ addresses }: Props) => {
  return (
    <div className="bg-state-gray rounded-3xl border border-white/5 p-6 shadow-xl">
      <h3 className="font-bold text-platinum mb-6 flex items-center gap-2">
        <MapPin size={18} className="text-lion" /> Libreta de Direcciones
      </h3>

      {addresses.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {addresses.map((addr: Address) => (
            <div
              key={addr.id}
              className={`p-5 rounded-2xl border transition-all ${
                addr.is_default
                  ? 'border-lion/30 bg-lion/5 shadow-[0_0_15px_rgba(189,159,101,0.05)]'
                  : 'border-white/5 bg-night/40 hover:border-white/10'
              }`}
            >
              <div className="flex justify-between items-start mb-3">
                <span className="text-xs font-bold text-platinum uppercase tracking-wider">
                  {addr.label || 'Dirección'}
                </span>
                {addr.is_default && (
                  <span className="text-[9px] font-black text-lion bg-lion/10 px-2 py-0.5 rounded-full border border-lion/20 uppercase">
                    Principal
                  </span>
                )}
              </div>

              <p className="text-sm text-blue-light leading-relaxed">
                {addr.street_line1}
                {addr.street_line2 ? `, ${addr.street_line2}` : ''}
                <br />
                {addr.district}, {addr.city}
                <br />
                {addr.state}, {addr.country}. CP {addr.zip_code}
              </p>

              <div className="mt-4 pt-3 border-t border-white/5 flex items-center gap-2 text-blue-light/60">
                <Phone size={12} />
                <span className="text-[11px] font-medium">{addr.phone}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-12 text-center bg-night/20 rounded-2xl border border-dashed border-white/5">
          <p className="text-sm text-blue-light italic">
            No hay direcciones registradas para este usuario.
          </p>
        </div>
      )}
    </div>
  );
};
