import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ListMusic, Plus, Play, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { db } from '../db';
import { hands, uid, type Hand, type Routine, type RoutineItem } from '../domain';
import { groupByPiece, parseNumber, plural } from '../practice/setup';
import { resolveStep, routineMinutes, stepDetail } from '../practice/routine';
import { Modal, Field, Empty, errorText, useConfirm, type Notify } from './common';
import NumberField from './practice/NumberField';
import '../styles/practice.css';

/** Optional BPM for a step: empty means "the segment's own BPM" (or no metronome for a free item). */
function OptionalBpm({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value?: number;
  placeholder: string;
  onChange: (value: number | undefined) => void;
}) {
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const error = text.trim() ? parseNumber(text, 20, 300).error : undefined;
  return (
    <input
      type="text"
      inputMode="numeric"
      className="routine-bpm"
      aria-label={label}
      aria-invalid={error ? true : undefined}
      title={error ?? 'De 20 a 300, ou vazio'}
      placeholder={placeholder}
      value={text}
      onChange={e => {
        setText(e.target.value);
        const parsed = parseNumber(e.target.value, 20, 300);
        if (!e.target.value.trim()) onChange(undefined);
        else if (parsed.value !== undefined) onChange(parsed.value);
      }}
      onBlur={() => {
        if (text.trim() && error) {
          setText(value === undefined ? '' : String(value));
        }
      }}
    />
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
                      <div className="routine-edit-fields">
                        <span>
                          <span aria-hidden="true">Minutos</span>
                          <NumberField
                            compact
                            label={`Minutos do passo ${n}`}
                            value={item.minutes}
                            min={1}
                            max={60}
                            onChange={minutes => setItem(index, { minutes })}
                          />
                        </span>
                        <span>
                          <span aria-hidden="true">Mão</span>
                          <select
                            aria-label={`Mão do passo ${n}`}
                            value={item.hand ?? ''}
                            onChange={e =>
                              setItem(index, { hand: (e.target.value || undefined) as Hand | undefined })
                            }
                          >
                            <option value="">
                              {segment
                                ? `Do trecho (${hands[segment.hand]})`
                                : item.segmentId
                                  ? '—'
                                  : 'Ambas'}
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
                          <OptionalBpm
                            key={`${index}-${item.segmentId ?? item.label}`}
                            label={`BPM do passo ${n}`}
                            value={item.bpm}
                            placeholder={segment ? String(segment.bpm) : item.segmentId ? '' : 'sem'}
                            onChange={bpm => setItem(index, { bpm })}
                          />
                        </span>
                      </div>
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
              <button className="btn small" onClick={() => setEditing({ id: uid(), title: '', items: [] })}>
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
