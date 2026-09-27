import { useEffect, useRef, useState, type RefObject } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { AlertTriangle, ArrowUpRight, Check, Play, WifiOff } from 'lucide-react';
import { db } from '../db';
import { getActivities, useActivities, type Activity } from '../activity';
import { pageKey, type Route } from '../router';

/** "Gravação da aula · Aula de interpretação" → "Gravação da aula". */
export const activityHead = (activity: Activity) => activity.label.split(' · ')[0] || activity.label;
/** A recording is shown (and stopped) before a practice that runs alongside it. */
export const byUrgency = (a: Activity, b: Activity) =>
  Number(b.kind === 'recording') - Number(a.kind === 'recording');

/**
 * The top bar's left side: "● Gravando · 12:34 [Voltar] [Encerrar]" or "▶ Prática · Rep 2/5 [Voltar]" while
 * something runs, otherwise the studio caption. Kept apart so the ticking clock re-renders only this bar.
 */
export function TopbarActivity({
  routeRef,
  onNavigate,
}: {
  routeRef: RefObject<Route>;
  onNavigate: (route: Route) => void;
}) {
  const activities = useActivities();
  // The screen each kind of activity started on, for "Voltar".
  const owners = useRef(new Map<Activity['kind'], Route>());
  useEffect(() => {
    const kinds = new Set(activities.map(a => a.kind));
    for (const kind of [...owners.current.keys()]) if (!kinds.has(kind)) owners.current.delete(kind);
    for (const kind of kinds) if (!owners.current.has(kind)) owners.current.set(kind, routeRef.current);
  }, [activities, routeRef]);
  const activity = [...activities].sort(byUrgency)[0];
  if (!activity) return <span className="topbar-caption">MEU ESTÚDIO</span>;
  const recording = activity.kind === 'recording';
  if (recording && !activity.stop)
    // Stopped, the file is being written: nothing to go back to or to end.
    return (
      <div className="activity-bar recording" role="status">
        <span className="activity-text">
          <strong>Salvando a gravação…</strong>
        </span>
      </div>
    );
  const show = () => {
    const owner = owners.current.get(activity.kind);
    if (owner && pageKey(owner) !== pageKey(routeRef.current)) return onNavigate(owner);
    // Already on its screen: bring the recorder or the practice console into view.
    const control = recording
      ? document.querySelector('.recorder .btn.danger')?.closest('.recorder')
      : document.querySelector('.practice-console');
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (control) control.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' });
    else window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' });
  };
  return (
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
          onClick={() => void activity.stop?.()}
        >
          Encerrar
        </button>
      )}
    </div>
  );
}

interface BackupSnapshot {
  days: number | null;
  age: string;
  staleAfter: number;
  download: boolean;
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
          const days = m.backupAgeDays(m.lastBackupAt());
          setSnapshot({
            days,
            age: days === null ? '' : m.describeBackupAge(days),
            staleAfter: m.BACKUP_STALE_DAYS,
            download: m.lastBackupHow() === 'download',
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
  const captures = useInterruptedCaptures();
  const captureText = !captures
    ? ''
    : captures === 1
      ? '1 gravação interrompida'
      : `${captures} gravações interrompidas`;
  // Nothing until both are known, so the pill does not flash a reassuring text first.
  const status =
    !backup || hasData === undefined
      ? null
      : backup.days === null
        ? hasData
          ? { long: 'Nenhum backup ainda', short: 'Sem backup', warn: true }
          : { long: 'Dados neste dispositivo', short: 'Dados locais', warn: false }
        : {
            long: `${backup.download ? 'Última exportação' : 'Último backup'} ${backup.age}`,
            short: `Backup ${backup.age}`,
            warn: !!hasData && backup.days > backup.staleAfter,
          };
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
          <span className="status-short">{captures}</span>
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
          aria-label={`${status.long}. Abrir Preferências e dados`}
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
