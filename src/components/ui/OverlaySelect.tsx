import { useMemo, useState } from 'react';
import { ChevronDown, Check, Search } from 'lucide-react';

interface Option { value: string; label: string; }
interface Props {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  hint?: string;
  label?: string;
}

// Options lists above this size get a search box + a capped render count,
// since dumping thousands of buttons into the overlay unfiltered is both a
// real performance problem and unusable to scan by eye.
const SEARCH_THRESHOLD = 20;
const MAX_RENDERED = 200;

export function OverlaySelect({ value, onChange, options, hint = 'Select', label }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find(o => o.value === value);
  const showSearch = options.length > SEARCH_THRESHOLD;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)) : options;
    return base.slice(0, MAX_RENDERED);
  }, [options, query]);
  const totalMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)).length : options.length;
  }, [options, query]);

  return (
    <>
      <div className="flex items-center gap-2">
        {label && <span className="text-xs font-medium text-slate-600">{label}</span>}
        <button
          onClick={() => { setOpen(true); setQuery(''); }}
          className="bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 font-medium flex items-center gap-2 hover:border-violet-300 hover:bg-violet-50/30 transition-colors cursor-pointer min-w-[140px] justify-between"
        >
          <span>{selected?.label || hint}</span>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
              <span className="font-bold text-slate-900 text-sm">{label || 'Select option'}</span>
              <button onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer">Close</button>
            </div>
            {showSearch && (
              <div className="px-3 pt-3">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    autoFocus
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Search…"
                    className="w-full pl-8 pr-3 py-1.5 border border-slate-200 rounded-lg text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                  />
                </div>
              </div>
            )}
            <div className="p-2 max-h-80 overflow-y-auto space-y-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-4 text-center text-xs text-slate-400">No matches.</div>
              ) : filtered.map(opt => {
                const active = opt.value === value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => { onChange(opt.value); setOpen(false); }}
                    className={`w-full text-left px-3 py-2.5 rounded-xl text-xs font-medium flex items-center justify-between border ${active ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-violet-50 hover:border-violet-200 cursor-pointer'}`}
                  >
                    <span>{opt.label}</span>
                    {active && <Check className="w-3.5 h-3.5" />}
                  </button>
                );
              })}
              {totalMatches > MAX_RENDERED && (
                <div className="px-3 py-2 text-center text-[11px] text-slate-400">+{totalMatches - MAX_RENDERED} more — refine your search</div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
