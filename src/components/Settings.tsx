import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  AlertTriangle,
  Check,
  Clock,
  Cloud,
  Database,
  Download,
  HardDrive,
  LogIn,
  LogOut,
  ShieldCheck,
  Sparkles,
  Upload,
} from 'lucide-react';
import {
  BACKUP_EVENT,
  BACKUP_STALE_DAYS,
  CLOUD_BACKUP_LIMIT,
  backupAgeDays,
  backupFileName,
  describeBackupAge,
  exportRoom,
  formatBytes,
  lastBackupAt,
  makeBackupZip,
  markBackup,
  mediaBytes,
  openBackup,
  type BackupProgress,
  type BackupSummary,
} from '../backup';
import { db } from '../db';
import { cloud } from '../services';
import { Field, download, errorText, useConfirm, type Notify } from './common';
import '../styles/settings.css';
interface CloudRow {
  id: string;
  created_at: string;
  path: string;
  bytes: number;
}
interface LibraryCounts {
  pieces: number;
  lessons: number;
  recordings: number;
  sessions: number;
  assets: number;
  captures: number;
}
interface Progress {
  where: 'local' | 'cloud';
  label: string;
  done?: number;
  total?: number;
}
const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
const joinPt = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
const describeLibrary = (c: Pick<LibraryCounts, 'pieces' | 'lessons' | 'recordings' | 'sessions'>) =>
  joinPt([
    count(c.pieces, 'peça', 'peças'),
    count(c.lessons, 'aula', 'aulas'),
    count(c.recordings, 'gravação', 'gravações'),
    count(c.sessions, 'sessão', 'sessões'),
  ]);
const formatWhen = (iso: string) => {
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return iso.length === 10
    ? date.toLocaleDateString('pt-BR', { dateStyle: 'long' })
    : date.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
};
const hasData = (c?: LibraryCounts) => !!c && c.pieces + c.lessons + c.recordings + c.sessions + c.assets > 0;

