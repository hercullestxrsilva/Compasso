import { useEffect, useState } from 'react';
import {
  Download,
  Upload,
  ShieldCheck,
  Database,
  Cloud,
  LogIn,
  LogOut,
  Check,
  HardDrive,
  Sparkles,
} from 'lucide-react';
import { makeBackup, parseBackup, restoreBackup, type Backup } from '../backup';
import { cloud } from '../services';
import { localDay } from '../domain';
import { Modal, Field, ErrorBox, download, errorText } from './common';
interface CloudRow {
  id: string;
  created_at: string;
  path: string;
  bytes: number;
}
export default function Settings({ notify }: { notify: (s: string) => void }) {
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
    [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [restore, setRestore] = useState<Backup>();
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [user, setUser] = useState(''),
    [backups, setBackups] = useState<CloudRow[]>([]),
    [ai, setAi] = useState('Verificando serviço…');
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
  const exportBackup = async () => {
    setBusy('export');
    setError('');
    try {
      const backup = await makeBackup();
      download(
        new Blob([JSON.stringify(backup)], { type: 'application/json' }),
        `compasso-backup-${localDay()}.json`,
      );
      notify('Backup exportado com partituras, áudios e anotações.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SEU ACERVO, SOB SEU CONTROLE</span>
          <h1>Preferências e dados</h1>
          <p>Guarde uma cópia do que você está construindo.</p>
        </div>
      </div>
      <ErrorBox message={error} />
      <div className="settings-grid">
        <section className="panel">
          <ShieldCheck size={27} />
          <h2>Backup completo</h2>
          <p>
            Exporte partituras, gravações, marcações, aulas e histórico em um único arquivo. A restauração
            substitui o acervo deste navegador.
          </p>
          <div className="row wrap">
            <button className="btn" disabled={!!busy} onClick={() => void exportBackup()}>
              <Download size={17} />
              {busy === 'export' ? 'Preparando…' : 'Exportar backup'}
            </button>
            <label className="btn secondary file-button">
              <Upload size={17} />
              Restaurar arquivo
              <input
                type="file"
                accept="application/json,.json"
                disabled={!!busy}
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setError('');
                  try {
                    if (file.size > 180 * 1024 * 1024) throw new Error('O arquivo excede 180 MB.');
                    setRestore(parseBackup(await file.text()));
                  } catch (err) {
                    setError(errorText(err));
                  }
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <p className="hint">
            O arquivo contém seus dados pessoais e gravações. Guarde-o em um local de sua confiança. Capturas
            ainda não finalizadas precisam ser recuperadas em Aulas antes de exportar.
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
                {((quota.usage ?? 0) / 1024 / 1024).toFixed(1)} MB usados · quota aproximada{' '}
                {((quota.quota ?? 0) / 1024 / 1024 / 1024).toFixed(1)} GB
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
                );
              } catch (e) {
                setError(errorText(e));
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
            backups manuais, não mesclagem automática de alterações.
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
                  onClick={async () => {
                    await cloud!.auth.signOut();
                    setUser('');
                    setBackups([]);
                  }}
                >
                  <LogOut size={15} />
                  Sair
                </button>
              </div>
              <button
                className="btn"
                disabled={!!busy}
                onClick={async () => {
                  setBusy('cloud');
                  setError('');
                  let path = '';
                  try {
                    const backup = await makeBackup();
                    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
                    if (blob.size > 45 * 1024 * 1024)
                      throw new Error(
                        'O backup na nuvem aceita até 45 MB nesta versão. Use a exportação local para acervos maiores.',
                      );
                    const { data } = await cloud!.auth.getUser();
                    if (!data.user) throw new Error('Entre novamente na sua conta.');
                    const id = crypto.randomUUID();
                    path = `${data.user.id}/${id}.json`;
                    const upload = await cloud!.storage
                      .from('compasso-backups')
                      .upload(path, blob, { contentType: 'application/json', upsert: false });
                    if (upload.error) throw upload.error;
                    const insert = await cloud!
                      .from('compasso_backups')
                      .insert({ id, owner_id: data.user.id, path, bytes: blob.size });
                    if (insert.error) throw insert.error;
                    path = '';
                    await refreshCloud();
                    notify('Nova cópia salva na nuvem.');
                  } catch (e) {
                    if (path) await cloud!.storage.from('compasso-backups').remove([path]);
                    setError(errorText(e));
                  } finally {
                    setBusy('');
                  }
                }}
              >
                <Upload size={16} />
                {busy === 'cloud' ? 'Enviando…' : 'Criar cópia na nuvem'}
              </button>
              {backups.map(b => (
                <div className="simple-row" key={b.id}>
                  <div>
                    <strong>{new Date(b.created_at).toLocaleString('pt-BR')}</strong>
                    <small>{(b.bytes / 1024 / 1024).toFixed(1)} MB</small>
                  </div>
                  <button
                    className="btn small secondary"
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy('download');
                      try {
                        const { data, error } = await cloud!.storage
                          .from('compasso-backups')
                          .download(b.path);
                        if (error) throw error;
                        setRestore(parseBackup(await data.text()));
                      } catch (e) {
                        setError(errorText(e));
                      } finally {
                        setBusy('');
                      }
                    }}
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
                setError('');
                try {
                  const { error } = await cloud!.auth.signInWithPassword({ email, password });
                  if (error) throw error;
                  setPassword('');
                  await refreshCloud();
                } catch (err) {
                  setError(errorText(err));
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
      {restore && (
        <Modal title="Restaurar este backup?" onClose={() => setRestore(undefined)}>
          <p>
            Este arquivo contém{' '}
            <strong>
              {restore.tables.pieces.length} peças, {restore.tables.lessons.length} aulas e{' '}
              {restore.tables.sessions.length} sessões
            </strong>
            .
          </p>
          <p>O acervo atual será substituído. Exporte uma cópia antes de continuar, se quiser preservá-lo.</p>
          <footer className="modal-actions">
            <button className="btn secondary" disabled={!!busy} onClick={() => setRestore(undefined)}>
              Cancelar
            </button>
            <button
              className="btn danger"
              disabled={!!busy}
              onClick={async () => {
                setBusy('restore');
                try {
                  await restoreBackup(restore);
                  setRestore(undefined);
                  notify('Backup restaurado neste dispositivo.');
                } catch (e) {
                  setError(errorText(e));
                } finally {
                  setBusy('');
                }
              }}
            >
              {busy === 'restore' ? 'Restaurando…' : 'Substituir e restaurar'}
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
