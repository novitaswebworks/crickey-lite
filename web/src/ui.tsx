import { ReactNode, useEffect, useSyncExternalStore } from 'react';

// ---- toasts ----------------------------------------------------------------------------------
interface Toast { id: number; text: string; kind: 'ok' | 'error' }
let toasts: Toast[] = [];
let nextToast = 1;
const subs = new Set<() => void>();

export function toast(text: string, kind: Toast['kind'] = 'ok'): void {
  const t = { id: nextToast++, text, kind };
  toasts = [...toasts.slice(-3), t];
  subs.forEach((s) => s());
  setTimeout(() => { toasts = toasts.filter((x) => x.id !== t.id); subs.forEach((s) => s()); }, kind === 'error' ? 5000 : 1400);
}

export function Toasts() {
  const list = useSyncExternalStore((s) => { subs.add(s); return () => void subs.delete(s); }, () => toasts);
  return (
    <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`rounded-lg px-4 py-2 text-sm font-semibold shadow-xl ${t.kind === 'error' ? 'bg-red-600 text-white' : 'bg-slate-100 text-ink-950'}`}>{t.text}</div>
      ))}
    </div>
  );
}

// ---- modal -----------------------------------------------------------------------------------
export function Modal({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!onClose) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div role="dialog" aria-label={title} className={`max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-ink-600 bg-ink-800 p-5 shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-xl'}`}>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          {onClose && <button className="btn btn-ghost !min-h-[36px]" onClick={onClose} aria-label="Close">Esc ✕</button>}
        </div>
        {children}
      </div>
    </div>
  );
}

export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

export function Empty({ title, hint, children }: { title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="mx-auto mt-16 max-w-md rounded-2xl border border-dashed border-ink-600 p-8 text-center">
      <div className="text-lg font-bold">{title}</div>
      {hint && <p className="mt-2 text-sm text-slate-400">{hint}</p>}
      <div className="mt-4 flex justify-center gap-2">{children}</div>
    </div>
  );
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast('Copied');
}
