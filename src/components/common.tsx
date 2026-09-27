import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { X, Music2 } from 'lucide-react';
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current!; d.showModal(); return () => d.close(); }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) { const r = e.currentTarget.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}><header><h2>{title}</h2><button className="icon-btn" aria-label="Fechar" onClick={onClose}><X size={22}/></button></header>{children}</dialog>;
}
export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) { return <div className="empty"><div className="empty-icon"><Music2 size={30}/></div><h3>{title}</h3><p>{text}</p>{action}</div>; }
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function ErrorBox({ message }: { message: string }) { return message ? <p role="alert" className="error-box">{message}</p> : null; }
export function Badge({ children, variant = '' }: { children: ReactNode; variant?: string }) { return <span className={`badge ${variant}`}>{children}</span>; }
export function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 20000); }
export function errorText(error: unknown) { return error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.'; }
