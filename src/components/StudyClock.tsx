import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pause, Play, Square, Timer } from 'lucide-react';
import { db } from '../db';
import { clock, defaultConfig, isWarmup, now, uid } from '../domain';
import {
  clearClock,
  isRunning,
  overlapSeconds,
  pauseClock,
  resumeClock,
  startClock,
  studySeconds,
  useStudyClock,
  type StudyClock as Clock,
} from '../study-clock';
import { plural } from '../segment-stats';
import { Field, Modal, errorText, useConfirm, type Notify } from './common';
import '../styles/study-clock.css';

/** Ticks once a second while the clock runs, so the display follows it. */
function useNow(active: boolean) {
  const [time, setTime] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setTime(Date.now());
    const timer = window.setInterval(() => setTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return time;
}

/** h:mm:ss beyond an hour, m:ss before. */
function duration(seconds: number) {
  const s = Math.floor(seconds);
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : clock(s);
}

/**
 * The study clock: start, pause, continue and end a study session from any screen. It sits in the sidebar
 * (the icon rail on iPad) and in the phone header, so it stays in view on the score screens too. Ending it
 * records the time in the history, attributed to the piece open at that moment unless another is chosen.
 */
export default function StudyClock({
  variant,
  currentPieceId,
  notify,
}: {
  variant: 'sidebar' | 'compact';
  currentPieceId?: string;
  notify: Notify;
}) {
  const state = useStudyClock();
  const running = isRunning(state);
  const time = useNow(running);
  const [ending, setEnding] = useState(false);
  const seconds = studySeconds(state, time);
  if (!state)
    return (
      <div className={`study-clock study-clock--${variant}`}>
        <button className="study-start" aria-label="Iniciar estudo" onClick={() => startClock()}>
          <Timer size={18} aria-hidden="true" />
          <span className="study-start-text">Iniciar estudo</span>
        </button>
      </div>
    );
  return (
    <div
      className={`study-clock study-clock--${variant} active ${running ? 'running' : 'paused'}`}
      role="group"
      aria-label="Relógio da sessão de estudo"
    >
      <span className="study-time" role="timer" aria-live="off">
        <span className="study-label">
          <span className={`study-dot ${running ? '' : 'paused'}`} aria-hidden="true" />
          {running ? 'Estudando' : 'Pausado'}
        </span>
        <strong>{duration(seconds)}</strong>
      </span>
      <span className="study-actions">
        {running ? (
          <button
            className="study-action"
            aria-label="Pausar o relógio de estudo"
            onClick={() => pauseClock()}
          >
            <Pause size={16} aria-hidden="true" />
            <span className="study-action-text">Pausar</span>
          </button>
        ) : (
          <button
            className="study-action"
            aria-label="Continuar o relógio de estudo"
            onClick={() => resumeClock()}
          >
            <Play size={16} fill="currentColor" aria-hidden="true" />
            <span className="study-action-text">Continuar</span>
          </button>
        )}
        <button
          className="study-action stop"
          aria-label="Encerrar a sessão de estudo"
          onClick={() => {
            // The time to record is fixed while the dialog is open.
            pauseClock();
            setEnding(true);
          }}
        >
          <Square size={13} fill="currentColor" aria-hidden="true" />
          <span className="study-action-text">Encerrar</span>
        </button>
      </span>
      {ending && (
        <EndDialog
          state={state}
          currentPieceId={currentPieceId}
          notify={notify}
          onClose={() => setEnding(false)}
        />
      )}
    </div>
  );
}

/** Beyond this, the clock was probably left running: the dialog says so. */
const LONG_SESSION = 3 * 60 * 60;

function EndDialog({
  state,
  currentPieceId,
  notify,
  onClose,
}: {
  state: Clock;
  currentPieceId?: string;
  notify: Notify;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const total = studySeconds(state);
  const pieces = useLiveQuery(() => db.pieces.toArray()) ?? [];
  // Praticar records its own sessions: their time inside this clock is already in the history.
  const counted =
    useLiveQuery(async () => {
      const sessions = await db.sessions.where('startedAt').aboveOrEqual(state.startedAt).toArray();
      return sessions.reduce(
        (sum, s) =>
          sum +
          Math.min(s.activeSeconds, overlapSeconds(state, Date.parse(s.startedAt), Date.parse(s.endedAt))),
        0,
      );
    }, [state.startedAt]) ?? 0;
  const suggested = Math.max(0, Math.round((total - counted) / 60));
  const [minutes, setMinutes] = useState<string>(''),
    [pieceId, setPieceId] = useState(currentPieceId ?? ''),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false);
  const shown = minutes === '' ? String(suggested) : minutes;
  const value = Math.round(Number(shown.replace(',', '.')));
  const valid = Number.isFinite(value) && value >= 0 && value <= 600;
  const repertoire = pieces.filter(p => !isWarmup(p)).sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  const warmups = pieces.filter(isWarmup).sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      if (value > 0) {
        const piece = pieces.find(p => p.id === pieceId);
        const activeSeconds = value * 60;
        await db.sessions.add({
          id: uid(),
          pieceId: piece?.id,
          kind: piece ? 'piece' : 'free',
          title: piece ? `Estudo · ${piece.title}` : 'Sessão de estudo',
          hand: 'both',
          // A timer, not a metronome cycle: no tempo is attributed to it.
          config: {
            ...defaultConfig,
            metronome: false,
            mode: 'seconds',
            repetitions: 1,
            seconds: Math.min(3600, Math.max(5, activeSeconds)),
          },
          startedAt: state.startedAt,
          endedAt: now(),
          activeSeconds,
          completedRepetitions: 1,
          note: note.trim(),
          completed: true,
        });
        notify(`${plural(value, 'minuto de estudo registrado', 'minutos de estudo registrados')}.`);
      } else notify('Sessão encerrada. O tempo já estava nas sessões de Praticar.', 'info');
      clearClock();
      onClose();
    } catch (err) {
      notify(`Não foi possível registrar a sessão. ${errorText(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    const ok = await confirm({
      title: 'Descartar a sessão?',
      message: `Os ${duration(total)} do relógio não serão registrados.`,
      confirmLabel: 'Descartar',
      danger: true,
    });
    if (!ok) return;
    clearClock();
    onClose();
    notify('Sessão descartada.', 'info');
  };

  return (
    <Modal
      title="Registrar sessão de estudo"
      guard
      onClose={() => {
        // Closing keeps the session; it stays paused until "Continuar".
        onClose();
      }}
    >
      <form
        onSubmit={e => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="study-summary">
          Relógio: <strong>{duration(total)}</strong> de estudo, sem as pausas.
          {counted >= 60 && (
            <>
              {' '}
              {plural(
                Math.round(counted / 60),
                'minuto já está registrado',
                'minutos já estão registrados',
              )}{' '}
              pelas sessões de Praticar; o restante entra como estudo.
            </>
          )}
        </p>
        {total > LONG_SESSION && (
          <p className="study-warning">
            O relógio ficou ligado por muito tempo. Confira o tempo antes de salvar.
          </p>
        )}
        <Field label="Tempo a registrar (minutos)">
          <input
            data-autofocus
            inputMode="numeric"
            value={shown}
            onChange={e => setMinutes(e.target.value)}
            aria-invalid={!valid}
          />
        </Field>
        <Field label="O que você estudou?">
          <select value={pieceId} onChange={e => setPieceId(e.target.value)}>
            <option value="">Estudo geral</option>
            {repertoire.length > 0 && (
              <optgroup label="Repertório">
                {repertoire.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </optgroup>
            )}
            {warmups.length > 0 && (
              <optgroup label="Aquecimento">
                {warmups.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
        <Field label="Anotação (opcional)">
          <textarea
            rows={3}
            maxLength={3000}
            value={note}
            placeholder="O que você trabalhou, o que ficou para depois…"
            onChange={e => setNote(e.target.value)}
          />
        </Field>
        <footer className="modal-actions">
          <button type="button" className="btn secondary study-discard" onClick={() => void discard()}>
            Descartar
          </button>
          <button type="button" className="btn secondary" onClick={onClose}>
            Continuar depois
          </button>
          <button className="btn" disabled={busy || !valid}>
            Salvar sessão
          </button>
        </footer>
      </form>
    </Modal>
  );
}
