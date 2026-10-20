import type { ReactNode } from 'react';

// The ONLY place amber / rose / neutral-slate appear as state color in the
// two-color system (everything else is charcoal or emerald). Solid-filled so
// status is never confusable with the emerald accent used on buttons/links.
// Text colors chosen for WCAG AA on their fill (pending uses near-black on
// amber — white on amber-400 fails contrast).
export type StatusTone = 'ok' | 'pending' | 'fail' | 'neutral';

const TONES: Record<StatusTone, string> = {
  ok: 'bg-emerald-700 text-white',
  pending: 'bg-amber-400 text-slate-900',
  fail: 'bg-rose-600 text-white',
  neutral: 'bg-slate-200 text-slate-700',
};

export function StatusBadge({
  tone,
  children,
  className = '',
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, StatusTone> = {
  APPROVED: 'ok', SIGNED: 'ok', SYNCED: 'ok', MAPPED: 'ok', ACTIVE: 'ok',
  COMPLETED: 'ok', RESOLVED: 'ok', REGISTERED: 'ok', CONNECTED: 'ok',
  PENDING: 'pending', PENDING_NRS_STAMP: 'pending', QUEUED: 'pending',
  PENDING_REGISTRATION: 'pending', PROCESSING: 'pending', RETRY: 'pending',
  RETRYING: 'pending', INVITED: 'pending', UNMAPPED: 'pending', OPEN: 'pending',
  FAILED: 'fail', REJECTED: 'fail', DLQ: 'fail', SUSPENDED: 'fail',
  CANCELLED: 'neutral', DRAFT: 'neutral',
};

export function statusTone(status?: string): StatusTone {
  return STATUS_TONES[String(status ?? '').toUpperCase()] ?? 'neutral';
}

export function writebackTone(writeback?: string): StatusTone {
  return String(writeback ?? '').toUpperCase() === 'SYNCED' ? 'ok' : 'pending';
}
