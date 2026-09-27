import { useEffect, useId, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Check,
  ClipboardPaste,
  ExternalLink,
  FileText,
  ImagePlus,
  Pencil,
  Play,
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { db, storeAsset } from '../db';
import {
  formatDate,
  isWarmup,
  localDay,
  now,
  uid,
  type Asset,
  type Lesson,
  type Piece,
  type Segment,
  type Task,
} from '../domain';
import { DOCUMENT_ACCEPT, isImageAsset, isImageFile, isPdfFile, usePasteFiles } from '../files';
import {
  activityLabel,
  activityTarget,
  defaultDue,
  sortActivities,
  type ActivityTarget,
} from '../lessons/activities';
import { sortExercises } from '../warmups/collections';
import { plural } from '../segment-stats';
import { Field, Modal, errorText, useConfirm, type Notify } from './common';

/** Adds photos, screenshots or PDFs to a lesson's teacher notes. */
export async function addAttachments(lesson: Pick<Lesson, 'id'>, files: File[]) {
  const bad = files.find(f => !isImageFile(f) && !isPdfFile(f));
  if (bad) throw new Error(`“${bad.name}” não é uma imagem nem um PDF.`);
  await db.transaction('rw', [db.assets, db.lessons], async () => {
    const ids: string[] = [];
    for (const file of files) ids.push((await storeAsset(file)).id);
    const current = await db.lessons.get(lesson.id);
    await db.lessons.update(lesson.id, { attachments: [...(current?.attachments ?? []), ...ids] });
  });
}

/** An object URL for a stored file, revoked when it changes or the component leaves. */
function useObjectUrl(blob?: Blob) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) return setUrl('');
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/**
 * "Anotações do professor": the photos, screenshots or PDFs the teacher sent after the lesson. Files can be
 * chosen (on iPad: camera or photo library), pasted with Ctrl+V or dropped on the panel.
 */
export function TeacherNotes({ lesson, notify }: { lesson: Lesson; notify: Notify }) {
  const confirm = useConfirm();
  const ids = lesson.attachments ?? [];
  const assets =
    useLiveQuery(
      async () => (await db.assets.bulkGet(ids)).filter((a): a is Asset => !!a),
      [ids.join(',')],
    ) ?? [];
  const [viewing, setViewing] = useState<Asset | null>(null),
    [busy, setBusy] = useState(false),
    [over, setOver] = useState(false);
  const add = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      await addAttachments(lesson, files);
      notify(files.length === 1 ? 'Anotação do professor guardada.' : `${files.length} arquivos guardados.`);
    } catch (err) {
      notify(`Não foi possível guardar. ${errorText(err)}`, 'error');
    } finally {
      setBusy(false);
    }
  };
  usePasteFiles(files => void add(files), { scope: 'page' });
  const remove = async (asset: Asset) => {
    const ok = await confirm({
      title: 'Remover esta anotação?',
      message: `“${asset.name}” será apagado deste dispositivo. As atividades continuam.`,
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      await db.transaction('rw', [db.assets, db.lessons], async () => {
        const current = await db.lessons.get(lesson.id);
        await db.lessons.update(lesson.id, {
          attachments: (current?.attachments ?? []).filter(a => a !== asset.id),
        });
        await db.assets.delete(asset.id);
      });
      setViewing(null);
    } catch (err) {
      notify(errorText(err), 'error');
    }
  };
  return (
    <section
      className={`panel teacher-notes ${over ? 'drop-over' : ''}`}
      aria-labelledby="teacher-notes-title"
      onDragOver={e => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault();
        setOver(false);
        void add([...e.dataTransfer.files]);
      }}
    >
      <div className="section-heading">
        <h2 id="teacher-notes-title">Anotações do professor</h2>
        <span className="hint">{assets.length ? plural(assets.length, 'arquivo', 'arquivos') : ''}</span>
      </div>
      {assets.length > 0 && (
        <ul className="attachment-grid">
          {assets.map(asset => (
            <li key={asset.id}>
              <AttachmentThumb asset={asset} onOpen={() => setViewing(asset)} />
            </li>
          ))}
        </ul>
      )}
      <div className="teacher-notes-add">
        <label className={`btn ${assets.length ? 'secondary' : ''} file-button`}>
          <ImagePlus size={17} />
          {busy ? 'Guardando…' : assets.length ? 'Adicionar mais' : 'Adicionar foto, print ou PDF'}
          <input
            type="file"
            accept={DOCUMENT_ACCEPT}
            multiple
            disabled={busy}
            onChange={e => {
              const files = [...(e.target.files ?? [])];
              e.target.value = '';
              void add(files);
            }}
          />
        </label>
        <p className="hint">
          <ClipboardPaste size={14} aria-hidden="true" /> Copiou um print? Cole aqui com Ctrl+V (⌘V no Mac).
        </p>
      </div>
      {viewing && (
        <AttachmentViewer
          asset={viewing}
          onClose={() => setViewing(null)}
          onRemove={() => void remove(viewing)}
        />
      )}
    </section>
  );
}

