import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Search, ArrowUpRight, MoreHorizontal, BookOpen, FileMusic, Trash2 } from 'lucide-react';
import { db, removePiece, storeAsset } from '../db';
import { statuses, uid, now, type Piece, type PieceStatus } from '../domain';
import { Modal, Field, Empty, ErrorBox, Badge, errorText, useConfirm, type Notify } from './common';
import { forgetHistory } from '../annotation-history';
import { forgetPieceView, titleFromFileName } from '../score-view';

/** Cover tone (0–3) from the piece id: the same piece keeps its colour whatever the filter, order or screen. */
export function pieceTone(id: string) {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 4;
}

function scoreCount(count: number) {
  return count === 0 ? 'Sem partitura' : count === 1 ? '1 partitura' : `${count} partituras`;
}

export function PieceForm({
  piece,
  onClose,
  onSaved,
}: {
  piece?: Piece;
  onClose: () => void;
  /** scoreId is the score added with the form, if any. */
  onSaved: (id: string, scoreId?: string) => void;
}) {
  const [title, setTitle] = useState(piece?.title ?? ''),
    [composer, setComposer] = useState(piece?.composer ?? '');
  const [status, setStatus] = useState<PieceStatus>(piece?.status ?? 'studying'),
    [tags, setTags] = useState(piece?.tags ?? '');
  const [file, setFile] = useState<File>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <Modal guard title={piece ? 'Editar peça' : 'Adicionar ao repertório'} onClose={onClose}>
      <form
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const id = piece?.id ?? uid();
            const scoreId = file ? uid() : undefined;
            if (file && !['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(file.type))
              throw new Error('Use uma partitura em PDF, PNG, JPG ou WebP.');
            await db.transaction('rw', [db.pieces, db.assets, db.scores], async () => {
              await db.pieces.put({
                id,
                title: title.trim(),
                composer: composer.trim(),
                status,
                tags: tags.trim(),
                createdAt: piece?.createdAt ?? now(),
                updatedAt: now(),
              });
              if (file && scoreId) {
                const asset = await storeAsset(file);
                await db.scores.add({
                  id: scoreId,
                  pieceId: id,
                  assetId: asset.id,
                  title: titleFromFileName(file.name),
                  createdAt: now(),
                });
              }
            });
            onSaved(id, scoreId);
            onClose();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label="Nome da peça">
          <input
            required
            maxLength={160}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Ex.: Prelúdio em Dó maior"
            autoFocus
            data-autofocus
          />
        </Field>
        <Field label="Compositor">
          <input
            maxLength={120}
            value={composer}
            onChange={e => setComposer(e.target.value)}
            placeholder="Ex.: J. S. Bach"
          />
        </Field>
        <div className="form-grid">
          <Field label="No meu repertório">
            <select value={status} onChange={e => setStatus(e.target.value as PieceStatus)}>
              {Object.entries(statuses).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Etiquetas">
            <input
              value={tags}
              maxLength={200}
              onChange={e => setTags(e.target.value)}
              placeholder="Barroco, leitura, técnica"
            />
          </Field>
        </div>
        <Field
          label={piece ? 'Adicionar outra partitura (opcional)' : 'Partitura (opcional)'}
          hint="PDF ou imagem, até 100 MB. O original é preservado."
        >
          <input
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={e => {
              setFile(e.target.files?.[0]);
              if (!title && e.target.files?.[0]) setTitle(titleFromFileName(e.target.files[0].name));
            }}
          />
        </Field>
        <ErrorBox message={error} />
        <footer className="modal-actions">
          <button type="button" className="btn secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" disabled={busy || !title.trim()}>
            {busy ? 'Salvando…' : piece ? 'Salvar alterações' : 'Adicionar peça'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function Library({ onOpen, notify }: { onOpen: (id: string) => void; notify: Notify }) {
  const confirm = useConfirm();
  const pieces = useLiveQuery(() => db.pieces.orderBy('updatedAt').reverse().toArray()) ?? [];
  const scores = useLiveQuery(() => db.scores.toArray()) ?? [];
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [form, setForm] = useState<Piece | 'new' | null>(null);
  const remove = async (piece: Piece) => {
    const ok = await confirm({
      title: 'Excluir peça?',
      message: `Excluir “${piece.title}”, suas partituras, marcações e tarefas? O histórico de prática e as aulas serão preservados. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir peça',
      danger: true,
    });
    if (!ok) return;
    try {
      const scoreIds = scores.filter(s => s.pieceId === piece.id).map(s => s.id);
      await removePiece(piece.id);
      scoreIds.forEach(forgetHistory);
      forgetPieceView(piece.id, scoreIds);
      notify('Peça excluída.');
    } catch (e) {
      notify(`Não foi possível excluir a peça. ${errorText(e)}`, 'error');
    }
  };
  const filtered = pieces.filter(
    p =>
      (filter === 'all' || p.status === filter) &&
      `${p.title} ${p.composer} ${p.tags}`
        .toLocaleLowerCase('pt-BR')
        .includes(search.toLocaleLowerCase('pt-BR')),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SUAS PEÇAS, NO SEU TEMPO</span>
          <h1>Repertório</h1>
          <p>Da primeira leitura à próxima interpretação.</p>
        </div>
        <button className="btn" onClick={() => setForm('new')}>
          <Plus size={18} />
          Adicionar peça
        </button>
      </div>
      <div className="toolbar">
        <div className="tabs" aria-label="Estado das peças">
          {[['all', 'Todas'], ...Object.entries(statuses)].map(([key, label]) => (
            <button className={filter === key ? 'active' : ''} key={key} onClick={() => setFilter(key)}>
              {label}
              <span>{pieces.filter(p => key === 'all' || p.status === key).length}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={18} />
          <input
            aria-label="Buscar repertório"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Peça, compositor ou etiqueta"
          />
        </label>
      </div>
      {filtered.length ? (
        <div className="piece-grid">
          {filtered.map(piece => (
            <article className="piece-card" key={piece.id}>
              <button
                className={`piece-cover tone-${pieceTone(piece.id)}`}
                onClick={() => onOpen(piece.id)}
                aria-label={`Abrir ${piece.title}`}
              >
                <span className="cover-label">PARTITURA</span>
                <BookOpen size={36} strokeWidth={1} />
                <ArrowUpRight size={22} className="cover-arrow" />
              </button>
              <div className="piece-info">
                <Badge variant={piece.status}>{statuses[piece.status]}</Badge>
                <button className="text-title" onClick={() => onOpen(piece.id)}>
                  {piece.title}
                </button>
                <p>{piece.composer || 'Compositor não informado'}</p>
                <div className="piece-footer">
                  <span>
                    <FileMusic size={15} />
                    {scoreCount(scores.filter(s => s.pieceId === piece.id).length)}
                  </span>
                  <div>
                    <button
                      className="icon-btn"
                      aria-label={`Editar ${piece.title}`}
                      onClick={() => setForm(piece)}
                    >
                      <MoreHorizontal size={20} />
                    </button>
                    <button
                      className="icon-btn subtle"
                      aria-label={`Excluir ${piece.title}`}
                      onClick={() => void remove(piece)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <Empty
          title={pieces.length ? 'Nenhuma peça encontrada' : 'Sua biblioteca começa aqui'}
          text={
            pieces.length
              ? 'Tente outra busca ou filtro.'
              : 'Adicione uma peça e sua partitura para começar a organizar o estudo.'
          }
          action={
            !pieces.length && (
              <button className="btn" onClick={() => setForm('new')}>
                <Plus size={18} />
                Adicionar primeira peça
              </button>
            )
          }
        />
      )}
      {form && (
        <PieceForm
          piece={form === 'new' ? undefined : form}
          onClose={() => setForm(null)}
          onSaved={id => {
            notify('Peça salva neste dispositivo.');
            // A new piece opens right away so its score and trechos can be set up.
            if (form === 'new') onOpen(id);
          }}
        />
      )}
    </>
  );
}
