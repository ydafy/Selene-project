import { ShieldCheck, AlertCircle } from 'lucide-react';
import { RANK_CONFIG } from '../../../lib/utils/ranks';

export const RankInfoPanel = () => {
  return (
    <div className="w-80 bg-state-gray border border-white/10 rounded-2xl shadow-2xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-center gap-2 border-b border-white/5 pb-3">
        <ShieldCheck size={16} className="text-lion" />
        <h5 className="text-xs font-bold text-platinum uppercase tracking-widest">
          Guía de Auditoría Selene
        </h5>
      </div>

      <div className="space-y-5">
        {RANK_CONFIG.LEVELS.map((lvl) => (
          <div key={lvl.name} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className={`text-xs font-bold ${lvl.color.split(' ')[0]}`}>
                {lvl.icon} {lvl.name}
              </span>
              <span className="text-[9px] text-blue-light font-bold bg-white/5 px-2 py-0.5 rounded uppercase">
                {lvl.min === 31 ? '+31 ventas' : `${lvl.min}-${lvl.max} ventas`}
              </span>
            </div>
            {/* INSTRUCCIÓN PARA EL ADMIN */}
            <p className="text-[10px] text-platinum/90 leading-relaxed pl-5 border-l border-white/5">
              {lvl.instruction}
            </p>
          </div>
        ))}
      </div>

      {/* REGLA DE SEGURIDAD */}
      <div className="bg-fire/10 p-3 rounded-xl border border-fire/20">
        <div className="flex gap-2">
          <AlertCircle size={14} className="text-fire shrink-0 mt-0.5" />
          <p className="text-[10px] text-fire leading-relaxed font-medium">
            Si la efectividad cae del{' '}
            <span className="underline">{RANK_CONFIG.QUALITY_FLOOR}%</span>, el
            usuario baja a "Novato" automáticamente por riesgo técnico.
          </p>
        </div>
      </div>
    </div>
  );
};