function AttachmentThumb({ asset, onOpen }: { asset: Asset; onOpen: () => void }) {
  const image = isImageAsset(asset);
  const url = useObjectUrl(image ? asset.blob : undefined);
  return (
    <button type="button" className="attachment-thumb" onClick={onOpen} aria-label={`Abrir ${asset.name}`}>
      {image && url ? <img src={url} alt="" /> : <FileText size={34} aria-hidden="true" />}
      <span>{asset.name}</span>
    </button>
  );
}

function AttachmentViewer({
  asset,
  onClose,
  onRemove,
}: {
  asset: Asset;
  onClose: () => void;
  onRemove: () => void;
}) {
  const image = isImageAsset(asset);
  const url = useObjectUrl(asset.blob);
  const [zoom, setZoom] = useState(false);
  return (
    <Modal title={asset.name} onClose={onClose} wide>
      {image ? (
        <div className={`attachment-view ${zoom ? 'zoomed' : ''}`}>
          {url && <img src={url} alt={`Anotação do professor: ${asset.name}`} />}
        </div>
      ) : (
        <p>Este PDF abre no leitor do navegador.</p>
      )}
      <footer className="modal-actions">
        <button type="button" className="btn secondary study-discard" onClick={onRemove}>
          <Trash2 size={16} />
          Remover
        </button>
        {image ? (
          <button type="button" className="btn secondary" onClick={() => setZoom(z => !z)}>
            {zoom ? <ZoomOut size={16} /> : <ZoomIn size={16} />}
            {zoom ? 'Ajustar à tela' : 'Ampliar'}
          </button>
        ) : (
          <a className="btn secondary" href={url} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            Abrir PDF
          </a>
        )}
      </footer>
    </Modal>
  );
}

interface ActivityDraft {
  title: string;
  detail: string;
  pieceId: string;
  segmentId: string;
  dueDate: string;
}

