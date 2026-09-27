import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Plus,
  ArrowLeft,
  Headphones,
  FileAudio,
  Sparkles,
  BookmarkPlus,
  Trash2,
  Check,
  Download,
  RotateCcw,
  RotateCw,
  Pencil,
} from 'lucide-react';
import { db } from '../db';
import { uid, now, localDay, formatDate, clock, type Lesson, type Note, type Task } from '../domain';
import { Field, Modal, Empty, ErrorBox, Badge, download, errorText, useConfirm, type Notify } from './common';
import Recorder from './Recorder';
import CaptureRecovery, { formatSize, setLessonAudio } from './CaptureRecovery';
import { aiFetch, AiError } from '../services';
import { LESSON_BITS_PER_SECOND, type CaptureProfile } from '../audio/recording';
import { draftMoment, noteTimeHint, stampTime, type NoteMoment } from '../lessons/noteTime';
import {
  MAX_UPLOAD_BYTES,
  PartialTranscript,
  cancelTranscription,
  checkSplit,
  runTranscription,
  useTranscription,
  type SplitCheck,
} from '../lessons/transcription';
import '../styles/lessons.css';

/** AI questions saved as lesson notes start with this, so other screens (e.g. the next-lesson report) can find them. */
export const QUESTION_PREFIX = 'Pergunta para a próxima aula: ';
const PROFILE_KEY = 'compasso.lessonRecordingProfile';
/** "a, b e c" */
const listText = (items: string[]) =>
  items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items.at(-1)}` : (items[0] ?? '');
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const isAudioFile = (file: File) =>
  file.type.startsWith('audio/') || /\.(mp3|m4a|wav|webm|ogg|mp4|aac)$/i.test(file.name);

interface Proposal {
  summary: string;
  tasks: { title: string; evidence: string; timestamp: number | null }[];
  questions: string[];
}
type LessonDetails = Pick<Lesson, 'title' | 'date' | 'teacher' | 'pieceId'>;

/** Updates a lesson; when its piece changes, the notes and tasks it created follow the new piece. */
export async function saveLessonDetails(lesson: Lesson, details: LessonDetails) {
  await db.transaction('rw', [db.lessons, db.notes, db.tasks], async () => {
    await db.lessons.update(lesson.id, details);
    if (details.pieceId === lesson.pieceId) return;
    await db.notes
      .where('lessonId')
      .equals(lesson.id)
      .filter(n => (n.pieceId ?? '') === lesson.pieceId)
      .modify({ pieceId: details.pieceId || undefined });
    await db.tasks
      .where('lessonId')
      .equals(lesson.id)
      .filter(t => t.pieceId === lesson.pieceId)
      .modify({ pieceId: details.pieceId });
  });
}

function LessonForm({
  lesson,
  onClose,
  onSaved,
  onDelete,
}: {
  lesson?: Lesson;
  onClose: () => void;
  onSaved: (id: string) => void;
  onDelete?: () => void;
}) {
  const pieces = useLiveQuery(() => db.pieces.toArray()) ?? [];
  const [title, setTitle] = useState(lesson?.title ?? ''),
    [date, setDate] = useState(lesson?.date ?? localDay()),
    [teacher, setTeacher] = useState(lesson?.teacher ?? ''),
    [pieceId, setPieceId] = useState(lesson?.pieceId ?? ''),
    [error, setError] = useState('');
  return (
    <Modal title={lesson ? 'Editar aula' : 'Registrar aula'} onClose={onClose} guard>
      <form
        onSubmit={async e => {
          e.preventDefault();
          try {
            const details = { title: title.trim(), date, teacher: teacher.trim(), pieceId };
            if (lesson) {
              await saveLessonDetails(lesson, details);
              onSaved(lesson.id);
            } else {
              const id = uid();
              await db.lessons.add({ id, ...details, transcript: '', summary: '', createdAt: now() });
              onSaved(id);
            }
            onClose();
          } catch (err) {
            setError(errorText(err));
          }
        }}
      >
        <Field label="Título">
          <input
            data-autofocus
            required
            value={title}
            maxLength={160}
            onChange={e => setTitle(e.target.value)}
            placeholder="Ex.: Aula de interpretação"
          />
        </Field>
        <div className="form-grid">
          <Field label="Data">
            <input type="date" required value={date} onChange={e => setDate(e.target.value)} />
          </Field>
          <Field label="Professor(a)">
            <input value={teacher} maxLength={120} onChange={e => setTeacher(e.target.value)} />
          </Field>
        </div>
        <Field label="Peça relacionada">
          <select value={pieceId} onChange={e => setPieceId(e.target.value)}>
            <option value="">Aula geral</option>
            {pieces.map(p => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </Field>
        <ErrorBox message={error} />
        <footer className="modal-actions lesson-form-actions">
          {onDelete && (
            <button type="button" className="link-btn danger-link" onClick={onDelete}>
              <Trash2 size={16} />
              Excluir aula
            </button>
          )}
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={!title.trim() || !date}>
            {lesson ? 'Salvar alterações' : 'Criar aula'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export default function Lessons({
  notify,
  selectedId,
  onSelect,
}: {
  notify: Notify;
  /** Optional: lets the app shell open a lesson directly (e.g. from Hoje). */
  selectedId?: string;
  onSelect?: (id: string) => void;
}) {
  const loaded = useLiveQuery(() => db.lessons.orderBy('date').reverse().toArray());
  const lessons = loaded ?? [];
  const [form, setForm] = useState(false),
    [localSelected, setLocalSelected] = useState('');
  const selected = selectedId ?? localSelected,
    select = onSelect ?? setLocalSelected;
  const lesson = lessons.find(l => l.id === selected);
  // A lesson opened from the address or from Hoje: wait for it instead of flashing the list.
  if (selected && !loaded) return null;
  return lesson ? (
    <LessonDetail key={lesson.id} lesson={lesson} onBack={() => select('')} notify={notify} />
  ) : (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">APRENDA. ESCUTE. REVISITE.</span>
          <h1>Suas aulas</h1>
          <p>Guarde as orientações que fazem diferença no seu estudo.</p>
        </div>
        <button className="btn" onClick={() => setForm(true)}>
          <Plus size={18} />
          Registrar aula
        </button>
      </div>
      <CaptureRecovery notify={notify} />
      {lessons.length ? (
        <div className="lesson-list">
          <h2 className="lessons-sr-only">Aulas registradas</h2>
          {lessons.map(l => (
            <button className="lesson-item" key={l.id} onClick={() => select(l.id)}>
              <div className="lesson-date" aria-hidden="true">
                <strong>{new Date(`${l.date}T12:00:00`).getDate()}</strong>
                <span>{new Date(`${l.date}T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' })}</span>
              </div>
              <span className="lessons-sr-only">{formatDate(l.date)}: </span>
              <div className="grow">
                <span className="lesson-item-title">{l.title}</span>
                <p>
                  {l.teacher || 'Meu caderno de aulas'} · {l.assetId ? 'Com gravação' : 'Notas e orientações'}
                </p>
              </div>
              <Headphones size={24} aria-hidden="true" />
              <span className="lesson-open" aria-hidden="true">
                Abrir aula →
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          title="Cada aula, uma nova descoberta"
          text="Registre uma aula para guardar o áudio, suas anotações e as orientações do professor."
          action={
            <button className="btn" onClick={() => setForm(true)}>
              <Plus size={18} />
              Registrar primeira aula
            </button>
          }
        />
      )}
      {form && <LessonForm onClose={() => setForm(false)} onSaved={id => select(id)} />}
    </>
  );
}

