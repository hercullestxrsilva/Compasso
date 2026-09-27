import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowUpRight, Check, Play, WifiOff } from 'lucide-react';
import { db } from '../db';
import { getActivities, useActivities, type Activity } from '../activity';

/** "Gravação da aula · Aula de interpretação" → "Gravação da aula". */
export const activityHead = (activity: Activity) => activity.label.split(' · ')[0] || activity.label;
/** A recording is shown (and stopped) before a practice that runs alongside it. */
export const byUrgency = (a: Activity, b: Activity) =>
  Number(b.kind === 'recording') - Number(a.kind === 'recording');

/**
 * The top bar's left side: "● Gravando · 12:34 [Voltar] [Encerrar]" or "▶ Prática · Rep 2/5 [Voltar]" while
 * something runs, otherwise the studio caption. Kept apart so the ticking clock re-renders only this bar.
 * An activity always runs on the screen being shown (leaving it asks first), so "Voltar" brings its controls
 * into view and gives them the focus.
 */
export function TopbarActivity() {
  const activities = useActivities();
  // Holds the focus while the bar changes under it (Encerrar → "Salvando…" → the caption).
  const box = useRef<HTMLDivElement>(null);
  const activity = [...activities].sort(byUrgency)[0];
  const recording = activity?.kind === 'recording';
  const show = () => {
    const control = recording
      ? document.querySelector<HTMLElement>('.recorder .btn.danger')
      : document.querySelector<HTMLElement>('.practice-console .play-btn');
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    if (!control) return window.scrollTo({ top: 0, behavior });
    (control.closest('.recorder, .practice-console') ?? control).scrollIntoView({
      block: 'center',
      behavior,
    });
    control.focus({ preventScroll: true });
  };
  const end = () => {
    box.current?.focus({ preventScroll: true });
    void activity?.stop?.();
  };
  return (
    <div className="topbar-activity" ref={box} tabIndex={-1}>
      {!activity ? (
        <span className="topbar-caption">MEU ESTÚDIO</span>
      ) : recording && !activity.stop ? (
        // Stopped, the file is being written: nothing to go back to or to end.
        <div className="activity-bar recording" role="status">
          <span className="activity-text">
            <strong>Salvando a gravação…</strong>
          </span>
        </div>
      ) : (
        <div
          className={`activity-bar ${activity.kind}`}
          role="group"
          aria-label={`Em andamento: ${activity.label}`}
        >
          <span className="activity-icon" aria-hidden="true">
            {recording ? <span className="rec-dot" /> : <Play size={12} fill="currentColor" />}
          </span>
          <span className="activity-text">
            <strong>{recording ? 'Gravando' : activityHead(activity)}</strong>
            {activity.detail && <span className="activity-detail"> · {activity.detail}</span>}
          </span>
          <button
            type="button"
            className="activity-action"
            aria-label={recording ? 'Voltar para a gravação' : 'Voltar para a prática'}
            onClick={show}
          >
            Voltar
          </button>
          {recording && activity.stop && (
            <button
              type="button"
              className="activity-action stop"
              aria-label="Encerrar a gravação"
              onClick={end}
            >
              Encerrar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface BackupSnapshot {
  at: string | null;
  days: number | null;
  age: string;
  download: boolean;
  isStale: (hasData: boolean, days: number | null, newFiles?: number) => boolean;
}
/** When the last backup was made. backup.ts loads on demand, so its zip code stays out of the first load. */
function useLastBackup() {
  const [snapshot, setSnapshot] = useState<BackupSnapshot | null>(null);
  useEffect(() => {
    let alive = true,
      unsubscribe = () => {};
    import('../backup').then(
      m => {
        if (!alive) return;
        const sync = () => {
          const at = m.lastBackupAt(),
            days = m.backupAgeDays(at);
          setSnapshot({
            at,
            days,
            age: days === null ? '' : m.describeBackupAge(days),
            download: m.lastBackupHow() === 'download',
            isStale: m.isBackupStale,
          });
        };
        sync();
        // Another tab may export; "ontem" turns into "há 2 dias" while the iPad sleeps.
        const onVisible = () => {
          if (!document.hidden) sync();
        };
        window.addEventListener(m.BACKUP_EVENT, sync);
        window.addEventListener('storage', sync);
        document.addEventListener('visibilitychange', onVisible);
        unsubscribe = () => {
          window.removeEventListener(m.BACKUP_EVENT, sync);
          window.removeEventListener('storage', sync);
          document.removeEventListener('visibilitychange', onVisible);
        };
      },
      () => {},
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);
  return snapshot;
}

/**
 * Recordings interrupted before they were saved. A capture being recorded right now (here or in another tab)
 * holds a Web Lock, so it is not counted.
 */
function useInterruptedCaptures() {
  const ids = useLiveQuery(async () => (await db.captures.toCollection().primaryKeys()).map(String).sort());
  const key = ids?.join('|') ?? '';
  const [count, setCount] = useState(0);
  useEffect(() => {
    const list = key ? key.split('|') : [];
    if (!list.length) {
      setCount(0);
      return;
    }
    let alive = true;
    const check = async () => {
      let held: string[] | null = null;
      try {
        if (navigator.locks?.query) {
          const { CAPTURE_LOCK_PREFIX: prefix } = await import('./Recorder');
          const { held: locks = [] } = await navigator.locks.query();
          held = locks
            .map(lock => lock.name ?? '')
            .filter(name => name.startsWith(prefix))
            .map(name => name.slice(prefix.length));
        }
      } catch {
        held = null;
      }
      if (!alive) return;
      const recording = getActivities().filter(a => a.kind === 'recording').length;
      setCount(held ? list.filter(id => !held.includes(id)).length : Math.max(0, list.length - recording));
    };
    void check();
    // A take in another tab ends (and releases its lock) when that tab saves it or is closed.
    const timer = window.setInterval(() => void check(), 4000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [key]);
  return count;
}

/** The top bar's right side: interrupted recordings, offline state and when the last backup was made. */
export function TopbarStatus({
  online,
  capturesShown,
  onOpenSettings,
  onOpenCaptures,
}: {
  online: boolean;
  /** The current screen lists the interrupted recordings itself. */
  capturesShown: boolean;
  onOpenSettings: () => void;
  onOpenCaptures: () => void;
}) {
  const hasData = useLiveQuery(async () =>
    (
      await Promise.all([db.pieces.count(), db.lessons.count(), db.sessions.count(), db.recordings.count()])
    ).some(n => n > 0),
  );
  const backup = useLastBackup();
  const since = backup?.at;
  // Files added after the last backup are not in it (the same rule as in Preferências).
  const newFiles = useLiveQuery(
    async () => (since ? db.assets.filter(a => a.createdAt > since).count() : 0),
    [since],
  );
  const captures = useInterruptedCaptures();
  const captureText = !captures
    ? ''
    : captures === 1
      ? '1 gravação interrompida'
      : `${captures} gravações interrompidas`;
  // Nothing until everything is known, so the pill does not flash a reassuring text first.
  const status = (() => {
    if (!backup || hasData === undefined || newFiles === undefined) return null;
    const warn = backup.isStale(hasData, backup.days, newFiles);
    // The short text (phones) is always part of the long one, which starts the accessible name.
    const text =
      backup.days === null
        ? hasData
          ? { long: 'Sem backup ainda', short: 'Sem backup' }
          : { long: 'Dados neste dispositivo', short: 'Neste dispositivo' }
        : backup.download
          ? { long: `Última exportação ${backup.age}`, short: `Exportação ${backup.age}` }
          : { long: `Último backup ${backup.age}`, short: `Backup ${backup.age}` };
    const added =
      backup.days !== null && newFiles > 0
        ? ` · ${newFiles === 1 ? '1 arquivo novo' : `${newFiles} arquivos novos`}`
        : '';
    return {
      short: text.short,
      long: text.long + added,
      warn,
      label: `${text.long}${added}${warn ? '. Hora de fazer um backup' : ''}. Abrir Preferências e dados`,
    };
  })();
  return (
    <div className="topbar-status">
      {captureText && !capturesShown && (
        <button
          className="capture-notice"
          aria-label={`${captureText}: recuperar em Preferências e dados`}
          onClick={onOpenCaptures}
        >
          <AlertTriangle size={14} aria-hidden="true" />
          <span className="status-long">{captureText}</span>
          <span className="status-short">{captures === 1 ? '1 gravação' : `${captures} gravações`}</span>
        </button>
      )}
      {!online && (
        <span className="offline-chip" role="status">
          <WifiOff size={14} aria-hidden="true" />
          Offline
        </span>
      )}
      {status && (
        <button
          onClick={onOpenSettings}
          className={`storage-indicator backup-pill${status.warn ? ' stale' : ''}`}
          aria-label={status.label}
        >
          {status.warn ? (
            <AlertTriangle size={14} aria-hidden="true" />
          ) : (
            <Check size={14} aria-hidden="true" />
          )}
          <span className="status-long">{status.long}</span>
          <span className="status-short">{status.short}</span>
          <ArrowUpRight size={14} aria-hidden="true" className="status-arrow" />
        </button>
      )}
    </div>
  );
}
