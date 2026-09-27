import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { db } from '../../db';
import type { Preset, Segment } from '../../domain';
import { Modal, Empty, errorText, useConfirm, type Notify } from '../common';

/** Rename or delete saved cycle configurations. */
export default function PresetManager({
  presets,
  segments,
  notify,
  onClose,
}: {
  presets: Preset[];
  segments: Segment[];
  notify: Notify;
  onClose: () => void;
}) {
  const confirm = useConfirm();
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const sorted = [...presets].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const rename = async () => {
    if (!editing?.name.trim()) return;
    try {
      await db.presets.update(editing.id, { name: editing.name.trim() });
      setEditing(null);
    } catch (e) {
      notify(`Não foi possível renomear: ${errorText(e)}`, 'error');
    }
  };
  return (
    <Modal title="Minhas configurações" onClose={onClose} guard={editing !== null}>
      {!sorted.length && (
        <Empty title="Nenhuma configuração salva" text="Salve um ciclo para reutilizá-lo." />
      )}
      <ul className="preset-list">
        {sorted.map(p => {
          const segment = segments.find(s => s.id === p.segmentId);
          return (
            <li key={p.id}>
              {editing?.id === p.id ? (
                <form
                  className="preset-rename"
                  onSubmit={e => {
                    e.preventDefault();
                    void rename();
                  }}
                >
                  <input
                    autoFocus
                    aria-label="Novo nome"
                    value={editing.name}
                    maxLength={120}
                    onChange={e => setEditing({ ...editing, name: e.target.value })}
                  />
                  <button className="btn small" disabled={!editing.name.trim()}>
                    Salvar
                  </button>
                  <button type="button" className="btn small secondary" onClick={() => setEditing(null)}>
                    Cancelar
                  </button>
                </form>
              ) : (
                <>
                  <div className="grow">
                    <strong>{p.name}</strong>
                    <small>
                      {segment ? segment.title : p.segmentId ? 'Trecho removido' : 'Geral'} · {p.config.bpm}{' '}
                      BPM · {p.config.numerator}/{p.config.denominator}
                    </small>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Renomear ${p.name}`}
                    onClick={() => setEditing({ id: p.id, name: p.name })}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Excluir ${p.name}`}
                    onClick={async () => {
                      if (
                        !(await confirm({
                          title: 'Excluir configuração?',
                          message: `“${p.name}” deixará de aparecer na lista. Suas sessões não mudam.`,
                          confirmLabel: 'Excluir',
                          danger: true,
                        }))
                      )
                        return;
                      try {
                        await db.presets.delete(p.id);
                      } catch (e) {
                        notify(`Não foi possível excluir: ${errorText(e)}`, 'error');
                      }
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
