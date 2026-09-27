import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import {
  LayoutDashboard,
  LibraryBig,
  AudioLines,
  Headphones,
  ChartNoAxesCombined,
  Settings2,
  Menu,
  X,
  WifiOff,
  Check,
  Music2,
  ArrowUpRight,
} from 'lucide-react';
import Dashboard from './components/Dashboard';
import { Library, PieceForm } from './components/Library';
import PieceDetail from './components/PieceDetail';
import Practice from './components/Practice';
import Lessons from './components/Lessons';
import Progress from './components/Progress';
import Settings from './components/Settings';
const nav = [
  ['home', 'Hoje', LayoutDashboard],
  ['library', 'Repertório', LibraryBig],
  ['practice', 'Praticar', AudioLines],
  ['lessons', 'Aulas', Headphones],
  ['progress', 'Evolução', ChartNoAxesCombined],
] as const;
class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(error, info);
  }
  render() {
    return this.state.error ? (
      <div className="empty">
        <h1>Precisamos reabrir esta tela.</h1>
        <p>Seus dados salvos continuam no dispositivo.</p>
        <button className="btn" onClick={() => location.reload()}>
          Reabrir aplicativo
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function App() {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width:700px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width:700px)');
    const update = () => setNarrow(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const [view, setView] = useState('home'),
    [pieceId, setPieceId] = useState(''),
    [segmentId, setSegmentId] = useState(''),
    [adding, setAdding] = useState(false),
    [mobile, setMobile] = useState(false),
    [toast, setToast] = useState(''),
    [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const fn = () => setOnline(navigator.onLine);
    window.addEventListener('online', fn);
    window.addEventListener('offline', fn);
    return () => {
      window.removeEventListener('online', fn);
      window.removeEventListener('offline', fn);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const go = (next: string) => {
    setView(next);
    setPieceId('');
    setMobile(false);
    window.scrollTo({ top: 0 });
  };
  const openPiece = (id: string) => {
    setPieceId(id);
    setView('library');
    window.scrollTo({ top: 0 });
  };
  const practice = (id: string) => {
    setSegmentId(id);
    go('practice');
  };
  return (
    <ErrorBoundary>
      <div className="app-shell">
        <div className="mobile-top">
          <button className="brand" onClick={() => go('home')}>
            <Music2 size={24} />
            <span>
              compasso<span className="brand-dot">.</span>
            </span>
          </button>
          <button className="icon-btn" aria-label="Abrir navegação" onClick={() => setMobile(!mobile)}>
            {mobile ? <X /> : <Menu />}
          </button>
        </div>
        {mobile && (
          <button className="nav-scrim" aria-label="Fechar navegação" onClick={() => setMobile(false)} />
        )}
        <aside
          inert={narrow && !mobile}
          aria-hidden={narrow && !mobile}
          className={`sidebar ${mobile ? 'open' : ''}`}
        >
          <button className="brand" onClick={() => go('home')}>
            <div className="brand-mark">
              <Music2 size={25} />
            </div>
            <span>
              compasso<span className="brand-dot">.</span>
            </span>
          </button>
          <div className="sidebar-caption">SEU CADERNO DE PIANO</div>
          <nav aria-label="Navegação principal">
            {nav.map(([key, label, Icon]) => (
              <button key={key} className={view === key ? 'active' : ''} onClick={() => go(key)}>
                <Icon size={20} />
                <span>{label}</span>
                {view === key && <span className="nav-indicator" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-note">
              <span className="eyebrow">O ESTUDO É SEU.</span>
              <p>
                Cada pequena melhora
                <br />
                merece ser ouvida.
              </p>
            </div>
            <button
              className={`settings-nav ${view === 'settings' ? 'active' : ''}`}
              onClick={() => go('settings')}
            >
              <Settings2 size={19} />
              Preferências e dados
            </button>
            <div className="device-state">
              {online ? <Check size={15} /> : <WifiOff size={15} />}
              <span>{online ? 'Salvo neste dispositivo' : 'Você está offline'}</span>
            </div>
          </div>
        </aside>
        <main className="main-content">
          <div className="topbar">
            <span>MEU ESTÚDIO</span>
            <button onClick={() => go('settings')} className="storage-indicator">
              {online ? <Check size={14} /> : <WifiOff size={14} />}Dados locais <ArrowUpRight size={14} />
            </button>
          </div>
          {view === 'home' && (
            <Dashboard
              onNavigate={go}
              onPiece={openPiece}
              onPractice={practice}
              onAdd={() => setAdding(true)}
              notify={setToast}
            />
          )}
          {view === 'library' &&
            (pieceId ? (
              <PieceDetail
                id={pieceId}
                onBack={() => setPieceId('')}
                onPractice={practice}
                notify={setToast}
              />
            ) : (
              <Library onOpen={openPiece} notify={setToast} />
            ))}
          {view === 'practice' && (
            <Practice selectedId={segmentId} onSelect={setSegmentId} notify={setToast} />
          )}
          {view === 'lessons' && <Lessons notify={setToast} />}
          {view === 'progress' && <Progress onPractice={practice} notify={setToast} />}
          {view === 'settings' && <Settings notify={setToast} />}
          <footer className="app-footer">
            <span>compasso.</span>
            <span>Seu estudo, uma nota de cada vez.</span>
          </footer>
        </main>
        {adding && (
          <PieceForm
            onClose={() => setAdding(false)}
            onSaved={id => {
              openPiece(id);
              setToast('Peça adicionada ao repertório.');
            }}
          />
        )}
        {toast && (
          <div className="toast" role="status">
            <Check size={18} />
            <span>{toast}</span>
            <button className="icon-btn" aria-label="Fechar aviso" onClick={() => setToast('')}>
              <X size={17} />
            </button>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
