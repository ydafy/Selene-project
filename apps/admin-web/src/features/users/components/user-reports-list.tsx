import { AlertTriangle, User } from 'lucide-react';

interface Report {
  id: string;
  reason: string | null;
  status: string;
  created_at: string;
  reporter: {
    username: string | null;
  } | null;
}

export const UserReportsList = ({ reports }: { reports: Report[] }) => (
  <div className="bg-state-gray rounded-3xl border border-white/5 overflow-hidden shadow-xl">
    <div className="p-6 border-b border-white/5 bg-fire/5 flex justify-between items-center">
      <h3 className="font-bold text-fire flex items-center gap-2 text-sm uppercase tracking-wider">
        <AlertTriangle size={18} /> Denuncias Recibidas
      </h3>
      <span className="text-xs font-bold text-fire bg-fire/10 px-2 py-1 rounded-lg">
        {reports.length} reportes
      </span>
    </div>
    <div className="p-6 space-y-4 max-h-[500px] overflow-y-auto">
      {reports.map((r: Report) => (
        <div
          key={r.id}
          className="bg-night/40 p-4 rounded-2xl border border-white/5"
        >
          <div className="flex justify-between items-start mb-2">
            <span className="text-[10px] font-bold text-lion uppercase flex items-center gap-1">
              <User size={10} /> Por: @{r.reporter?.username || 'Anónimo'}
            </span>
            <span className="text-[9px] text-blue-light font-mono">
              {new Date(r.created_at).toLocaleDateString()}
            </span>
          </div>
          <p className="text-sm text-platinum leading-relaxed">
            "{r.reason || 'Sin motivo especificado'}"
          </p>
          <div className="mt-3 flex items-center gap-2">
            <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-white/5 text-blue-light border border-white/10">
              Status: {r.status}
            </span>
          </div>
        </div>
      ))}
      {reports.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-blue-light italic">
            Este usuario no tiene denuncias activas.
          </p>
        </div>
      )}
    </div>
  </div>
);