function NoteTime({
  value,
  onChange,
  canStamp,
  stamp,
  idleHint,
  max = Infinity,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  canStamp: boolean;
  stamp: () => number | null;
  idleHint: string;
  /** The audio duration, when known. */
  max?: number;
}) {
  return (
    <div className="note-time" role="group" aria-label="Tempo da anotação">
      {value !== null ? (
        <>
          <span className="note-time-value" aria-live="polite">
            Marcar em <strong>{clock(value)}</strong>
          </span>
          <button
            type="button"
            className="btn small secondary"
            aria-label="Marcar 5 segundos antes"
            onClick={() => onChange(Math.max(0, value - 5))}
          >
            −5 s
          </button>
          <button
            type="button"
            className="btn small secondary"
            aria-label="Marcar 5 segundos depois"
            onClick={() => onChange(Math.min(max, value + 5))}
          >
            +5 s
          </button>
          {canStamp && (
            <button type="button" className="btn small secondary" onClick={() => onChange(stamp())}>
              Agora
            </button>
          )}
          <button type="button" className="btn small secondary" onClick={() => onChange(null)}>
            Remover tempo
          </button>
        </>
      ) : (
        <>
          <span className="note-time-value">{idleHint}</span>
          {canStamp && (
            <button type="button" className="btn small secondary" onClick={() => onChange(stamp())}>
              Marcar agora
            </button>
          )}
        </>
      )}
    </div>
  );
}

