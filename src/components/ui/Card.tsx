import type { ReactNode } from 'react';

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`bg-panel rounded-lg border border-line ${className}`}>{children}</div>;
}

export function CardHeader({
  title,
  meta,
  action,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink truncate">{title}</h3>
        {meta && <p className="mt-0.5 text-xs text-ink-faint">{meta}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}
