import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Download, Play, Plus, Clock3, Target, AudioLines, Trash2 } from 'lucide-react';
import { db, storeAsset } from '../db';
import { hands, now, uid, formatDate, clock, localDay } from '../domain';
import { Badge, Empty, Field, download, errorText } from './common';
import Recorder from './Recorder';
import { makePlayableCopy, recordingHealthMessage } from '../audio/recording';
function RecordingPlayer({ assetId }: { assetId: string }) {
  const asset = useLiveQuery(() => db.assets.get(assetId), [assetId]);
  const [url, setUrl] = useState(''),
    [playbackError, setPlaybackError] = useState('');
  useEffect(() => {
    if (!asset) return;
    const u = URL.createObjectURL(asset.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [asset]);
  return url ? (
    <>
      <audio
        controls
        src={url}
        preload="metadata"
        onLoadedMetadata={e =>
          setPlaybackError(
            Number.isFinite(e.currentTarget.duration)
              ? ''
              : 'O navegador não reconheceu a duração. Use “Criar cópia reproduzível” para corrigir a barra de progresso.',
          )
        }
        onDurationChange={e => {
          if (Number.isFinite(e.currentTarget.duration)) setPlaybackError('');
        }}
        onError={() =>
          setPlaybackError('Não foi possível reproduzir este arquivo. Tente criar uma cópia reproduzível.')
        }
      />
      {playbackError && (
        <p className="recorder-warning" role="status">
          {playbackError}
        </p>
      )}
    </>
  ) : null;
}
function RecordingDownload({ assetId }: { assetId: string }) {
  const asset = useLiveQuery(() => db.assets.get(assetId), [assetId]);
  return asset ? (
    <button className="btn small secondary" onClick={() => download(asset.blob, asset.name)}>
      <Download size={14} />
      Baixar arquivo
    </button>
  ) : null;
}
export default function Progress({
  onPractice,
  notify,
}: {
  onPractice: (id: string) => void;
  notify: (s: string) => void;
}) {
  const sessions = useLiveQuery(() => db.sessions.orderBy('startedAt').reverse().toArray()) ?? [];
  const segments = useLiveQuery(() => db.segments.toArray()) ?? [],
    recordings = useLiveQuery(() => db.recordings.toArray()) ?? [];
  const tasks = useLiveQuery(() => db.tasks.toArray()) ?? [],
    notes = useLiveQuery(() => db.notes.toArray()) ?? [];
  const [tab, setTab] = useState('history'),
    [filter, setFilter] = useState(''),
    [recordTitle, setRecordTitle] = useState(''),
    [repairingId, setRepairingId] = useState('');
  const filtered = sessions.filter(s => !filter || s.segmentId === filter),
    minutes = Math.round(filtered.reduce((s, x) => s + x.activeSeconds, 0) / 60),
    days = new Set(filtered.map(s => localDay(new Date(s.startedAt)))).size;
  const saveRecording = async (file: File) => {
    await db.transaction('rw', [db.assets, db.recordings], async () => {
      const asset = await storeAsset(file);
      await db.recordings.add({
        id: uid(),
        assetId: asset.id,
        segmentId: filter || undefined,
        title:
          recordTitle.trim() ||
          `${segments.find(s => s.id === filter)?.title ?? 'Minha prática'} · ${formatDate(now())}`,
        createdAt: now(),
      });
    });
    notify('Tentativa gravada e salva.');
    setRecordTitle('');
  };
  const repairRecording = async (recording: (typeof recordings)[number]) => {
    if (repairingId) return;
    setRepairingId(recording.id);
    try {
      const original = await db.assets.get(recording.assetId);
      if (!original) throw new Error('Arquivo original não encontrado.');
      const repaired = await makePlayableCopy(original.blob, original.name);
      const silence = recordingHealthMessage(repaired.duration, repaired.rms);
      if (silence) throw new Error(silence);
      await db.transaction('rw', [db.assets, db.recordings], async () => {
        const asset = await storeAsset(repaired.file);
        await db.recordings.add({
          id: uid(),
          assetId: asset.id,
          segmentId: recording.segmentId,
          title: `${recording.title} (cópia reproduzível)`,
          createdAt: now(),
        });
      });
      notify(`Cópia reproduzível criada (${clock(repaired.duration)}). A gravação original foi preservada.`);
    } catch (err) {
      notify(errorText(err));
    } finally {
      setRepairingId('');
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">PERCEBA O CAMINHO PERCORRIDO</span>
          <h1>Sua evolução</h1>
          <p>Escute as mudanças. Registre as pequenas conquistas.</p>
        </div>
        <button
          className="btn secondary"
          onClick={() => {
            const text = `# Meu estudo de piano — ${localDay()}\n\n## Tarefas pendentes\n${
              tasks
                .filter(t => !t.done)
                .map(t => `- ${t.title}`)
                .join('\n') || 'Nenhuma tarefa pendente.'
            }\n\n## Trechos para revisar\n${segments
              .filter(s => s.rating !== 'comfortable')
              .map(s => `- ${s.title} (${hands[s.hand]}, ${s.bpm} BPM): ${s.goal}`)
              .join('\n')}\n\n## Últimas sessões\n${sessions
              .slice(0, 15)
              .map(
                s =>
                  `- ${formatDate(s.startedAt)} · ${s.title}: ${clock(s.activeSeconds)} de prática, ${hands[s.hand]}, ${s.config.bpm} BPM. ${s.note}`,
              )
              .join('\n')}\n\n## Observações recentes\n${[...notes]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 15)
              .map(n => `- ${n.text}`)
              .join('\n')}`;
            download(
              new Blob([text], { type: 'text/markdown;charset=utf-8' }),
              `proxima-aula-${localDay()}.md`,
            );
          }}
        >
          <Download size={17} />
          Preparar próxima aula
        </button>
      </div>
      <div className="stats-grid">
        <div className="stat">
          <span>
            <Clock3 size={17} />
            Tempo de prática
          </span>
          <strong>
            {minutes}
            <small> min</small>
          </strong>
          <p>Exclui preparação e intervalos</p>
        </div>
        <div className="stat">
          <span>
            <AudioLines size={17} />
            Sessões
          </span>
          <strong>{filtered.length}</strong>
          <p>Concluídas e parciais</p>
        </div>
        <div className="stat">
          <span>
            <Target size={17} />
            Dias com prática
          </span>
          <strong>{days}</strong>
          <p>No histórico selecionado</p>
        </div>
      </div>
      <div className="toolbar">
        <div className="tabs">
          {[
            ['history', 'Histórico'],
            ['recordings', 'Minhas gravações'],
            ['review', 'Revisões'],
          ].map(([k, v]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
              {v}
            </button>
          ))}
        </div>
        <select aria-label="Filtrar por trecho" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">Todos os trechos</option>
          {segments.map(s => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </div>
      {tab === 'history' &&
        (filtered.length ? (
          <div className="progress-list">
            {filtered.map(s => (
              <article className="history-row" key={s.id}>
                <div className="history-time">
                  {clock(s.activeSeconds)}
                  <small>PRÁTICA ATIVA</small>
                </div>
                <div className="grow">
                  <h3>{s.title}</h3>
                  <p>
                    {formatDate(s.startedAt)} · {hands[s.hand]} · {s.config.bpm} BPM ·{' '}
                    {s.completedRepetitions} repetição(ões)
                  </p>
                  {s.note && <p className="session-note">{s.note}</p>}
                </div>
                <Badge
                  variant={
                    s.rating === 'comfortable' ? 'learned' : s.rating === 'difficult' ? 'planned' : 'studying'
                  }
                >
                  {s.rating
                    ? { comfortable: 'Confortável', difficult: 'Difícil', improving: 'Melhorando' }[s.rating]
                    : s.completed
                      ? 'Concluída'
                      : 'Parcial'}
                </Badge>
                {s.segmentId && segments.some(x => x.id === s.segmentId) && (
                  <button
                    className="icon-btn"
                    aria-label={`Praticar ${s.title}`}
                    onClick={() => onPractice(s.segmentId!)}
                  >
                    <Play size={18} />
                  </button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <Empty
            title="Cada sessão conta uma história"
            text="Ao encerrar uma prática, seu tempo e suas observações aparecem aqui."
          />
        ))}
      {tab === 'recordings' && (
        <div className="settings-grid">
          <section className="panel">
            <h2>Ouça sua própria evolução</h2>
            <p className="hint">
              Selecione um trecho no filtro para vincular a gravação. Você pode comparar tentativas escutando
              os registros abaixo.
            </p>
            <Field label="Nome da tentativa (opcional)">
              <input
                value={recordTitle}
                maxLength={160}
                onChange={e => setRecordTitle(e.target.value)}
                placeholder="Ex.: Antes de rever o dedilhado"
              />
            </Field>
            <Recorder key={filter} onFile={saveRecording} label="Gravar tentativa" />
            <label className="btn secondary file-button" style={{ marginTop: 12 }}>
              <Plus size={16} />
              Importar tentativa
              <input
                type="file"
                accept="audio/*"
                onChange={async e => {
                  const f = e.target.files?.[0];
                  if (f)
                    try {
                      if (!f.type.startsWith('audio/')) throw new Error('Escolha um arquivo de áudio.');
                      await saveRecording(f);
                    } catch (err) {
                      notify(errorText(err));
                    }
                  e.target.value = '';
                }}
              />
            </label>
          </section>
          <section className="panel">
            <h2>Tentativas salvas</h2>
            {recordings
              .filter(r => !filter || r.segmentId === filter)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .map(r => (
                <div className="recording-row" key={r.id}>
                  <div className="row between">
                    <strong>{r.title}</strong>
                    <button
                      className="icon-btn"
                      aria-label={`Excluir gravação ${r.title}`}
                      onClick={async () => {
                        if (!window.confirm('Excluir esta gravação?')) return;
                        try {
                          await db.transaction('rw', [db.recordings, db.assets], async () => {
                            await db.recordings.delete(r.id);
                            await db.assets.delete(r.assetId);
                          });
                        } catch (err) {
                          notify(errorText(err));
                        }
                      }}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <span className="hint">{formatDate(r.createdAt)}</span>
                  <RecordingPlayer assetId={r.assetId} />
                  <div className="row wrap" style={{ marginTop: 10 }}>
                    <button
                      className="btn small secondary"
                      disabled={!!repairingId}
                      onClick={() => void repairRecording(r)}
                    >
                      {repairingId === r.id ? 'Preparando cópia…' : 'Criar cópia reproduzível'}
                    </button>
                    <RecordingDownload assetId={r.assetId} />
                  </div>
                </div>
              ))}
            {!recordings.length && <p className="subtle-text">Suas gravações aparecerão aqui.</p>}
          </section>
        </div>
      )}
      {tab === 'review' && (
        <div className="piece-grid">
          {segments
            .filter(s => !filter || s.id === filter)
            .map(s => (
              <article className="panel" key={s.id}>
                <Badge>{s.difficulty}</Badge>
                <h3 style={{ marginTop: 15 }}>{s.title}</h3>
                <p className="hint">
                  {hands[s.hand]} · {s.bpm} BPM
                </p>
                <Field label="Próxima revisão">
                  <input
                    type="date"
                    value={s.reviewDate}
                    onChange={async e => {
                      try {
                        await db.segments.update(s.id, { reviewDate: e.target.value });
                      } catch (err) {
                        notify(errorText(err));
                      }
                    }}
                  />
                </Field>
                <button className="btn small" onClick={() => onPractice(s.id)}>
                  <Play size={15} />
                  Revisar trecho
                </button>
              </article>
            ))}
          {!segments.length && (
            <Empty
              title="Seu repertório continua vivo"
              text="Crie trechos nas partituras para definir quando quer revisitá-los."
            />
          )}
        </div>
      )}
    </>
  );
}
