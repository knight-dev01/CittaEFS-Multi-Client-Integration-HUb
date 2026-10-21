import type { LucideIcon } from 'lucide-react';

interface Props {
  icon?: LucideIcon;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Right-aligned action cluster (buttons/badges). */
  actions?: React.ReactNode;
  /** Extra content rendered full-width under the header row (e.g. stats grid). */
  footer?: React.ReactNode;
}

// Shared dark page header used by every tab — one implementation instead of
// ~7 hand-rolled copies of the same slate-900 banner.
export function PageHeader({ icon: Icon, title, subtitle, actions, footer }: Props) {
  return (
    <div className="bg-slate-900 text-white rounded-lg p-6 border border-slate-800 shadow-sm font-sans">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="p-2 bg-slate-800 rounded-lg shrink-0">
              <Icon className="w-5 h-5 text-emerald-400" />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight truncate">{title}</h2>
            {subtitle && <p className="text-slate-400 text-xs mt-1">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {footer}
    </div>
  );
}
