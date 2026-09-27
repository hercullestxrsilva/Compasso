import { useId, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ListMusic, Plus, Play, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { db } from '../db';
import { hands, uid, type Hand, type Routine, type RoutineItem, type Segment } from '../domain';
import { groupByPiece, parseNumber, plural, settleNumber } from '../practice/setup';
import { resolveStep, routineMinutes, stepDetail } from '../practice/routine';
import { Modal, Field, Empty, errorText, useConfirm, type Notify } from './common';
import { useNumberDraft } from './practice/NumberField';
import '../styles/practice.css';

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * Minutes, hand and BPM of one routine step. Typed values are kept as drafts; what is wrong is written under
 * the row (not in a tooltip, which the iPad cannot show) and settled on blur.
 */
function StepFields({
  item,
  segment,
  n,
  onChange,
}: {
  item: RoutineItem;
  segment?: Segment;
  n: number;
  onChange: (patch: Partial<RoutineItem>) => void;
}) {
  const errorId = useId();
  // Fractional minutes (7,5) are valid in saved routines and backups.
  const minutes = useNumberDraft(item.minutes, 1, 60, false, value => onChange({ minutes: value }));
  const bpmString = (bpm?: number) => (bpm === undefined ? '' : String(bpm));
  const [bpmText, setBpmText] = useState(bpmString(item.bpm)),
    [bpmShown, setBpmShown] = useState(item.bpm);
  const parseBpm = (text: string): { value?: number; error?: string } =>
    text.trim() ? parseNumber(text, 20, 300) : {};
  if (item.bpm !== bpmShown) {
    setBpmShown(item.bpm);
    if (parseBpm(bpmText).value !== item.bpm) setBpmText(bpmString(item.bpm));
  }
  const bpmError = parseBpm(bpmText).error;
  const minutesMessage = minutes.error && `Minutos: ${lowerFirst(minutes.error)}`;
  const bpmMessage =
    bpmError &&
    `BPM: de 20 a 300, ou vazio ${item.segmentId ? 'para usar o do trecho' : 'para só cronômetro'}.`;
  return (
    <>
      <div className="routine-edit-fields">
        <span>
          <span aria-hidden="true">Minutos</span>
          <input
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            className="routine-number"
            aria-label={`Minutos do passo ${n}`}
            aria-invalid={minutesMessage ? true : undefined}
            aria-describedby={minutesMessage ? errorId : undefined}
            value={minutes.text}
            onChange={e => minutes.change(e.target.value)}
            onBlur={minutes.settle}
          />
        </span>
        <span>
          <span aria-hidden="true">Mão</span>
          <select
            aria-label={`Mão do passo ${n}`}
            value={item.hand ?? ''}
            onChange={e => onChange({ hand: (e.target.value || undefined) as Hand | undefined })}
          >
            <option value="">
              {segment ? `Do trecho (${hands[segment.hand]})` : item.segmentId ? '—' : 'Ambas'}
            </option>
            {Object.entries(hands).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </select>
        </span>
        <span>
          <span aria-hidden="true">BPM</span>
          <input
            type="text"
            inputMode="numeric"
            enterKeyHint="done"
            autoComplete="off"
            className="routine-number"
            aria-label={`BPM do passo ${n}`}
            aria-invalid={bpmMessage ? true : undefined}
            aria-describedby={bpmMessage ? errorId : undefined}
            placeholder={segment ? String(segment.bpm) : item.segmentId ? '' : 'sem'}
            value={bpmText}
            onChange={e => {
              setBpmText(e.target.value);
              const parsed = parseBpm(e.target.value);
              if (!parsed.error && parsed.value !== item.bpm) onChange({ bpm: parsed.value });
            }}
            onBlur={() => {
              if (!bpmError) return;
              // Out of range: the nearest valid tempo. Not a number: back to what was saved.
              const settled = settleNumber(bpmText, 20, 300, true, NaN);
              if (Number.isNaN(settled)) return setBpmText(bpmString(item.bpm));
              setBpmText(String(settled));
              if (settled !== item.bpm) onChange({ bpm: settled });
            }}
          />
        </span>
      </div>
      {(minutesMessage || bpmMessage) && (
        <p id={errorId} className="field-error step-error">
          {[minutesMessage, bpmMessage].filter(Boolean).join(' ')}
        </p>
      )}
    </>
  );
}

export default function Routines({
  disabled,
  onStart,
  notify,
}: {
  disabled: boolean;
  onStart: (routine: Routine, from: number) => void;
  notify: Notify;
}) {
  const confirm = useConfirm();
  const segments = useLiveQuery(() => db.segments.toArray()) ?? [],
    pieces = useLiveQuery(() => db.pieces.toArray()) ?? [],
    routines = useLiveQuery(() => db.routines.toArray()) ?? [];
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Routine | null>(null),
    [selected, setSelected] = useState(''),
    [label, setLabel] = useState('');
  const groups = groupByPiece(pieces, segments).filter(g => g.segments.length);
  const title = (item: RoutineItem) =>
    item.segmentId
      ? (segments.find(s => s.id === item.segmentId)?.title ?? 'Trecho removido')
      : item.label || 'Atividade livre';
  const pieceTitle = (item: RoutineItem) => {
    const segment = segments.find(s => s.id === item.segmentId);
    return segment && pieces.find(p => p.id === segment.pieceId)?.title;
  };
  const setItem = (index: number, patch: Partial<RoutineItem>) =>
    setEditing(e => e && { ...e, items: e.items.map((x, i) => (i === index ? { ...x, ...patch } : x)) });
  const move = (from: number, to: number) =>
    setEditing(e => {
      if (!e) return e;
      const items = [...e.items];
      [items[from], items[to]] = [items[to], items[from]];
      return { ...e, items };
    });
  const saved = editing && routines.find(r => r.id === editing.id);
  const changed =
    editing && JSON.stringify(editing) !== JSON.stringify(saved ?? { ...editing, title: '', items: [] });
  const stopEditing = async () => {
    if (
      changed &&
      !(await confirm({
        title: 'Descartar as alterações?',
        message: 'A rotina volta a ser como estava da última vez que você salvou.',
        confirmLabel: 'Descartar',
        danger: true,
      }))
    )
      return false;
    setEditing(null);
    return true;
  };
  return (
    <>
      <button className="btn secondary" disabled={disabled} onClick={() => setOpen(true)}>
        <ListMusic size={17} />
        Rotinas de estudo
      </button>
      {open && (
        <Modal
          title={editing ? (saved ? 'Editar rotina' : 'Nova rotina') : 'Rotinas de estudo'}
          wide
          guard={editing !== null}
          onClose={async () => {
            if (!editing || (await stopEditing())) setOpen(false);
          }}
        >
          {editing ? (
            <>
              <Field label="Nome da rotina">
                <input
                  required
                  value={editing.title}
                  maxLength={160}
                  onChange={e => setEditing({ ...editing, title: e.target.value })}
                  placeholder="Ex.: Estudo de 20 minutos"
                />
              </Field>
              <div className="routine-add">
                <div className="row">
                  <select
                    className="grow"
                    aria-label="Trecho para adicionar à rotina"
                    value={selected}
                    onChange={e => setSelected(e.target.value)}
                  >
                    <option value="">
                      {groups.length ? 'Escolha um trecho…' : 'Nenhum trecho marcado ainda'}
                    </option>
                    {groups.map(g => (
                      <optgroup key={g.piece?.id ?? 'outros'} label={g.piece?.title ?? 'Outros trechos'}>
                        {g.segments.map(s => (
                          <option key={s.id} value={s.id}>
                            {s.title}
                            {s.measures ? ` · c. ${s.measures}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    className="btn small secondary"
                    disabled={!selected}
                    onClick={() => {
                      setEditing({
                        ...editing,
                        items: [...editing.items, { segmentId: selected, minutes: 3 }],
                      });
                      setSelected('');
                    }}
                  >
                    <Plus size={16} />
                    Trecho
                  </button>
                </div>
                <form
                  className="row"
                  onSubmit={e => {
                    e.preventDefault();
                    if (!label.trim()) return;
                    setEditing({
                      ...editing,
                      items: [...editing.items, { label: label.trim(), minutes: 5 }],
                    });
                    setLabel('');
                  }}
                >
                  <input
                    className="grow"
                    aria-label="Atividade livre para adicionar à rotina"
                    placeholder="Ou uma atividade livre: escalas, leitura…"
                    value={label}
                    maxLength={120}
                    onChange={e => setLabel(e.target.value)}
                  />
                  <button className="btn small secondary" disabled={!label.trim()}>
                    <Plus size={16} />
                    Atividade
                  </button>
                </form>
              </div>
              {editing.items.length > 0 && (
                <p className="hint">
                  BPM vazio usa o do trecho. Em atividades livres, sem BPM o passo é só cronômetro.
                </p>
              )}
              <ol className="routine-edit-list">
                {editing.items.map((item, index) => {
                  const segment = segments.find(s => s.id === item.segmentId);
                  const n = index + 1;
                  return (
                    <li className="routine-edit-step" key={index}>
                      <div className="routine-edit-head">
                        <span className="grow">
                          <strong>
                            {n}. {title(item)}
                          </strong>
                          {pieceTitle(item) && <small>{pieceTitle(item)}</small>}
                        </span>
                        <button
                          className="icon-btn"
                          aria-label={`Subir passo ${n}`}
                          disabled={index === 0}
                          onClick={() => move(index, index - 1)}
                        >
                          <ArrowUp size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`Descer passo ${n}`}
                          disabled={index === editing.items.length - 1}
                          onClick={() => move(index, index + 1)}
                        >
                          <ArrowDown size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          aria-label={`Remover passo ${n}`}
                          onClick={() =>
                            setEditing({ ...editing, items: editing.items.filter((_, i) => i !== index) })
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <StepFields
                        key={`${index}-${item.segmentId ?? item.label}`}
                        item={item}
                        segment={segment}
                        n={n}
                        onChange={patch => setItem(index, patch)}
                      />
                    </li>
                  );
                })}
              </ol>
              <footer className="modal-actions">
                <button className="btn secondary" onClick={() => void stopEditing()}>
                  Cancelar
                </button>
                <button
                  className="btn"
                  disabled={!editing.title.trim() || !editing.items.length}
                  onClick={async () => {
                    try {
                      await db.routines.put({ ...editing, title: editing.title.trim() });
                      setEditing(null);
                      notify('Rotina salva.');
                    } catch (e) {
                      notify(`Não foi possível salvar a rotina: ${errorText(e)}`, 'error');
                    }
                  }}
                >
                  Salvar rotina
                </button>
              </footer>
            </>
          ) : (
            <>
              <p className="hint">
                Monte a sequência do dia com trechos e atividades livres, como escalas. Ao começar, cada passo
                dura o tempo marcado e o próximo começa sozinho depois de uma pequena pausa.
              </p>
              <button
                className="btn small routines-new"
                onClick={() => setEditing({ id: uid(), title: '', items: [] })}
              >
                <Plus size={16} />
                Nova rotina
              </button>
              {!routines.length && (
                <Empty
                  title="Nenhuma rotina ainda"
                  text="Uma rotina organiza o estudo: aquecimento, trechos e revisão, na ordem que você quiser."
                />
              )}
              {routines.map(r => (
                <article className="routine-card" key={r.id}>
                  <div className="routine-card-head">
                    <div className="grow">
                      <h3>{r.title}</h3>
                      <small>
                        {plural(r.items.length, 'passo', 'passos')} · {routineMinutes(r.items)} min de prática
                      </small>
                    </div>
                    <button
                      className="btn small"
                      disabled={
                        !r.items.some(item =>
                          resolveStep(
                            item,
                            segments.find(s => s.id === item.segmentId),
                          ),
                        )
                      }
                      onClick={() => {
                        setOpen(false);
                        onStart(r, 0);
                      }}
                    >
                      <Play size={15} fill="currentColor" />
                      Começar rotina
                    </button>
                    <button className="link-btn" onClick={() => setEditing(r)}>
                      Editar
                    </button>
                  </div>
                  <ol className="routine-steps">
                    {r.items.map((item, i) => {
                      const plan = resolveStep(
                        item,
                        segments.find(s => s.id === item.segmentId),
                      );
                      return (
                        <li className="routine-step" key={i}>
                          <span className="grow">
                            <strong>{title(item)}</strong>
                            <small>
                              {[pieceTitle(item), stepDetail(item, plan)].filter(Boolean).join(' · ')}
                            </small>
                          </span>
                          {i > 0 && plan && (
                            <button
                              className="btn small secondary"
                              onClick={() => {
                                setOpen(false);
                                onStart(r, i);
                              }}
                            >
                              Começar daqui
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                  <button
                    className="link-btn danger-link"
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: 'Excluir rotina?',
                          message: `“${r.title}” será excluída. Os trechos e o histórico continuam salvos.`,
                          confirmLabel: 'Excluir',
                          danger: true,
                        }))
                      )
                        return;
                      try {
                        await db.routines.delete(r.id);
                      } catch (e) {
                        notify(`Não foi possível excluir a rotina: ${errorText(e)}`, 'error');
                      }
                    }}
                  >
                    Excluir rotina
                  </button>
                </article>
              ))}
            </>
          )}
        </Modal>
      )}
    </>
  );
}
