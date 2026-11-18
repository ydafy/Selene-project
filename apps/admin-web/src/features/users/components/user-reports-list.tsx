import type { Tables } from '@selene/types';
import { AlertTriangle, User } from 'lucide-react';
import { reportReasonLabel, reportStatusLabel } from '../logic/report-labels';

export type UserReport = Pick<
  Tables<'reports'>,
  | 'id'
  | 'created_at'
  | 'reason'
  | 'details'
  | 'status'
  | 'outcome'
  | 'resolved_at'
> & {
  reporter: Pick<Tables<'profiles'>, 'username'> | null;
};

export const UserReportsList = ({ reports }: { reports: UserReport[] }) => (
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
      {reports.map((r) => (
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
          <p className="text-sm font-bold text-platinum">
            {reportReasonLabel(r.reason)}
          </p>
          {r.details && (
            <p className="mt-1 text-sm text-platinum/80 leading-relaxed whitespace-pre-wrap break-words">
              {r.details}
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            <span
              className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded border ${
                r.status === 'open'
                  ? 'bg-fire/10 text-fire border-fire/20'
                  : 'bg-white/5 text-blue-light border-white/10'
              }`}
            >
              {reportStatusLabel(r)}
            </span>
          </div>
        </div>
      ))}
      {reports.length === 0 && (
        <div className="py-12 text-center">
          <p className="text-sm text-blue-light italic">
            Este usuario no tiene denuncias.
          </p>
        </div>
      )}
    </div>
  </div>
);