function LessonNote({
  note,
  hasAudio,
  canStamp,
  stamp,
  duration,
  onPlay,
  notify,
}: {
  note: Note;
  hasAudio: boolean;
  canStamp: boolean;
  stamp: () => number | null;
  duration: number;
  onPlay: (seconds: number) => void;
  notify: Notify;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ text: string; at: number | null } | null>(null);
  const question = note.text.startsWith(QUESTION_PREFIX);
  const text = question ? note.text.slice(QUESTION_PREFIX.length) : note.text;
  const label = useId();
  if (editing)
    return (
      <article className="lesson-note">
        <form
          className="note-edit"
          onSubmit={async e => {
            e.preventDefault();
            if (!editing.text.trim()) return;
            try {
              await db.notes.update(note.id, {
                text: (question ? QUESTION_PREFIX : '') + editing.text.trim(),
                timestamp: editing.at ?? undefined,
              });
              setEditing(null);
            } catch (err) {
              notify(errorText(err), 'error');
            }
          }}
        >
          <label className="lessons-sr-only" htmlFor={label}>
            Editar anotação
          </label>
          <textarea
            id={label}
            autoFocus
            value={editing.text}
            maxLength={5000}
            onChange={e => setEditing({ ...editing, text: e.target.value })}
          />
          {(hasAudio || note.timestamp !== undefined) && (
            <NoteTime
              value={editing.at}
              onChange={at => setEditing({ ...editing, at })}
              canStamp={canStamp}
              stamp={stamp}
              max={duration}
              idleHint="Sem tempo marcado."
            />
          )}
          <div className="row wrap">
            <button className="btn small" disabled={!editing.text.trim()}>
              <Check size={15} />
              Salvar
            </button>
            <button type="button" className="btn small secondary" onClick={() => setEditing(null)}>
              Cancelar
            </button>
          </div>
        </form>
      </article>
    );
  return (
    <article className="lesson-note">
      <div className="row between">
        <div className="row wrap">
          {note.timestamp !== undefined && (
            <button
              type="button"
              className="timestamp"
              disabled={!hasAudio}
              aria-label={`Ouvir a partir de ${clock(note.timestamp)}`}
              onClick={() => onPlay(note.timestamp!)}
            >
              {clock(note.timestamp)}
            </button>
          )}
          {question ? (
            <Badge>Para a próxima aula</Badge>
          ) : note.source === 'ai' ? (
            <Badge>Assistente</Badge>
          ) : note.source === 'teacher' ? (
            <Badge>Professor(a)</Badge>
          ) : note.timestamp === undefined ? (
            <Badge>Nota</Badge>
          ) : null}
        </div>
        <div className="lesson-note-actions">
          <button
            type="button"
            className="icon-btn subtle"
            aria-label="Editar anotação"
            onClick={() => setEditing({ text, at: note.timestamp ?? null })}
          >
            <Pencil size={14} />
          </button>
          <button
            type="button"
            className="icon-btn subtle danger"
            aria-label="Excluir anotação"
            onClick={async () => {
              if (
                await confirm({
                  title: 'Excluir esta anotação?',
                  message: text.length > 140 ? `${text.slice(0, 140)}…` : text,
                  confirmLabel: 'Excluir',
                  danger: true,
                })
              )
                try {
                  await db.notes.delete(note.id);
                } catch (err) {
                  notify(errorText(err), 'error');
                }
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <p>{text}</p>
    </article>
  );
}

function LessonTasks({ lesson, notify }: { lesson: Lesson; notify: Notify }) {
  const tasks = useLiveQuery(() => db.tasks.where('lessonId').equals(lesson.id).toArray(), [lesson.id]);
  return tasks ? <LessonTaskList lesson={lesson} tasks={tasks} notify={notify} /> : null;
}
function LessonTaskList({ lesson, tasks, notify }: { lesson: Lesson; tasks: Task[]; notify: Notify }) {
  const confirm = useConfirm();
  const [title, setTitle] = useState('');
  // Done tasks go last, but by their state when the tab opened: a row that re-sorted on every tap
  // would slide another task under the student's finger.
  const [doneAtOpen] = useState(() => new Set(tasks.filter(t => t.done).map(t => t.id)));
  const sorted = [...tasks].sort(
    (a, b) =>
      Number(doneAtOpen.has(a.id)) - Number(doneAtOpen.has(b.id)) || a.createdAt.localeCompare(b.createdAt),
  );
  return (
    <div className="lesson-tasks">
      <h2 className="lessons-sr-only">Tarefas desta aula</h2>
      <form
        className="lesson-task-form"
        onSubmit={async e => {
          e.preventDefault();
          if (!title.trim()) return;
          try {
            await db.tasks.add({
              id: uid(),
              pieceId: lesson.pieceId,
              lessonId: lesson.id,
              title: title.trim(),
              done: false,
              dueDate: '',
              createdAt: now(),
            });
            setTitle('');
          } catch (err) {
            notify(errorText(err), 'error');
          }
        }}
      >
        <input
          aria-label="Nova tarefa desta aula"
          value={title}
          maxLength={300}
          onChange={e => setTitle(e.target.value)}
          placeholder="O que praticar a partir desta aula?"
        />
        <button className="btn small" disabled={!title.trim()}>
          <Plus size={16} />
          Adicionar
        </button>
      </form>
      {sorted.length ? (
        sorted.map(t => (
          <div className="task-row" key={t.id}>
            <button
              type="button"
              className={`check-button ${t.done ? 'checked' : ''}`}
              role="checkbox"
              aria-checked={t.done}
              aria-label={t.title}
              onClick={async () => {
                try {
                  await db.tasks.update(t.id, { done: !t.done });
                } catch (err) {
                  notify(errorText(err), 'error');
                }
              }}
            >
              {t.done && <Check size={14} />}
            </button>
            <span className={t.done ? 'done' : ''}>{t.title}</span>
            <button
              type="button"
              className="icon-btn subtle danger"
              aria-label={`Excluir a tarefa ${t.title}`}
              onClick={async () => {
                if (
                  await confirm({
                    title: 'Excluir esta tarefa?',
                    message: t.title,
                    confirmLabel: 'Excluir',
                    danger: true,
                  })
                )
                  try {
                    await db.tasks.delete(t.id);
                  } catch (err) {
                    notify(errorText(err), 'error');
                  }
              }}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))
      ) : (
        <p className="subtle-text">
          Nenhuma tarefa desta aula ainda. Escreva uma aqui ou aceite as sugestões do assistente.
        </p>
      )}
    </div>
  );
}

function readProfile(): CaptureProfile {
  try {
    return localStorage.getItem(PROFILE_KEY) === 'voice' ? 'voice' : 'music';
  } catch {
    return 'music';
  }
}

const tabs = [
  ['notes', 'Anotações'],
  ['tasks', 'Tarefas'],
  ['transcript', 'Transcrição'],
  ['ai', 'Assistente'],
] as const;
type Tab = (typeof tabs)[number][0];

function LessonDetail({ lesson, onBack, notify }: { lesson: Lesson; onBack: () => void; notify: Notify }) {
  const confirm = useConfirm();
  const asset = useLiveQuery(
    () => (lesson.assetId ? db.assets.get(lesson.assetId) : undefined),
    [lesson.assetId],
  );
  const notes = useLiveQuery(() => db.notes.where('lessonId').equals(lesson.id).toArray(), [lesson.id]) ?? [];
  const pendingTasks =
    useLiveQuery(
      () =>
        db.tasks
          .where('lessonId')
          .equals(lesson.id)
          .filter(t => !t.done)
          .count(),
      [lesson.id],
    ) ?? 0;
  const [capturing, setCapturing] = useState(false),
    [recElapsed, setRecElapsed] = useState<number | null>(null),
    [profile, setProfile] = useState<CaptureProfile>(readProfile);
  const [url, setUrl] = useState(''),
    [heard, setHeard] = useState(false),
    [duration, setDuration] = useState(Infinity),
    [speed, setSpeed] = useState(1);
  const [note, setNote] = useState(''),
    [moment, setMoment] = useState<NoteMoment | null>(null),
    [transcript, setTranscript] = useState(lesson.transcript);
  const [tab, setTab] = useState<Tab>('notes'),
    [analyzing, setAnalyzing] = useState(false),
    [error, setError] = useState(''),
    [editing, setEditing] = useState(false),
    [split, setSplit] = useState<SplitCheck | null>(null);
  const [proposal, setProposal] = useState<Proposal>(),
    [summaryDraft, setSummaryDraft] = useState<string | null>(null),
    [accepted, setAccepted] = useState<number[]>([]),
    [questionsSaved, setQuestionsSaved] = useState(false);
  const job = useTranscription(lesson.id),
    transcribing = !!job;
  const audio = useRef<HTMLAudioElement>(null),
    alive = useRef(true);
  const tabIds = useId();
  const knownDuration = Number.isFinite(duration) ? duration : undefined;
  useEffect(() => {
    if (!asset) {
      setUrl('');
      return;
    }
    const u = URL.createObjectURL(asset.blob);
    setUrl(u);
    setHeard(false);
    return () => URL.revokeObjectURL(u);
  }, [asset]);
  useEffect(() => {
    setTranscript(lesson.transcript);
  }, [lesson.transcript]);
  // A transcription keeps running after this screen is left; `alive` only decides where its result is shown.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // Tell the student before they tap whether a large file can be split on this device.
  useEffect(() => {
    if (tab !== 'transcript' || !asset || asset.size <= MAX_UPLOAD_BYTES) return;
    let current = true;
    setSplit(null);
    void checkSplit(asset.blob, knownDuration).then(result => {
      if (current) setSplit(result);
    });
    return () => {
      current = false;
    };
  }, [tab, asset, knownDuration]);
  const onBusyChange = useCallback((busy: boolean) => {
    setCapturing(busy);
    if (!busy) setRecElapsed(null);
  }, []);
  const saveRecording = useCallback(
    async (file: File) => {
      await setLessonAudio(lesson.id, file);
      notify('Gravação salva nesta aula.');
    },
    [lesson.id, notify],
  );
  const recordingLive = capturing && recElapsed !== null;
  const canStamp = recordingLive || (!!url && heard);
  const stamp = () =>
    stampTime({
      recordingElapsed: capturing ? recElapsed : null,
      hasAudio: !!url && !!audio.current,
      heard,
      currentTime: audio.current?.currentTime ?? 0,
    });
  const playFrom = (seconds: number) => {
    const player = audio.current;
    if (!player) return;
    player.currentTime = seconds;
    setHeard(true);
    void player.play().catch(() => {});
  };
  const skip = (delta: number) => {
    const player = audio.current;
    if (!player) return;
    const end = Number.isFinite(player.duration) ? player.duration : Infinity;
    player.currentTime = Math.min(end, Math.max(0, player.currentTime + delta));
  };
  const startDraft = () => {
    const at = stamp();
    setMoment(current => draftMoment(current, at));
  };
  const confirmReplace = async (action: 'record' | 'import') =>
    !lesson.assetId ||
    confirm({
      title: 'Substituir o áudio desta aula?',
      message: `A aula já tem um áudio${asset ? ` (${asset.name}, ${formatSize(asset.size)})` : ''}. ${
        action === 'record'
          ? 'Quando a nova gravação terminar, ele será apagado e substituído.'
          : 'Ele será apagado e substituído pelo arquivo escolhido.'
      } Suas anotações continuam, mas os tempos marcados nelas vão apontar para o novo áudio.`,
      confirmLabel: action === 'record' ? 'Gravar e substituir' : 'Substituir áudio',
      danger: true,
    });
  const pendingSuggestions = proposal ? proposal.tasks.length - accepted.length : 0;
  const unsaved = [
    summaryDraft !== null && summaryDraft.trim() !== lesson.summary.trim()
      ? proposal
        ? 'o resumo sugerido'
        : 'o resumo editado'
      : '',
    proposal?.questions.length && !questionsSaved ? 'as perguntas para a próxima aula' : '',
    pendingSuggestions === 1
      ? 'uma tarefa sugerida'
      : pendingSuggestions > 1
        ? `${pendingSuggestions} tarefas sugeridas`
        : '',
  ].filter(Boolean);
  const back = async () => {
    if (
      capturing &&
      !(await confirm({
        title: 'Gravação em andamento',
        message:
          'Encerrar a gravação e voltar para a lista? O áudio gravado até agora será salvo nesta aula.',
        confirmLabel: 'Encerrar e voltar',
        cancelLabel: 'Continuar gravando',
      }))
    )
      return;
    if (
      unsaved.length &&
      !(await confirm({
        title: 'Sair sem guardar as sugestões?',
        message: `Você ainda não guardou ${listText(unsaved)}. As sugestões do assistente não ficam salvas quando você sai da aula.`,
        confirmLabel: 'Sair sem guardar',
        cancelLabel: 'Continuar aqui',
        danger: true,
      }))
    )
      return;
    onBack();
  };
  const remove = async () => {
    const items = [
      `a aula “${lesson.title}”`,
      asset ? `o áudio (${formatSize(asset.size)})` : '',
      notes.length === 1 ? 'uma anotação' : notes.length ? `${notes.length} anotações` : '',
    ].filter(Boolean);
    // "a aula" and "anotações" are feminine; with "o áudio" in the list the participle is masculine.
    const what =
      items.length === 1
        ? `A aula “${lesson.title}” será apagada deste dispositivo.`
        : `${capitalize(listText(items))} serão ${asset ? 'apagados' : 'apagadas'} deste dispositivo.`;
    if (
      !(await confirm({
        title: 'Excluir esta aula?',
        message: `${what} Não é possível desfazer. As tarefas criadas a partir dela continuam no seu plano.`,
        confirmLabel: 'Excluir aula',
        danger: true,
      }))
    )
      return;
    try {
      await db.transaction('rw', [db.lessons, db.assets, db.notes, db.tasks], async () => {
        await db.lessons.delete(lesson.id);
        if (lesson.assetId) await db.assets.delete(lesson.assetId);
        await db.notes.where('lessonId').equals(lesson.id).delete();
        await db.tasks.where('lessonId').equals(lesson.id).modify({ lessonId: undefined });
      });
      notify('Aula excluída.');
      onBack();
    } catch (err) {
      notify(errorText(err), 'error');
    }
  };
  const saveNote = async () => {
    if (!note.trim()) return;
    try {
      await db.notes.add({
        id: uid(),
        lessonId: lesson.id,
        pieceId: lesson.pieceId || undefined,
        text: note.trim(),
        source: 'mine',
        timestamp: moment?.at ?? undefined,
        createdAt: now(),
      });
      setNote('');
      setMoment(null);
    } catch (err) {
      notify(errorText(err), 'error');
    }
  };
  const transcribe = async () => {
    if (!asset || transcribing) return;
    if (
      (transcript.trim() || lesson.transcript.trim()) &&
      !(await confirm({
        title: 'Substituir a transcrição?',
        message: 'A transcrição atual, com as suas correções, será trocada pelo novo texto da IA.',
        confirmLabel: 'Transcrever de novo',
        danger: true,
      }))
    )
      return;
    setError('');
    // Once the student has left the lesson, results arrive as toasts that name it.
    const where = () => (alive.current ? '' : ` da aula “${lesson.title}”`);
    try {
      await runTranscription(lesson.id, asset, knownDuration);
      notify(`Transcrição${where()} salva. Revise os trechos ambíguos.`);
      if (alive.current) setTab('transcript');
    } catch (err) {
      const cause = err instanceof PartialTranscript ? err.cause : err;
      const cancelled = cause instanceof AiError && cause.cancelled;
      if (err instanceof PartialTranscript) {
        const kept =
          err.done === 1 ? 'A primeira parte foi salva' : `As ${err.done} primeiras partes foram salvas`;
        notify(
          `${cancelled ? 'Transcrição cancelada' : 'A transcrição parou'}${where()} na parte ${err.done + 1} de ${err.total}. ${kept}.`,
          'info',
        );
      } else if (cancelled) notify(`Transcrição${where()} cancelada.`, 'info');
      if (!cancelled) {
        if (alive.current) setError(errorText(cause));
        else notify(`A transcrição${where()} não foi concluída. ${errorText(cause)}`, 'error');
      }
    }
  };
  /** Saves the questions not yet among the notes; returns how many were added, or null on failure. */
  const saveQuestions = async (questions: string[]) => {
    try {
      const existing = new Set(notes.map(n => n.text));
      const fresh = [...new Set(questions.map(q => q.trim()))].filter(
        q => q && !existing.has(QUESTION_PREFIX + q),
      );
      const start = Date.now();
      await db.notes.bulkAdd(
        fresh.map((q, i) => ({
          id: uid(),
          lessonId: lesson.id,
          pieceId: lesson.pieceId || undefined,
          text: QUESTION_PREFIX + q,
          source: 'ai' as const,
          createdAt: new Date(start + i).toISOString(),
        })),
      );
      setQuestionsSaved(true);
      return fresh.length;
    } catch (err) {
      notify(errorText(err), 'error');
      return null;
    }
  };
  const analyze = async () => {
    setError('');
    setAnalyzing(true);
    try {
      if (!transcript.trim()) throw new Error('Adicione ou cole a transcrição antes de pedir sugestões.');
      await db.lessons.update(lesson.id, { transcript });
      const data: Proposal = await aiFetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript, title: lesson.title }),
      });
      setProposal(data);
      setSummaryDraft(data.summary);
      setAccepted([]);
      setQuestionsSaved(false);
      setTab('ai');
      // The questions and a first summary are kept right away, so leaving the lesson cannot lose them;
      // tasks stay suggestions until the student adds them.
      const saved: string[] = [];
      if (!lesson.summary.trim() && data.summary.trim()) {
        await db.lessons.update(lesson.id, { summary: data.summary.trim() });
        saved.push('Resumo salvo nesta aula.');
      }
      const added = data.questions.length ? await saveQuestions(data.questions) : 0;
      if (added)
        saved.push(
          added === 1
            ? 'A pergunta para a próxima aula foi guardada nas anotações.'
            : `${added} perguntas para a próxima aula foram guardadas nas anotações.`,
        );
      if (saved.length) notify(saved.join(' '));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setAnalyzing(false);
    }
  };
  const moveTab = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys = tabs.map(([k]) => k);
    const at = keys.indexOf(tab);
    const next =
      e.key === 'ArrowRight'
        ? (at + 1) % keys.length
        : e.key === 'ArrowLeft'
          ? (at - 1 + keys.length) % keys.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? keys.length - 1
              : -1;
    if (next < 0) return;
    e.preventDefault();
    setTab(keys[next]);
    e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  const sortedNotes = [...notes].sort((a, b) =>
    a.timestamp !== undefined && b.timestamp !== undefined
      ? a.timestamp - b.timestamp
      : a.timestamp !== undefined
        ? -1
        : b.timestamp !== undefined
          ? 1
          : a.createdAt.localeCompare(b.createdAt),
  );
  const savedSummary = lesson.summary;
  return (
    <>
      <button className="back-link lesson-back" onClick={() => void back()}>
        <ArrowLeft size={17} />
        Todas as aulas
      </button>
      <div className="page-heading compact">
        <div>
          <span className="eyebrow">
            {formatDate(lesson.date)} · {lesson.teacher || 'CADERNO DE AULAS'}
          </span>
          <h1>{lesson.title}</h1>
          <p>Ouça de novo. Anote o que importa.</p>
        </div>
        <div className="lesson-heading-actions">
          <button className="btn secondary" onClick={() => setEditing(true)}>
            <Pencil size={16} />
            Editar aula
          </button>
        </div>
      </div>
      <div className="lesson-workspace">
        <section className="panel audio-panel" aria-label="Áudio da aula">
          <div className="audio-art">
            <Headphones size={58} strokeWidth={1} aria-hidden="true" />
            <h2>A aula continua aqui.</h2>
            <p>{asset?.name ?? 'Adicione uma gravação para ouvir e marcar momentos.'}</p>
          </div>
          {url && (
            <>
              <audio
                ref={audio}
                src={url}
                controls
                preload="metadata"
                onPlay={() => setHeard(true)}
                onSeeked={e => {
                  if (e.currentTarget.currentTime > 0) setHeard(true);
                }}
                onLoadedMetadata={e => {
                  e.currentTarget.playbackRate = speed;
                }}
                onDurationChange={e => {
                  const d = e.currentTarget.duration;
                  setDuration(Number.isFinite(d) ? d : Infinity);
                }}
              />
              <div className="player-controls">
                <button
                  type="button"
                  className="btn secondary skip-btn"
                  aria-label="Voltar 5 segundos"
                  onClick={() => skip(-5)}
                >
                  <RotateCcw size={18} />5 s
                </button>
                <button
                  type="button"
                  className="btn secondary skip-btn"
                  aria-label="Avançar 5 segundos"
                  onClick={() => skip(5)}
                >
                  <RotateCw size={18} />5 s
                </button>
                <label className="speed-field">
                  Velocidade
                  <select
                    value={speed}
                    onChange={e => {
                      const v = Number(e.target.value);
                      setSpeed(v);
                      if (audio.current) audio.current.playbackRate = v;
                    }}
                  >
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map(v => (
                      <option key={v} value={v}>
                        {String(v).replace('.', ',')}×
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="icon-btn download-audio"
                  aria-label="Baixar o áudio da aula"
                  title="Baixar o áudio da aula"
                  onClick={() => asset && download(asset.blob, asset.name)}
                >
                  <Download size={18} />
                </button>
              </div>
            </>
          )}
          <div className="row wrap">
            {!capturing && (
              <label className="btn secondary file-button">
                <FileAudio size={17} />
                Importar áudio
                <input
                  type="file"
                  accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.aac"
                  onChange={async e => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    if (!isAudioFile(file)) return notify('Escolha um arquivo de áudio.', 'error');
                    if (!(await confirmReplace('import'))) return;
                    try {
                      await setLessonAudio(lesson.id, file);
                      notify('Áudio salvo neste dispositivo.');
                    } catch (err) {
                      notify(errorText(err), 'error');
                    }
                  }}
                />
              </label>
            )}
            <Recorder
              onFile={saveRecording}
              onBusyChange={onBusyChange}
              onElapsed={setRecElapsed}
              beforeStart={() => confirmReplace('record')}
              origin={{ kind: 'lesson', lessonId: lesson.id }}
              profile={profile}
              bitsPerSecond={LESSON_BITS_PER_SECOND}
              onProfileChange={p => {
                setProfile(p);
                try {
                  localStorage.setItem(PROFILE_KEY, p);
                } catch {
                  /* Only a convenience. */
                }
              }}
              activityLabel={`Gravação da aula · ${lesson.title}`}
              notify={notify}
            />
          </div>
          <p className="hint">
            {capturing
              ? 'Suas anotações recebem o tempo da gravação em andamento.'
              : 'Áudio e notas ficam neste dispositivo. Exporte um backup para guardar uma cópia.'}
          </p>
          {!capturing && <CaptureRecovery notify={notify} lessonId={lesson.id} level={3} />}
        </section>
        <section className="panel lesson-notes" aria-label="Conteúdo da aula">
          <div className="tabs" role="tablist" aria-label="Conteúdo da aula" onKeyDown={moveTab}>
            {tabs.map(([k, v]) => (
              <button
                key={k}
                type="button"
                role="tab"
                id={`${tabIds}-${k}`}
                aria-selected={tab === k}
                aria-controls={`${tabIds}-panel`}
                tabIndex={tab === k ? 0 : -1}
                className={tab === k ? 'active' : ''}
                onClick={() => setTab(k)}
              >
                {v}
                {k === 'tasks' && pendingTasks > 0 ? ` (${pendingTasks})` : ''}
              </button>
            ))}
          </div>
          <div id={`${tabIds}-panel`} role="tabpanel" aria-labelledby={`${tabIds}-${tab}`}>
            <ErrorBox message={error} />
            {tab === 'notes' && (
              <>
                <h2 className="lessons-sr-only">Anotações</h2>
                <form
                  className="note-form"
                  onSubmit={e => {
                    e.preventDefault();
                    void saveNote();
                  }}
                >
                  <Field label="Nova anotação">
                    <textarea
                      value={note}
                      maxLength={5000}
                      rows={4}
                      placeholder="Uma orientação, um detalhe, uma dúvida…"
                      onFocus={() => {
                        if (!note.trim()) startDraft();
                      }}
                      onChange={e => {
                        const next = e.target.value;
                        if (!note.trim() && next.trim()) startDraft();
                        if (!next.trim() && moment && !moment.manual) setMoment(null);
                        setNote(next);
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                          e.preventDefault();
                          void saveNote();
                        }
                      }}
                    />
                  </Field>
                  {(url || capturing) && (
                    <NoteTime
                      value={moment?.at ?? null}
                      onChange={at => setMoment({ at, manual: true })}
                      canStamp={canStamp}
                      stamp={stamp}
                      max={recordingLive ? Infinity : duration}
                      idleHint={noteTimeHint({
                        canStamp,
                        hasText: !!note.trim(),
                        removed: !!moment?.manual,
                      })}
                    />
                  )}
                  <div className="note-form-actions">
                    <button className="btn small" disabled={!note.trim()}>
                      <BookmarkPlus size={16} />
                      Salvar anotação
                    </button>
                  </div>
                </form>
                {sortedNotes.map(n => (
                  <LessonNote
                    key={n.id}
                    note={n}
                    hasAudio={!!url && !capturing}
                    canStamp={canStamp}
                    stamp={stamp}
                    duration={duration}
                    onPlay={playFrom}
                    notify={notify}
                  />
                ))}
              </>
            )}
            {tab === 'tasks' && <LessonTasks lesson={lesson} notify={notify} />}
            {tab === 'transcript' && (
              <>
                <h2>Revisite o que foi dito</h2>
                <p className="hint">
                  Cole uma transcrição ou use o serviço de IA configurado. Corrija palavras e nomes quando
                  necessário.
                </p>
                {/* Read-only while the AI works: its result replaces the text when it arrives. */}
                <textarea
                  className="transcript-editor"
                  aria-label="Transcrição da aula"
                  value={transcript}
                  readOnly={transcribing}
                  onChange={e => setTranscript(e.target.value)}
                  onBlur={() => {
                    if (!transcribing && transcript !== lesson.transcript)
                      void db.lessons
                        .update(lesson.id, { transcript })
                        .catch(err => notify(errorText(err), 'error'));
                  }}
                  maxLength={100000}
                  placeholder="[0:00] Comece pela mão esquerda…"
                />
                {job && (
                  <div className="transcribe-progress" role="status">
                    <span>
                      {job.progress || 'Transcrevendo…'} Você pode sair desta aula: a transcrição continua e é
                      salva aqui. Mantenha o app aberto.
                    </span>
                    <button
                      type="button"
                      className="btn small secondary"
                      onClick={() => cancelTranscription(lesson.id)}
                    >
                      Cancelar
                    </button>
                  </div>
                )}
                <div className="row wrap">
                  <button
                    className="btn"
                    disabled={transcribing}
                    onClick={async () => {
                      try {
                        await db.lessons.update(lesson.id, { transcript });
                        notify('Transcrição salva.');
                      } catch (err) {
                        notify(errorText(err), 'error');
                      }
                    }}
                  >
                    Salvar texto
                  </button>
                  <button
                    className="btn secondary"
                    disabled={transcribing || analyzing || !asset || split?.ok === false}
                    onClick={() => void transcribe()}
                  >
                    <Sparkles size={16} />
                    {transcribing ? 'Transcrevendo…' : 'Transcrever áudio com IA'}
                  </button>
                </div>
                {asset && asset.size > MAX_UPLOAD_BYTES && !transcribing && (
                  <p className={split?.ok === false ? 'recorder-warning' : 'hint'}>
                    {!split
                      ? `Este áudio tem ${formatSize(asset.size)}. Verificando se ele pode ser enviado em partes…`
                      : split.ok
                        ? `Este áudio tem ${formatSize(asset.size)}, acima do limite de um envio. Ele será enviado em ${split.parts} partes de cerca de 10 minutos, uma de cada vez.`
                        : split.message}
                  </p>
                )}
              </>
            )}
            {tab === 'ai' && (
              <>
                <div className="ai-intro">
                  <Sparkles size={26} aria-hidden="true" />
                  <h2>Da conversa para o estudo</h2>
                  <p>
                    Receba um resumo e sugestões de tarefas a partir da transcrição. Revise cada proposta
                    antes de adicioná-la ao seu plano.
                  </p>
                </div>
                <button
                  className="btn"
                  disabled={analyzing || transcribing || !transcript.trim()}
                  onClick={() => void analyze()}
                >
                  <Sparkles size={17} />
                  {analyzing ? 'Preparando sugestões…' : 'Analisar transcrição'}
                </button>
                <p className="hint">
                  Requer serviço de IA configurado e conexão. Nenhum resultado é gerado sem esse serviço.
                </p>
                {summaryDraft !== null ? (
                  <article className="note-card">
                    <h3>{proposal ? 'Resumo para revisão' : 'Editar resumo'}</h3>
                    <textarea
                      className="summary-editor"
                      aria-label="Resumo da aula"
                      value={summaryDraft}
                      maxLength={20000}
                      onChange={e => setSummaryDraft(e.target.value)}
                    />
                    <div className="row wrap">
                      <button
                        className="btn small"
                        disabled={summaryDraft.trim() === savedSummary.trim()}
                        onClick={async () => {
                          try {
                            await db.lessons.update(lesson.id, { summary: summaryDraft.trim() });
                            notify('Resumo salvo.');
                          } catch (err) {
                            notify(errorText(err), 'error');
                          }
                        }}
                      >
                        <Check size={15} />
                        {summaryDraft.trim() === savedSummary.trim() && savedSummary
                          ? 'Resumo salvo'
                          : 'Salvar resumo'}
                      </button>
                      {!proposal && (
                        <button className="btn small secondary" onClick={() => setSummaryDraft(null)}>
                          Fechar
                        </button>
                      )}
                    </div>
                  </article>
                ) : (
                  savedSummary && (
                    <article className="note-card">
                      <div className="row between">
                        <h3>Resumo</h3>
                        <button className="link-btn" onClick={() => setSummaryDraft(savedSummary)}>
                          <Pencil size={14} />
                          Editar
                        </button>
                      </div>
                      <p>{savedSummary}</p>
                    </article>
                  )
                )}
                {proposal?.tasks.map((t, i) => (
                  <article className="proposal-card" key={i}>
                    <Badge>Sugestão da IA</Badge>
                    <h3>{t.title}</h3>
                    <blockquote>{t.evidence}</blockquote>
                    <div className="row wrap">
                      {t.timestamp !== null && url && (
                        <button
                          type="button"
                          className="timestamp"
                          aria-label={`Ouvir a aula a partir de ${clock(t.timestamp)}`}
                          onClick={() => playFrom(t.timestamp!)}
                        >
                          Ouvir em {clock(t.timestamp)}
                        </button>
                      )}
                      <button
                        className="btn small secondary"
                        disabled={accepted.includes(i)}
                        onClick={async () => {
                          try {
                            await db.tasks.add({
                              id: uid(),
                              pieceId: lesson.pieceId,
                              lessonId: lesson.id,
                              title: t.title,
                              done: false,
                              dueDate: '',
                              createdAt: now(),
                            });
                            setAccepted(a => [...a, i]);
                            notify('Tarefa adicionada. Ela aparece em Tarefas, nesta aula.');
                          } catch (err) {
                            notify(errorText(err), 'error');
                          }
                        }}
                      >
                        <Check size={15} />
                        {accepted.includes(i) ? 'Adicionada' : 'Adicionar tarefa'}
                      </button>
                    </div>
                  </article>
                ))}
                {proposal?.questions.length ? (
                  <article className="note-card proposal-questions">
                    <h3>Para a próxima aula</h3>
                    <ul>
                      {proposal.questions.map((q, i) => (
                        <li key={i}>{q}</li>
                      ))}
                    </ul>
                    {questionsSaved ? (
                      <p className="hint">
                        <Check size={14} aria-hidden="true" />{' '}
                        {proposal.questions.length === 1
                          ? 'Guardada nas anotações desta aula.'
                          : 'Guardadas nas anotações desta aula.'}
                      </p>
                    ) : (
                      <button
                        className="btn small secondary"
                        onClick={async () => {
                          const added = await saveQuestions(proposal.questions);
                          if (added !== null)
                            notify(
                              proposal.questions.length === 1
                                ? 'Pergunta guardada nas anotações desta aula.'
                                : 'Perguntas guardadas nas anotações desta aula.',
                            );
                        }}
                      >
                        <BookmarkPlus size={15} />
                        {proposal.questions.length === 1
                          ? 'Guardar pergunta nas anotações'
                          : 'Guardar perguntas nas anotações'}
                      </button>
                    )}
                  </article>
                ) : null}
              </>
            )}
          </div>
        </section>
      </div>
      {editing && (
        <LessonForm
          lesson={lesson}
          onClose={() => setEditing(false)}
          onSaved={() => notify('Aula atualizada.')}
          onDelete={capturing || transcribing ? undefined : () => void remove()}
        />
      )}
    </>
  );
}
