import { useState, useRef, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { fetchWithAuth, parseJsonResponse } from '../../lib/api';

interface CodeMatch { code: string; name: string; type: 'HS_CODE' | 'SERVICE_CODE'; }

interface Props {
  value: string;
  onChange: (code: string) => void;
  /** Fires with the full match (code, name, type) when a result is picked. */
  onPick?: (match: CodeMatch) => void;
  /** Text shown in the search input before typing. */
  hint?: string;
  className?: string;
}

// Searchable HS/Service code picker — queries the server catalog
// (GET /api/items/codes/search) instead of shipping the full ~900KB
// catalog in the client bundle.
export function CittaCodeSelect({ value, onChange, onPick, hint = 'Search HS or service code…', className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CodeMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const runSearch = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q.trim()) { setResults([]); setLoading(false); return; }
    setLoading(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetchWithAuth(`/api/items/codes/search?q=${encodeURIComponent(q)}&limit=30`);
        const data = await parseJsonResponse(res);
        setResults(Array.isArray(data) ? data : []);
      } catch { setResults([]); } finally { setLoading(false); }
    }, 250);
  };

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          <input
            value={open ? query : value}
            onChange={(e) => { setQuery(e.target.value); runSearch(e.target.value); }}
            onFocus={() => { setOpen(true); setQuery(''); runSearch(''); }}
            placeholder={open ? hint : (value || hint)}
            className="w-full pl-7 pr-2 py-1.5 border border-slate-200 rounded text-xs font-mono bg-white focus:border-emerald-600 focus:outline-none"
          />
        </div>
        {value && (
          <button type="button" onClick={() => { onChange(''); setQuery(''); }} className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer" title="Clear">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg text-xs">
          {loading && <div className="p-3 text-slate-400 text-center">Searching…</div>}
          {!loading && query.trim() === '' && (
            <div className="p-3 text-slate-400">Type a code (e.g. 8471.30) or term (e.g. laptop).</div>
          )}
          {!loading && query.trim() !== '' && results.length === 0 && (
            <div className="p-3 text-slate-400">No codes match “{query}”.</div>
          )}
          {!loading && results.map((r) => (
            <button
              key={`${r.type}-${r.code}`}
              type="button"
              onClick={() => { onChange(r.code); onPick?.(r); setOpen(false); setQuery(''); }}
              className="w-full text-left px-3 py-2 hover:bg-emerald-50 cursor-pointer flex items-center justify-between gap-2 border-b border-slate-50 last:border-0"
            >
              <span className="font-mono font-semibold text-slate-900">{r.code}</span>
              <span className="text-slate-500 truncate flex-1 mx-2">{r.name}</span>
              <span className="text-[9px] font-bold text-slate-400 uppercase shrink-0">{r.type === 'HS_CODE' ? 'HS' : 'SVC'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