/** Title, instructions, what it is for (piece, collection, trecho or exercise) and the due date. */
function ActivityFields({
  draft,
  onChange,
  pieces,
  segments,
  autoFocus,
}: {
  draft: ActivityDraft;
  onChange: (draft: ActivityDraft) => void;
  pieces: Piece[];
  segments: Segment[];
  autoFocus?: boolean;
}) {
  const set = (patch: Partial<ActivityDraft>) => onChange({ ...draft, ...patch });
  const repertoire = pieces.filter(p => !isWarmup(p)).sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  const warmups = pieces.filter(isWarmup).sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
  const chosen = pieces.find(p => p.id === draft.pieceId);
  const parts = useMemo(() => {
    const own = segments.filter(s => s.pieceId === draft.pieceId);
    return chosen?.warmup ? sortExercises(own) : own.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }, [segments, draft.pieceId, chosen?.warmup]);
  return (
    <>
      <Field label="Atividade">
        <input
          data-autofocus={autoFocus ? '' : undefined}
          value={draft.title}
          maxLength={200}
          required
          placeholder="Ex.: Escala de Fá, Czerny nº 7, Schumann"
          onChange={e => set({ title: e.target.value })}
        />
      </Field>
      <Field label="Como praticar (opcional)">
        <textarea
          rows={3}
          value={draft.detail}
          maxLength={3000}
          placeholder="Ex.: MS e MJ, M=50, 1 oitava em semínimas e colcheias; movimento direto e contrário"
          onChange={e => set({ detail: e.target.value })}
        />
      </Field>
      <div className="form-grid three activity-links">
        <Field label="Para">
          <select value={draft.pieceId} onChange={e => set({ pieceId: e.target.value, segmentId: '' })}>
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
        {parts.length > 0 && (
          <Field label={chosen?.warmup ? 'Exercício' : 'Trecho'}>
            <select value={draft.segmentId} onChange={e => set({ segmentId: e.target.value })}>
              <option value="">{chosen?.warmup ? 'A coleção toda' : 'A peça toda'}</option>
              {parts.map(s => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label="Até">
          <input type="date" value={draft.dueDate} onChange={e => set({ dueDate: e.target.value })} />
        </Field>
      </div>
    </>
  );
}

const toTask = (d: ActivityDraft) => ({
  title: d.title.trim(),
  detail: d.detail.trim() || undefined,
  pieceId: d.pieceId,
  segmentId: d.segmentId || undefined,
  dueDate: d.dueDate,
});

/** "Atividades da semana": what the teacher asked for, each linked to what it trains. */
export function WeekActivities({
  lesson,
  notify,
  onPractice,
}: {
  lesson: Lesson;
  notify: Notify;
  onPractice?: (target: ActivityTarget) => void;
}) {
  const confirm = useConfirm();
  const tasks = useLiveQuery(() => db.tasks.where('lessonId').equals(lesson.id).toArray(), [lesson.id]);
  const pieces = useLiveQuery(() => db.pieces.toArray()) ?? [];
  const segments = useLiveQuery(() => db.segments.toArray()) ?? [];
  const blank = (): ActivityDraft => ({
    title: '',
    detail: '',
    pieceId: lesson.pieceId,
    segmentId: '',
    dueDate: defaultDue(lesson.date),
  });
  const [draft, setDraft] = useState<ActivityDraft>(blank),
    [editing, setEditing] = useState<{ id: string; draft: ActivityDraft } | null>(null);
  const formId = useId();
  // Done ones go last by their state when the list opened: a row that moved on every tap would slide another
  // activity under the student's finger.
  const [doneAtOpen, setDoneAtOpen] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (tasks && !doneAtOpen) setDoneAtOpen(new Set(tasks.filter(t => t.done).map(t => t.id)));
  }, [tasks, doneAtOpen]);
  if (!tasks) return null;
  const sorted = sortActivities(tasks.map(t => ({ ...t, done: doneAtOpen?.has(t.id) ?? t.done }))).map(t =>
    tasks.find(x => x.id === t.id)!,
  );
  const pending = tasks.filter(t => !t.done).length;
  const save = async () => {
    if (!draft.title.trim()) return;
    try {
      await db.tasks.add({ id: uid(), lessonId: lesson.id, done: false, createdAt: now(), ...toTask(draft) });
      // The next activity is often for the same piece: keep it and the date.
      setDraft(d => ({ ...blank(), pieceId: d.pieceId, dueDate: d.dueDate }));
    } catch (err) {
      notify(errorText(err), 'error');
    }
  };
  const today = localDay();
  return (
    <section className="panel week-activities" aria-labelledby={`${formId}-title`}>
      <div className="section-heading">
        <h2 id={`${formId}-title`}>Atividades da semana</h2>
        <span className="hint">{tasks.length ? `${pending} de ${tasks.length} por fazer` : ''}</span>
      </div>
      {sorted.length > 0 ? (
        <ul className="activity-list">
          {sorted.map(t => (
            <ActivityRow
              key={t.id}
              task={t}
              label={activityLabel(t, pieces, segments)}
              target={activityTarget(t, pieces)}
              overdue={!t.done && !!t.dueDate && t.dueDate < today}
              onPractice={onPractice}
              onToggle={async () => {
                try {
                  await db.tasks.update(t.id, { done: !t.done });
                } catch (err) {
                  notify(errorText(err), 'error');
                }
              }}
              onEdit={() =>
                setEditing({
                  id: t.id,
                  draft: {
                    title: t.title,
                    detail: t.detail ?? '',
                    pieceId: t.pieceId,
                    segmentId: t.segmentId ?? '',
                    dueDate: t.dueDate,
                  },
                })
              }
              onDelete={async () => {
                const ok = await confirm({
                  title: 'Excluir esta atividade?',
                  message: t.title,
                  confirmLabel: 'Excluir',
                  danger: true,
                });
                if (!ok) return;
                try {
                  await db.tasks.delete(t.id);
                } catch (err) {
                  notify(errorText(err), 'error');
                }
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="subtle-text">
          Escreva aqui o que o professor pediu para esta semana, olhando as anotações ao lado.
        </p>
      )}
      <form
        className="activity-form"
        aria-label="Nova atividade"
        onSubmit={e => {
          e.preventDefault();
          void save();
        }}
      >
        <h3>Nova atividade</h3>
        <ActivityFields draft={draft} onChange={setDraft} pieces={pieces} segments={segments} />
        <button className="btn" disabled={!draft.title.trim()}>
          <Plus size={17} />
          Adicionar atividade
        </button>
      </form>
      {editing && (
        <Modal title="Editar atividade" onClose={() => setEditing(null)} guard>
          <form
            onSubmit={async e => {
              e.preventDefault();
              if (!editing.draft.title.trim()) return;
              try {
                const next = toTask(editing.draft);
                await db.tasks.update(editing.id, {
                  ...next,
                  detail: next.detail ?? '',
                  segmentId: next.segmentId,
                });
                setEditing(null);
              } catch (err) {
                notify(errorText(err), 'error');
              }
            }}
          >
            <ActivityFields
              draft={editing.draft}
              onChange={d => setEditing({ ...editing, draft: d })}
              pieces={pieces}
              segments={segments}
              autoFocus
            />
            <footer className="modal-actions">
              <button type="button" className="btn secondary" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button className="btn" disabled={!editing.draft.title.trim()}>
                Salvar
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}

export function ActivityRow({
  task,
  label,
  target,
  overdue,
  onToggle,
  onPractice,
  onEdit,
  onDelete,
  compact = false,
}: {
  task: Task;
  label: string;
  target: ActivityTarget | null;
  overdue: boolean;
  onToggle: () => void;
  onPractice?: (target: ActivityTarget) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Hoje: detail on one line, no edit or delete. */
  compact?: boolean;
}) {
  return (
    <li className={`activity-row ${task.done ? 'done' : ''} ${compact ? 'compact' : ''}`}>
      <button
        type="button"
        className={`check-button ${task.done ? 'checked' : ''}`}
        role="checkbox"
        aria-checked={task.done}
        aria-label={task.title}
        onClick={onToggle}
      >
        {task.done && <Check size={14} />}
      </button>
      <div className="activity-body">
        <strong>{task.title}</strong>
        {task.detail && <p className="activity-detail">{task.detail}</p>}
        {(label || task.dueDate) && (
          <p className="activity-meta">
            {label}
            {label && task.dueDate ? ' · ' : ''}
            {task.dueDate && (
              <span className={overdue ? 'overdue' : ''}>
                {overdue ? 'atrasada, era até ' : 'até '}
                {formatDate(task.dueDate)}
              </span>
            )}
          </p>
        )}
      </div>
      <div className="activity-actions">
        {target && onPractice && !task.done && (
          <button
            type="button"
            className="btn small"
            onClick={() => onPractice(target)}
            aria-label={`Praticar ${task.title}`}
          >
            <Play size={14} fill="currentColor" />
            Praticar
          </button>
        )}
        {onEdit && (
          <button
            type="button"
            className="icon-btn subtle"
            aria-label={`Editar ${task.title}`}
            onClick={onEdit}
          >
            <Pencil size={15} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="icon-btn subtle"
            aria-label={`Excluir ${task.title}`}
            onClick={onDelete}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </li>
  );
}
