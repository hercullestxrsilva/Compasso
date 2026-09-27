import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ListMusic, Plus, Play, ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import { db } from '../db';
import { uid, type Routine } from '../domain';
import { Modal, Field, Empty, errorText } from './common';
export default function Routines({
  disabled,
  onStart,
  notify,
}: {
  disabled: boolean;
  onStart: (segmentId: string, minutes: number) => void;
  notify: (s: string) => void;
}) {
  const segments = useLiveQuery(() => db.segments.toArray()) ?? [],
    routines = useLiveQuery(() => db.routines.toArray()) ?? [];
  const [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Routine | null>(null),
    [selected, setSelected] = useState('');
  return (
    <>
      <button className="btn secondary" disabled={disabled} onClick={() => setOpen(true)}>
        <ListMusic size={17} />
        Rotinas de estudo
      </button>
      {open && (
        <Modal
          title="Rotinas de estudo"
          wide
          onClose={() => {
            setOpen(false);
            setEditing(null);
          }}
        >
          <p className="hint">
            Organize os trechos na ordem que preferir, inclusive alternando A–B–A. Cada passo abre uma prática
            com a duração definida. Você inicia o próximo passo quando estiver pronto.
          </p>
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
              <div className="row">
                <select
                  aria-label="Adicionar trecho à rotina"
                  value={selected}
                  onChange={e => setSelected(e.target.value)}
                >
                  <option value="">Escolha um trecho…</option>
                  {segments.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
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
                  Adicionar
                </button>
              </div>
              {editing.items.map((item, index) => (
                <div className="routine-step" key={index}>
                  <span className="grow">
                    {index + 1}. {segments.find(s => s.id === item.segmentId)?.title ?? 'Trecho removido'}
                  </span>
                  <input
                    type="number"
                    aria-label={`Minutos do passo ${index + 1}`}
                    min={1}
                    max={60}
                    value={item.minutes}
                    style={{ width: 70 }}
                    onChange={e =>
                      setEditing({
                        ...editing,
                        items: editing.items.map((x, i) =>
                          i === index
                            ? { ...x, minutes: Math.max(1, Math.min(60, Number(e.target.value))) }
                            : x,
                        ),
                      })
                    }
                  />
                  <span>min</span>
                  <button
                    className="icon-btn"
                    aria-label={`Subir passo ${index + 1}`}
                    disabled={index === 0}
                    onClick={() => {
                      const items = [...editing.items];
                      [items[index - 1], items[index]] = [items[index], items[index - 1]];
                      setEditing({ ...editing, items });
                    }}
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Descer passo ${index + 1}`}
                    disabled={index === editing.items.length - 1}
                    onClick={() => {
                      const items = [...editing.items];
                      [items[index + 1], items[index]] = [items[index], items[index + 1]];
                      setEditing({ ...editing, items });
                    }}
                  >
                    <ArrowDown size={15} />
                  </button>
                  <button
                    className="icon-btn"
                    aria-label={`Remover passo ${index + 1}`}
                    onClick={() =>
                      setEditing({ ...editing, items: editing.items.filter((_, i) => i !== index) })
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
              <footer className="modal-actions">
                <button className="btn secondary" onClick={() => setEditing(null)}>
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
                      notify(errorText(e));
                    }
                  }}
                >
                  Salvar rotina
                </button>
              </footer>
            </>
          ) : (
            <>
              <button
                className="btn small"
                disabled={!segments.length}
                onClick={() => setEditing({ id: uid(), title: '', items: [] })}
              >
                <Plus size={16} />
                Nova rotina
              </button>
              {!segments.length && (
                <Empty
                  title="Comece pelos trechos"
                  text="Marque os trechos nas partituras para montar sua rotina."
                />
              )}
              {routines.map(r => (
                <article className="routine-card" key={r.id}>
                  <div className="row between">
                    <h3>
                      {r.title} · {r.items.reduce((s, x) => s + x.minutes, 0)} min de prática
                    </h3>
                    <button className="link-btn" onClick={() => setEditing(r)}>
                      Editar
                    </button>
                  </div>
                  {r.items.map((item, i) => {
                    const s = segments.find(s => s.id === item.segmentId);
                    return (
                      <div className="routine-step" key={i}>
                        <span>
                          {i + 1}. {s?.title ?? 'Trecho removido'} · {item.minutes} min
                        </span>
                        <button
                          className="btn small secondary"
                          disabled={!s}
                          onClick={() => {
                            setOpen(false);
                            onStart(item.segmentId, item.minutes);
                          }}
                        >
                          <Play size={14} />
                          Preparar
                        </button>
                      </div>
                    );
                  })}
                  <button
                    className="link-btn"
                    onClick={async () => {
                      if (window.confirm(`Excluir a rotina “${r.title}”? Os trechos serão preservados.`))
                        try {
                          await db.routines.delete(r.id);
                        } catch (e) {
                          notify(errorText(e));
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
