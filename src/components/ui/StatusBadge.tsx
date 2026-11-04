import type { ReactNode } from 'react';

// The ONLY place amber / rose / neutral appear as state colour (everything
// else is ink or accent). Solid-filled so status never reads as an accent
// button. Pending uses near-black on amber — white on amber-400 fails contrast.
export type StatusTone = 'ok' | 'pending' | 'fail' | 'neutral';

const TONES: Record<StatusTone, string> = {
  ok: 'bg-emerald-700 text-white',
  pending: 'bg-amber-400 text-ink',
  fail: 'bg-rose-600 text-white',
  neutral: 'bg-slate-200 text-ink-soft',
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
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${TONES[tone]} ${className}`}
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
  NEEDS_REAUTH: 'fail',
  CANCELLED: 'neutral', DRAFT: 'neutral', INACTIVE: 'neutral', NOT_CONNECTED: 'neutral',
};

export function statusTone(status?: string): StatusTone {
  return STATUS_TONES[String(status ?? '').toUpperCase()] ?? 'neutral';
}

export function writebackTone(writeback?: string): StatusTone {
  return String(writeback ?? '').toUpperCase() === 'SYNCED' ? 'ok' : 'pending';
}
