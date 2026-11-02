import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import type { ReactNode } from 'react';

type Tone = 'ok' | 'warn' | 'fail' | 'info';

// Status colour stays on the icon and the left rule; the surface stays neutral
// so a notice never reads as an alert-tinted panel.
const TONES: Record<Tone, { icon: typeof Info; colour: string; rule: string }> = {
  ok: { icon: CheckCircle2, colour: 'text-emerald-700', rule: 'border-l-emerald-600' },
  warn: { icon: AlertTriangle, colour: 'text-amber-600', rule: 'border-l-amber-500' },
  fail: { icon: AlertTriangle, colour: 'text-rose-600', rule: 'border-l-rose-600' },
  info: { icon: Info, colour: 'text-ink-soft', rule: 'border-l-line-strong' },
};

export function Notice({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const { icon: Icon, colour, rule } = TONES[tone];
  return (
    <div className={`flex flex-col gap-3 rounded-lg border border-line border-l-2 bg-panel px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${rule}`}>
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${colour}`} />
        <div className="text-xs">
          {title && <p className="font-semibold text-ink">{title}</p>}
          {children && <div className="mt-0.5 text-ink-soft">{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0 sm:pl-4">{action}</div>}
    </div>
  );
}
