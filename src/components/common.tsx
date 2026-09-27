import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import BrandSymbol from './BrandSymbol';

export type NotifyTone = 'success' | 'error' | 'info';
/** Shows a toast. Use tone 'error' for failures so they are not styled as a success. */
export type Notify = (text: string, tone?: NotifyTone) => void;

/**
 * Open modals, the top one last. Everything outside a modal dialog is inert (hidden from screen readers, not
 * clickable), so the app shell shows its notices inside the top one.
 */
const openModals: HTMLDialogElement[] = [];
const modalListeners = new Set<() => void>();
let topModal: HTMLDialogElement | null = null;
function modalsChanged() {
  topModal = openModals.at(-1) ?? null;
  for (const listener of modalListeners) listener();
}
function subscribeModals(listener: () => void) {
  modalListeners.add(listener);
  return () => {
    modalListeners.delete(listener);
  };
}
/** The modal dialog on top, or null when none is open. */
export function useTopModal() {
  return useSyncExternalStore(
    subscribeModals,
    () => topModal,
    () => null,
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
  guard = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** When true (forms with typed input), a click on the backdrop does not close the dialog; Esc and the X still do. */
  guard?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    d.showModal();
    openModals.push(d);
    modalsChanged();
    // showModal focuses the first focusable element (the close button). React's autoFocus does not render an
    // attribute, so prefer an explicit data-autofocus target, then the first field of a form.
    d.querySelector<HTMLElement>(
      '[data-autofocus],[autofocus],form input:not([type=hidden]):not([disabled]),form textarea:not([disabled]),form select:not([disabled])',
    )?.focus();
    return () => {
      d.close();
      const at = openModals.indexOf(d);
      if (at >= 0) openModals.splice(at, 1);
      modalsChanged();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? 'wide' : ''}`}
      aria-labelledby={titleId}
      onCancel={e => {
        e.preventDefault();
        onClose();
      }}
      onClick={e => {
        if (guard || e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="icon-btn" aria-label="Fechar" onClick={onClose}>
          <X size={22} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as destructive. */
  danger?: boolean;
}
type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;
const ConfirmContext = createContext<ConfirmFn | null>(null);

/** In-app replacement for window.confirm (which looks out of place on iPad). Mounted once in App. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);
  const confirm = useCallback<ConfirmFn>(
    options =>
      new Promise<boolean>(resolve => {
        setRequest(current => {
          current?.resolve(false);
          return { ...options, resolve };
        });
      }),
    [],
  );
  const close = (ok: boolean) => {
    request?.resolve(ok);
    setRequest(null);
  };
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request && (
        <Modal title={request.title} onClose={() => close(false)}>
          <div className="confirm-message">{request.message}</div>
          <footer className="modal-actions">
            {/* A destructive question starts on Cancelar, so a stray or repeated Enter does not delete. */}
            <button
              type="button"
              data-autofocus={request.danger || undefined}
              className="btn secondary"
              onClick={() => close(false)}
            >
              {request.cancelLabel ?? 'Cancelar'}
            </button>
            <button
              type="button"
              data-autofocus={!request.danger || undefined}
              className={`btn ${request.danger ? 'danger' : ''}`}
              onClick={() => close(true)}
            >
              {request.confirmLabel ?? 'Confirmar'}
            </button>
          </footer>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

/**
 * Returns confirm(options) => Promise<boolean>, rendered as an app dialog.
 * Falls back to window.confirm outside a ConfirmProvider.
 */
export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  return (
    confirm ??
    (async (options: ConfirmOptions) =>
      window.confirm(typeof options.message === 'string' ? options.message : options.title))
  );
}
export function Empty({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <BrandSymbol size={30} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function ErrorBox({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="error-box">
      {message}
    </p>
  ) : null;
}
export function Badge({ children, variant = '' }: { children: ReactNode; variant?: string }) {
  return <span className={`badge ${variant}`}>{children}</span>;
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
}
export function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.';
}
