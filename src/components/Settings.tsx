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
  UnreadableAssetError,
  backupAgeDays,
  backupFileName,
  backupTables,
  cloudErrorText,
  describeBackupAge,
  describeUnreadable,
  exportRoom,
  formatBytes,
  lastBackupAt,
  lastBackupHow,
  makeBackupZip,
  markBackup,
  mediaBytes,
  openBackup,
  type BackupProgress,
  type BackupSummary,
  type BackupTable,
} from '../backup';
import { db } from '../db';
import { SaveCancelled, pickSaveTarget, saveBlob, type SaveResult, type SaveTarget } from '../saveFile';
import { cloud } from '../services';
import { Field, errorText, useConfirm, type Notify } from './common';
import '../styles/settings.css';
interface CloudRow {
  id: string;
  created_at: string;
  path: string;
  bytes: number;
}
/** Rows per backed-up table, plus interrupted captures (not in backups) and the backed-up total. */
type LibraryCounts = Record<BackupTable, number> & { captures: number; total: number };
interface Progress {
  where: 'local' | 'cloud';
  label: string;
  done?: number;
  total?: number;
}
type ExportRun = (
  target: SaveTarget,
  onProgress: (p: BackupProgress) => void,
  skip: string[],
) => Promise<SaveResult>;
interface ExportFirstOptions {
  room: ReturnType<typeof exportRoom>;
  bytes: number;
  run: ExportRun;
}
const count = (n: number, one: string, many: string) =>
  `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;
const joinPt = (items: string[]) =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
const describeLibrary = (c: LibraryCounts) =>
  joinPt(
    (
      [
        [c.pieces, 'peça', 'peças'],
        [c.lessons, 'aula', 'aulas'],
        [c.recordings, 'gravação', 'gravações'],
        [c.sessions, 'sessão', 'sessões'],
      ] as const
    )
      .filter(([n]) => n > 0)
      .map(([n, one, many]) => count(n, one, many)),
  );
const formatWhen = (iso: string) => {
  const date = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(date.getTime())) return iso;
  return iso.length === 10
    ? date.toLocaleDateString('pt-BR', { dateStyle: 'long' })
    : date.toLocaleString('pt-BR', { dateStyle: 'long', timeStyle: 'short' });
};
const hasData = (c?: LibraryCounts) => !!c && c.total > 0;
const estimate = async () => {
  try {
    return await navigator.storage?.estimate();
  } catch {
    return undefined;
  }
};
const freeSpace = (e?: StorageEstimate) =>
  e?.quota && e.usage !== undefined ? Math.max(0, e.quota - e.usage) : undefined;
const skipOptions = (e: UnreadableAssetError) => {
  const one = e.assets.length === 1;
  return {
    title: one ? 'Um arquivo não pôde ser lido' : 'Alguns arquivos não puderam ser lidos',
    message: `${describeUnreadable(e.assets)} Você pode exportar todo o resto: os registros entram no backup, só sem ${one ? 'esse arquivo' : 'esses arquivos'}.`,
    confirmLabel: one ? 'Exportar sem este arquivo' : 'Exportar sem esses arquivos',
  };
};

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
    [restoring, setRestoring] = useState(''),
    [last, setLast] = useState(lastBackupAt),
    [lastHow, setLastHow] = useState(lastBackupHow);
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [user, setUser] = useState(''),
    [backups, setBackups] = useState<CloudRow[]>([]),
    [ai, setAi] = useState('Verificando serviço…');
  /** Export of the current library started from the restore dialog. */
  const exportFirst = useRef<{ promise: Promise<SaveResult>; settled: boolean } | undefined>(undefined);
  const library = useLiveQuery(async (): Promise<LibraryCounts> => {
    const counts = await Promise.all(backupTables.map(n => db.table(n).count()));
    const byTable = Object.fromEntries(backupTables.map((n, i) => [n, counts[i]])) as Record<
      BackupTable,
      number
    >;
    return { ...byTable, captures: await db.captures.count(), total: counts.reduce((s, n) => s + n, 0) };
  });
  const libraryBytes = useLiveQuery(mediaBytes);
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
    const sync = () => {
      setLast(lastBackupAt());
      setLastHow(lastBackupHow());
    };
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
      if (error) throw new Error(cloudErrorText(error, 'Não foi possível listar as cópias na nuvem.'));
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

  /** Saves the zip and records the backup at its snapshot time, so later work still counts as new. */
  const save = async ({ blob, summary }: { blob: Blob; summary: BackupSummary }, target: SaveTarget) => {
    const how = await saveBlob(blob, backupFileName(), target);
    markBackup(summary.createdAt, how);
    return how;
  };
  /** makeBackupZip, offering to leave out files this browser can no longer read. */
  const buildZip = async (where: Progress['where']) => {
    let skip: string[] = [];
    for (;;) {
      setProgress({ where, label: 'Preparando o backup' });
      try {
        return await makeBackupZip(p => setProgress({ where, label: 'Compactando o acervo', ...p }), skip);
      } catch (e) {
        if (!(e instanceof UnreadableAssetError)) throw e;
        setProgress(undefined);
        if (!(await confirm(skipOptions(e)))) throw new SaveCancelled();
        skip = [...skip, ...e.assets.map(a => a.id)];
      }
    }
  };
  const exportBackup = async () => {
    setBusy('export');
    try {
      const bytes = await mediaBytes();
      const room = exportRoom(bytes, await estimate());
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
      // Ask where to save while this tap still counts as a user action (Chrome and Edge).
      const target = await pickSaveTarget(backupFileName());
      const zip = await buildZip('local');
      setProgress({ where: 'local', label: 'Salvando o arquivo' });
      const how = await save(zip, target);
      notify(
        how === 'file'
          ? `Backup salvo (${formatBytes(zip.summary.bytes)}) com partituras, gravações, marcações e histórico.`
          : `Download do backup iniciado (${formatBytes(zip.summary.bytes)}). Confira se o arquivo foi salvo na pasta Downloads.`,
      );
    } catch (e) {
      if (!(e instanceof SaveCancelled)) notify(errorText(e), 'error');
    } finally {
      setBusy('');
      setProgress(undefined);
    }
  };
  const exportCurrent =
    (where: Progress['where']): ExportRun =>
    (target, onProgress, skip) => {
      const entry = {
        settled: false,
        promise: makeBackupZip(p => {
          onProgress(p);
          // Also shown in the panel, which keeps it visible if the dialog is closed meanwhile.
          setProgress({ where, label: 'Exportando o acervo atual', ...p });
        }, skip).then(zip => save(zip, target)),
      };
      void entry.promise.then(
        () => (entry.settled = true),
        () => (entry.settled = true),
      );
      exportFirst.current = entry;
      return entry.promise;
    };
  const restore = async (where: Progress['where'], load: () => Promise<Blob>, cloudId = '') => {
    setBusy('restore');
    setRestoring(cloudId);
    let confirmed = false;
    try {
      setProgress({ where, label: where === 'cloud' ? 'Baixando a cópia' : 'Abrindo o arquivo' });
      const prepared = await openBackup(await load(), p =>
        setProgress({ where, label: 'Verificando o backup', ...p }),
      );
      const [bytesNow, space] = await Promise.all([mediaBytes(), estimate()]);
      setProgress(undefined);
      confirmed = await confirm({
        title: 'Restaurar este backup?',
        message: (
          <RestoreSummary
            summary={prepared.summary}
            current={library}
            free={freeSpace(space)}
            exportFirst={
              library && !hasData(library)
                ? undefined
                : { room: exportRoom(bytesNow, space), bytes: bytesNow, run: exportCurrent(where) }
            }
          />
        ),
        confirmLabel: 'Substituir e restaurar',
        danger: true,
      });
      if (!confirmed) return;
      const first = exportFirst.current;
      if (first) {
        let how: SaveResult;
        try {
          how = await first.promise;
        } catch {
          throw new Error(
            'A cópia do acervo atual não foi concluída, então a restauração foi cancelada. Nenhum dado foi alterado.',
          );
        }
        setProgress(undefined);
        // A download cannot be confirmed from here: the student checks before anything is erased.
        if (
          how === 'download' &&
          !(await confirm({
            title: 'A cópia do acervo atual foi salva?',
            message: (
              <p className="confirm-focus" tabIndex={-1} data-autofocus>
                O download foi iniciado, mas o navegador não informa se o arquivo chegou a ser salvo. Confira
                na pasta Downloads (no iPad, no app Arquivos) antes de continuar: a restauração apaga o acervo
                deste navegador.
              </p>
            ),
            confirmLabel: 'Já conferi, restaurar',
            danger: true,
          }))
        )
          return;
      }
      setProgress({ where, label: 'Restaurando' });
      await prepared.apply();
      // The data here now matches a backup the student holds, so nothing is pending as of now.
      markBackup(new Date(), 'restore');
      notify('Backup restaurado neste navegador.');
    } catch (e) {
      notify(errorText(e), 'error');
    } finally {
      // An export started from the dialog keeps running after Cancelar; stay busy until it ends.
      const pending = exportFirst.current;
      exportFirst.current = undefined;
      if (pending && !confirmed) {
        const wasRunning = !pending.settled;
        try {
          const how = await pending.promise;
          if (wasRunning)
            notify(
              how === 'file'
                ? 'Cópia do acervo atual salva.'
                : 'Download da cópia do acervo atual iniciado. Confira se o arquivo foi salvo.',
            );
        } catch (e) {
          if (wasRunning && !(e instanceof SaveCancelled)) notify(errorText(e), 'error');
        }
      }
      setBusy('');
      setRestoring('');
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
      const { blob, summary } = await buildZip('cloud');
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
      if (upload.error)
        throw new Error(cloudErrorText(upload.error, 'Não foi possível enviar a cópia para a nuvem.'));
      const insert = await cloud!
        .from('compasso_backups')
        .insert({ id, owner_id: data.user.id, path, bytes: blob.size });
      if (insert.error)
        throw new Error(cloudErrorText(insert.error, 'Não foi possível registrar a cópia na nuvem.'));
      path = '';
      markBackup(summary.createdAt, 'cloud');
      notify('Nova cópia salva na nuvem.');
      await refreshCloud();
    } catch (e) {
      if (path) await cloud!.storage.from('compasso-backups').remove([path]);
      if (!(e instanceof SaveCancelled)) notify(errorText(e), 'error');
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
  const cloudTooBig = libraryBytes !== undefined && libraryBytes > CLOUD_BACKUP_LIMIT;
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
                  ? `${lastHow === 'download' ? 'Última exportação' : 'Último backup'}: ${describeBackupAge(days)}`
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
          <p className="sr-only" aria-live="polite">
            {progress?.where === 'local' ? `${progress.label}…` : ''}
          </p>
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
                      notify(cloudErrorText(e, 'Não foi possível sair da conta. Tente de novo.'), 'error');
                    }
                  }}
                >
                  <LogOut size={15} />
                  Sair
                </button>
              </div>
              <button className="btn" disabled={!!busy || cloudTooBig} onClick={() => void uploadCloud()}>
                <Upload size={16} />
                {busy === 'cloud' ? 'Enviando…' : 'Criar cópia na nuvem'}
              </button>
              {cloudTooBig && (
                <p className="hint">
                  Os arquivos do acervo somam {formatBytes(libraryBytes ?? 0)}, acima do limite de{' '}
                  {formatBytes(CLOUD_BACKUP_LIMIT)} por cópia. Use “Exportar backup” para guardar tudo.
                </p>
              )}
              {progress?.where === 'cloud' && <ProgressBar {...progress} />}
              <p className="sr-only" aria-live="polite">
                {progress?.where === 'cloud' ? `${progress.label}…` : ''}
              </p>
              {backups.map(b => (
                <div className="simple-row" key={b.id}>
                  <div>
                    <strong>{formatWhen(b.created_at)}</strong>
                    <small>
                      {formatBytes(b.bytes)}
                      {b.path.endsWith('.json') ? ' · formato antigo (.json)' : ''}
                    </small>
                  </div>
                  <button
                    className="btn small secondary"
                    disabled={!!busy}
                    onClick={() =>
                      void restore(
                        'cloud',
                        async () => {
                          const { data, error } = await cloud!.storage
                            .from('compasso-backups')
                            .download(b.path);
                          if (error)
                            throw new Error(
                              cloudErrorText(error, 'Não foi possível baixar esta cópia da nuvem.'),
                            );
                          return data;
                        },
                        b.id,
                      )
                    }
                  >
                    {restoring === b.id ? 'Restaurando…' : 'Restaurar'}
                    <span className="sr-only"> a cópia de {formatWhen(b.created_at)}</span>
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
                  if (error)
                    throw new Error(cloudErrorText(error, 'Não foi possível entrar. Tente de novo.'));
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

/** The visual bar; phase changes are announced by a live region that stays mounted next to it. */
function ProgressBar({ label, done, total }: { label: string; done?: number; total?: number }) {
  const pct = total ? Math.min(100, Math.floor(((done ?? 0) / total) * 100)) : undefined;
  return (
    <div className="backup-progress">
      <div className="backup-progress-label" aria-hidden>
        <span>{label}…</span>
        {pct !== undefined && <span>{pct}%</span>}
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
  free,
  exportFirst,
}: {
  summary: BackupSummary;
  /** Undefined while still counting: treated as data that would be lost. */
  current?: LibraryCounts;
  free?: number;
  exportFirst?: ExportFirstOptions;
}) {
  const items: [number, string, string][] = [
    [summary.pieces, 'peça', 'peças'],
    [summary.lessons, 'aula', 'aulas'],
    [summary.recordings, 'gravação', 'gravações'],
    [summary.sessions, 'sessão', 'sessões'],
  ];
  const detail = current ? describeLibrary(current) : '';
  return (
    // Focus starts on the summary, not on the destructive button, so a stray Enter erases nothing.
    <div className="restore-summary" tabIndex={-1} data-autofocus>
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
      {summary.missingFiles > 0 && (
        <p className="restore-note">
          {summary.missingFiles === 1
            ? '1 arquivo não pôde ser lido quando este backup foi feito e não está nele. O item volta sem esse arquivo.'
            : `${summary.missingFiles} arquivos não puderam ser lidos quando este backup foi feito e não estão nele. Os itens voltam sem esses arquivos.`}
        </p>
      )}
      {free !== undefined && free < summary.mediaBytes * 1.1 && (
        <p className="restore-note">
          O navegador indica {formatBytes(free)} livres, e os arquivos deste backup somam{' '}
          {formatBytes(summary.mediaBytes)}. A restauração pode falhar por falta de espaço; se falhar, nada
          muda.
        </p>
      )}
      <p className="error-box restore-warning">
        <AlertTriangle size={18} aria-hidden />
        <span>
          {exportFirst
            ? `Tudo o que está neste navegador${detail ? ` (${detail})` : ''} será apagado e substituído pelo backup. Não é possível desfazer.`
            : 'Este navegador ainda não tem dados, então nada será perdido.'}
        </span>
      </p>
      {exportFirst && <ExportFirst {...exportFirst} />}
    </div>
  );
}

function ExportFirst({ room, bytes, run }: ExportFirstOptions) {
  const [state, setState] = useState<'idle' | 'busy' | 'error' | SaveResult>('idle'),
    [error, setError] = useState(''),
    [unreadable, setUnreadable] = useState<UnreadableAssetError>(),
    [progress, setProgress] = useState<BackupProgress>();
  const skipped = useRef<string[]>([]);
  const status = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    // The button disappears when the copy is done; keep keyboard and VoiceOver users in place.
    if (state === 'file' || state === 'download') status.current?.focus();
  }, [state]);
  if (room === 'too-large')
    return (
      <p className="restore-note">
        Não dá para exportar o acervo atual antes: os arquivos somam {formatBytes(bytes)} e passam de 4 GB, o
        limite de um backup.
      </p>
    );
  if (state === 'file' || state === 'download')
    return (
      <p ref={status} tabIndex={-1} className={`export-first-done${state === 'download' ? ' pending' : ''}`}>
        {state === 'file' ? <Check size={16} aria-hidden /> : <Download size={16} aria-hidden />}
        {state === 'file'
          ? 'Cópia do acervo atual salva.'
          : 'Download da cópia iniciado. Confira se o arquivo foi salvo antes de restaurar.'}
      </p>
    );
  const start = async () => {
    if (state === 'busy') return;
    const skip = unreadable ? [...skipped.current, ...unreadable.assets.map(a => a.id)] : skipped.current;
    setState('busy');
    setError('');
    setProgress(undefined);
    try {
      // First, while the tap still counts as a user action.
      const target = await pickSaveTarget(backupFileName());
      skipped.current = skip;
      setUnreadable(undefined);
      setState(await run(target, setProgress, skip));
    } catch (e) {
      if (e instanceof SaveCancelled) return setState(unreadable ? 'error' : 'idle');
      setUnreadable(e instanceof UnreadableAssetError ? e : undefined);
      setError(errorText(e));
      setState('error');
    }
  };
  return (
    <div className="export-first">
      {room === 'tight' && state === 'idle' && (
        <p className="restore-note">
          Pouco espaço livre: a cópia (cerca de {formatBytes(bytes)}) pode falhar no meio, sem prejudicar seus
          dados.
        </p>
      )}
      <button
        type="button"
        className="btn secondary"
        aria-disabled={state === 'busy'}
        onClick={() => void start()}
      >
        <Download size={16} aria-hidden />
        {state === 'busy'
          ? 'Exportando o acervo atual…'
          : unreadable
            ? unreadable.assets.length === 1
              ? 'Exportar sem este arquivo'
              : 'Exportar sem esses arquivos'
            : state === 'error'
              ? 'Tentar exportar de novo'
              : 'Exportar o acervo atual antes'}
      </button>
      {state === 'busy' && progress && <ProgressBar label="Exportando o acervo atual" {...progress} />}
      <p className="sr-only" aria-live="polite">
        {state === 'busy' ? 'Exportando o acervo atual…' : ''}
      </p>
      {state === 'error' && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
    </div>
  );
}