export default function Settings({ notify }: { notify: Notify }) {
  const confirm = useConfirm();
  const [offlineReady, setOfflineReady] = useState(false);
  useEffect(() => {
    let active = true;
    if (import.meta.env.PROD && 'serviceWorker' in navigator)
      void navigator.serviceWorker.ready.then(() => {
        if (active) setOfflineReady(true);
      });
    return () => {
      active = false;
    };
  }, []);
  const [quota, setQuota] = useState<StorageEstimate>(),
    [persistent, setPersistent] = useState(false),
    [busy, setBusy] = useState<'' | 'export' | 'restore' | 'cloud' | 'login'>(''),
    [progress, setProgress] = useState<Progress>(),
    [last, setLast] = useState(lastBackupAt);
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [user, setUser] = useState(''),
    [backups, setBackups] = useState<CloudRow[]>([]),
    [ai, setAi] = useState('Verificando serviço…');
  const exportFirst = useRef<Promise<unknown> | undefined>(undefined);
  const library = useLiveQuery(async () => {
    const [pieces, lessons, recordings, sessions, assets, captures] = await Promise.all([
      db.pieces.count(),
      db.lessons.count(),
      db.recordings.count(),
      db.sessions.count(),
      db.assets.count(),
      db.captures.count(),
    ]);
    return { pieces, lessons, recordings, sessions, assets, captures };
  });
  const since = useLiveQuery(
    async () =>
      last
        ? {
            sessions: await db.sessions.where('startedAt').above(last).count(),
            files: await db.assets.filter(a => a.createdAt > last).count(),
          }
        : undefined,
    [last],
  );
  useEffect(() => {
    const sync = () => setLast(lastBackupAt());
    window.addEventListener(BACKUP_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(BACKUP_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  useEffect(() => {
    if (!busy || busy === 'login') return;
    // Leaving mid-restore is safe (the transaction rolls back) but loses the work in progress.
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  const refreshCloud = async () => {
    if (!cloud) return;
    const { data: session } = await cloud!.auth.getSession();
    setUser(session.session?.user.email ?? '');
    if (session.session) {
      const { data, error } = await cloud!
        .from('compasso_backups')
        .select('id,created_at,path,bytes')
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      setBackups(data ?? []);
    } else setBackups([]);
  };
  useEffect(() => {
    void navigator.storage?.estimate().then(setQuota);
    void navigator.storage?.persisted().then(setPersistent);
    void refreshCloud().catch(() => {});
    let alive = true;
    fetch('/api/status')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (alive)
          setAi(
            data?.configured
              ? 'Serviço disponível. Aulas são enviadas somente ao solicitar a análise.'
              : 'Serviço não configurado. Notas e transcrições manuais continuam disponíveis.',
          );
      })
      .catch(() => {
        if (alive) setAi('Serviço não configurado. Notas e transcrições manuais continuam disponíveis.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const saveBackupFile = async (onProgress?: (p: BackupProgress) => void) => {
    const { blob } = await makeBackupZip(onProgress);
    download(blob, backupFileName());
    markBackup();
    return blob;
  };
  const exportBackup = async () => {
    setBusy('export');
    try {
      const bytes = await mediaBytes();
      const room = exportRoom(bytes, await navigator.storage?.estimate().catch(() => undefined));
      if (room === 'too-large')
        throw new Error(
          `Os arquivos do acervo somam ${formatBytes(bytes)} e passam de 4 GB, o limite de um backup. Apague gravações que você não usa mais e tente de novo.`,
        );
      if (
        room === 'tight' &&
        !(await confirm({
          title: 'Pouco espaço livre',
          message: `O navegador indica menos espaço livre do que este backup precisa (cerca de ${formatBytes(bytes)}). A exportação pode falhar no meio, sem prejudicar seus dados.`,
          confirmLabel: 'Exportar mesmo assim',
        }))
      )
        return;
      setProgress({ where: 'local', label: 'Preparando o backup' });
      const blob = await saveBackupFile(p =>
        setProgress({ where: 'local', label: 'Compactando o acervo', ...p }),
      );
      notify(
        `Backup exportado (${formatBytes(blob.size)}) com partituras, gravações, marcações e histórico.`,
      );
    } catch (e) {
      notify(errorText(e), 'error');
    } finally {
      setBusy('');
      setProgress(undefined);
    }
  };
  const restore = async (where: Progress['where'], load: () => Promise<Blob>) => {
    setBusy('restore');
    exportFirst.current = undefined;
    try {
      setProgress({ where, label: where === 'cloud' ? 'Baixando a cópia' : 'Abrindo o arquivo' });
      const prepared = await openBackup(await load(), p =>
        setProgress({ where, label: 'Verificando o backup', ...p }),
      );
      setProgress(undefined);
      const ok = await confirm({
        title: 'Restaurar este backup?',
        message: (
          <RestoreSummary
            summary={prepared.summary}
            current={library}
            onExportFirst={() => (exportFirst.current = saveBackupFile())}
          />
        ),
        confirmLabel: 'Substituir e restaurar',
        danger: true,
      });
      if (!ok) return;
      if (exportFirst.current) {
        setProgress({ where, label: 'Terminando a cópia do acervo atual' });
        try {
          await exportFirst.current;
        } catch {
          throw new Error(
            'A cópia do acervo atual não foi concluída, então a restauração foi cancelada. Nenhum dado foi alterado.',
          );
        }
      }
      setProgress({ where, label: 'Restaurando' });
      await prepared.apply();
      // The data here now matches that backup, so it counts as backed up as of its date.
      markBackup(prepared.summary.createdAt);
      notify('Backup restaurado neste navegador.');
    } catch (e) {
      notify(errorText(e), 'error');
    } finally {
      setBusy('');
      setProgress(undefined);
    }
  };
  const uploadCloud = async () => {
    setBusy('cloud');
    let path = '';
    try {
      const bytes = await mediaBytes();
      if (bytes > CLOUD_BACKUP_LIMIT)
        throw new Error(
          `A cópia na nuvem aceita até ${formatBytes(CLOUD_BACKUP_LIMIT)}, e os arquivos do acervo somam ${formatBytes(bytes)}. Use “Exportar backup” para guardar tudo.`,
        );
      setProgress({ where: 'cloud', label: 'Preparando a cópia' });
      const { blob } = await makeBackupZip(p =>
        setProgress({ where: 'cloud', label: 'Compactando o acervo', ...p }),
      );
      if (blob.size > CLOUD_BACKUP_LIMIT)
        throw new Error(
          `A cópia na nuvem aceita até ${formatBytes(CLOUD_BACKUP_LIMIT)}, e este backup tem ${formatBytes(blob.size)}. Use “Exportar backup” para guardar tudo.`,
        );
      const { data } = await cloud!.auth.getUser();
      if (!data.user) throw new Error('Entre novamente na sua conta.');
      const id = crypto.randomUUID();
      path = `${data.user.id}/${id}.zip`;
      setProgress({ where: 'cloud', label: 'Enviando para a nuvem' });
      const upload = await cloud!.storage
        .from('compasso-backups')
        .upload(path, blob, { contentType: 'application/zip', upsert: false });
      if (upload.error) throw upload.error;
      const insert = await cloud!
        .from('compasso_backups')
        .insert({ id, owner_id: data.user.id, path, bytes: blob.size });
      if (insert.error) throw new Error(insert.error.message);
      path = '';
      markBackup();
      await refreshCloud();
      notify('Nova cópia salva na nuvem.');
    } catch (e) {
      if (path) await cloud!.storage.from('compasso-backups').remove([path]);
      notify(errorText(e), 'error');
    } finally {
      setBusy('');
      setProgress(undefined);
    }
  };

  const days = backupAgeDays(last);
  const newWork = since
    ? [
        since.sessions ? count(since.sessions, 'sessão nova', 'sessões novas') : '',
        since.files ? count(since.files, 'arquivo novo', 'arquivos novos') : '',
      ].filter(Boolean)
    : [];
  const stale = hasData(library) && (days === null || days > BACKUP_STALE_DAYS || (since?.files ?? 0) > 0);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SEU ACERVO, SOB SEU CONTROLE</span>
          <h1>Preferências e dados</h1>
          <p>Guarde uma cópia do que você está construindo.</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="panel">
          <ShieldCheck size={27} />
          <h2>Backup completo</h2>
          <p>
            Exporte partituras, gravações, marcações, aulas e histórico em um único arquivo .zip. A
            restauração aceita também backups .json antigos e substitui o acervo deste navegador.
          </p>
          <div className={`backup-status${stale ? ' stale' : ''}`}>
            {stale ? <AlertTriangle size={19} aria-hidden /> : <Clock size={19} aria-hidden />}
            <div>
              <strong>
                {last && days !== null
                  ? `Último backup: ${describeBackupAge(days)}`
                  : 'Nenhum backup feito neste navegador'}
              </strong>
              <small>
                {last
                  ? `${formatWhen(last)}.${newWork.length ? ` Desde então: ${joinPt(newWork)}.` : ''}${
                      days !== null && days > BACKUP_STALE_DAYS
                        ? ' Faz mais de uma semana: vale exportar uma cópia nova.'
                        : ''
                    }`
                  : hasData(library)
                    ? 'Seu acervo existe só aqui. Exporte uma cópia para não depender deste navegador.'
                    : 'Depois de adicionar peças e gravações, exporte uma cópia de vez em quando.'}
              </small>
            </div>
          </div>
          <div className="row wrap">
            <button className="btn" disabled={!!busy} onClick={() => void exportBackup()}>
              <Download size={17} />
              {busy === 'export' ? 'Exportando…' : 'Exportar backup'}
            </button>
            <label className={`btn secondary file-button${busy ? ' is-disabled' : ''}`}>
              <Upload size={17} />
              {busy === 'restore' && progress?.where === 'local' ? 'Restaurando…' : 'Restaurar arquivo'}
              <input
                type="file"
                accept=".zip,.json,application/zip,application/json"
                disabled={!!busy}
                onChange={e => {
                  const file = e.target.files?.[0];
                  e.target.value = '';
                  if (file) void restore('local', async () => file);
                }}
              />
            </label>
          </div>
          {progress?.where === 'local' && <ProgressBar {...progress} />}
          {!!library?.captures && (
            <p className="backup-captures">
              <AlertTriangle size={15} aria-hidden />
              {library.captures === 1
                ? 'Há 1 gravação interrompida ainda não recuperada. Ela não entra no backup.'
                : `Há ${library.captures} gravações interrompidas ainda não recuperadas. Elas não entram no backup.`}
            </p>
          )}
          <p className="hint">
            O arquivo contém seus dados pessoais e gravações. Guarde-o em um local de sua confiança. Para
            exportar, o navegador precisa de espaço livre parecido com o tamanho do acervo.
          </p>
        </section>
        <section className="panel">
          <HardDrive size={27} />
          <h2>Neste dispositivo</h2>
          <p>
            Os dados ficam no armazenamento do navegador. Eles não são sincronizados automaticamente com
            outros dispositivos.
          </p>
          <div className="status-box">
            {persistent ? (
              <>
                <Check size={16} /> Armazenamento persistente concedido.
              </>
            ) : (
              'O navegador ainda pode liberar o espaço deste aplicativo.'
            )}
          </div>
          {quota && (
            <>
              <div className="storage-meter">
                <span
                  style={{ width: `${Math.min(100, ((quota.usage ?? 0) / (quota.quota || 1)) * 100)}%` }}
                />
              </div>
              <p>
                {formatBytes(quota.usage ?? 0)} usados · quota aproximada {formatBytes(quota.quota ?? 0)}
              </p>
            </>
          )}
          <button
            className="btn secondary"
            disabled={persistent || !navigator.storage?.persist}
            onClick={async () => {
              try {
                const ok = await navigator.storage.persist();
                setPersistent(ok);
                notify(
                  ok
                    ? 'O navegador concedeu armazenamento persistente.'
                    : 'O navegador não concedeu persistência. Mantenha um backup exportado.',
                  ok ? 'success' : 'info',
                );
              } catch (e) {
                notify(errorText(e), 'error');
              }
            }}
          >
            <Database size={17} />
            Solicitar persistência
          </button>
          <p className="hint">
            Limpar os dados do navegador remove este acervo, inclusive quando a persistência foi concedida.
          </p>
        </section>
        <section className="panel">
          <Cloud size={27} />
          <h2>Cópias na nuvem</h2>
          <p>
            Quando configuradas, permitem salvar e recuperar cópias completas entre iPad e computador. São
            backups manuais, não mesclagem automática de alterações. Cada cópia aceita até{' '}
            {formatBytes(CLOUD_BACKUP_LIMIT)}.
          </p>
          {!cloud ? (
            <div className="status-box">
              A conexão com a nuvem ainda não foi configurada nesta instalação.
            </div>
          ) : user ? (
            <>
              <div className="row between">
                <span>{user}</span>
                <button
                  className="btn small secondary"
                  disabled={!!busy}
                  onClick={async () => {
                    try {
                      await cloud!.auth.signOut();
                      setUser('');
                      setBackups([]);
                    } catch (e) {
                      notify(errorText(e), 'error');
                    }
                  }}
                >
                  <LogOut size={15} />
                  Sair
                </button>
              </div>
              <button className="btn" disabled={!!busy} onClick={() => void uploadCloud()}>
                <Upload size={16} />
                {busy === 'cloud' ? 'Enviando…' : 'Criar cópia na nuvem'}
              </button>
              {progress?.where === 'cloud' && <ProgressBar {...progress} />}
              {backups.map(b => (
                <div className="simple-row" key={b.id}>
                  <div>
                    <strong>{new Date(b.created_at).toLocaleString('pt-BR')}</strong>
                    <small>
                      {formatBytes(b.bytes)}
                      {b.path.endsWith('.json') ? ' · formato antigo (.json)' : ''}
                    </small>
                  </div>
                  <button
                    className="btn small secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void restore('cloud', async () => {
                        const { data, error } = await cloud!.storage
                          .from('compasso-backups')
                          .download(b.path);
                        if (error) throw error;
                        return data;
                      })
                    }
                  >
                    Restaurar
                  </button>
                </div>
              ))}
            </>
          ) : (
            <form
              onSubmit={async e => {
                e.preventDefault();
                setBusy('login');
                try {
                  const { error } = await cloud!.auth.signInWithPassword({ email, password });
                  if (error) throw error;
                  setPassword('');
                  await refreshCloud();
                } catch (err) {
                  notify(errorText(err), 'error');
                } finally {
                  setBusy('');
                }
              }}
            >
              <Field label="E-mail">
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
              </Field>
              <Field label="Senha">
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                />
              </Field>
              <button className="btn" disabled={!!busy}>
                <LogIn size={17} />
                Entrar
              </button>
            </form>
          )}
        </section>
        <section className="panel">
          <Sparkles size={27} />
          <h2>Assistente das aulas</h2>
          <div className="status-box">{ai}</div>
          <p>
            A análise transforma uma transcrição em resumo e propostas de estudo. Você revisa o resultado
            antes de salvar tarefas.
          </p>
          <p>
            O áudio é enviado ao serviço de IA apenas quando você toca em “Transcrever áudio”. A análise de
            texto envia a transcrição selecionada.
          </p>
          <p className="hint">
            A transcrição aceita até 24 MB por solicitação nesta versão. As chaves do serviço ficam no
            servidor.
          </p>
        </section>
        <section className="panel">
          <h2>Usar no iPad</h2>
          <div className="status-box">
            {offlineReady
              ? 'Aplicativo preparado para abrir offline neste navegador.'
              : import.meta.env.PROD
                ? 'Preparando os arquivos para uso offline. É necessário abrir online uma primeira vez.'
                : 'O modo offline é ativado na versão de produção.'}
          </div>
          <p>
            Abra o aplicativo em uma conexão HTTPS no Safari e use Compartilhar → Adicionar à Tela de Início.
            Abra uma vez online antes de estudar offline.
          </p>
          <p>
            Durante o metrônomo e a gravação, mantenha a tela ativa. Ao mudar de aplicativo, o sistema pode
            interromper o áudio.
          </p>
          <p className="hint">
            A instalação deve ser validada no iPad físico. A prévia local no computador não é um endereço
            público.
          </p>
        </section>
        <section className="panel">
          <h2>Sobre o Compasso</h2>
          <p>Versão 0.1 · repertório, partituras, ciclos de prática e caderno de aulas.</p>
          <p>
            O histórico mede seu tempo e registra sua percepção. Ele não detecta notas tocadas nem avalia sua
            execução automaticamente.
          </p>
        </section>
      </div>
    </>
  );
}

function ProgressBar({ label, done, total }: Progress) {
  const pct = total ? Math.min(100, Math.floor(((done ?? 0) / total) * 100)) : undefined;
  return (
    <div className="backup-progress">
      <div className="backup-progress-label">
        <span role="status">{label}…</span>
        {pct !== undefined && <span aria-hidden>{pct}%</span>}
      </div>
      <div
        className={`backup-progress-bar${pct === undefined ? ' indeterminate' : ''}`}
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span style={pct === undefined ? undefined : { width: `${pct}%` }} />
      </div>
    </div>
  );
}

function RestoreSummary({
  summary,
  current,
  onExportFirst,
}: {
  summary: BackupSummary;
  current?: LibraryCounts;
  onExportFirst: () => Promise<unknown>;
}) {
  const items: [number, string, string][] = [
    [summary.pieces, 'peça', 'peças'],
    [summary.lessons, 'aula', 'aulas'],
    [summary.recordings, 'gravação', 'gravações'],
    [summary.sessions, 'sessão', 'sessões'],
  ];
  return (
    <div className="restore-summary">
      <p>
        Backup de <strong>{formatWhen(summary.createdAt)}</strong>
        {summary.version === 1 ? ', formato antigo (.json)' : ''} · {formatBytes(summary.bytes)}
      </p>
      <ul className="restore-counts">
        {items.map(([n, one, many]) => (
          <li key={one}>
            <strong>{n.toLocaleString('pt-BR')}</strong> {n === 1 ? one : many}
          </li>
        ))}
      </ul>
      <p className="restore-warning">
        <AlertTriangle size={18} aria-hidden />
        <span>
          {hasData(current)
            ? `Tudo o que está neste navegador (${describeLibrary(current!)}) será apagado e substituído pelo backup. Não é possível desfazer.`
            : 'Este navegador ainda não tem dados, então nada será perdido.'}
        </span>
      </p>
      {hasData(current) && <ExportFirst run={onExportFirst} />}
    </div>
  );
}

function ExportFirst({ run }: { run: () => Promise<unknown> }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle'),
    [error, setError] = useState('');
  if (state === 'done')
    return (
      <p className="export-first-done" role="status">
        <Check size={16} aria-hidden /> Cópia do acervo atual exportada.
      </p>
    );
  return (
    <div className="export-first">
      <button
        type="button"
        className="btn secondary"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy');
          try {
            await run();
            setState('done');
          } catch (e) {
            setError(errorText(e));
            setState('error');
          }
        }}
      >
        <Download size={16} />
        {state === 'busy' ? 'Exportando o acervo atual…' : 'Exportar o acervo atual antes'}
      </button>
      {state === 'error' && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
    </div>
  );
}
