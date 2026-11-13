import { Component, lazy, Suspense } from 'react';
import Landing from './Landing.jsx';

const RELOAD_KEY = 'domch_admin_reloaded';

// After a new release the old chunk files no longer exist, so a page opened before it fails to load them.
// One automatic reload fetches the new version.
const reloading = (load) => () => load()
  .then((mod) => {
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch {
      /* ignore */
    }
    return mod;
  })
  .catch((err) => {
    let reloaded = false;
    try {
      reloaded = sessionStorage.getItem(RELOAD_KEY) === '1';
      if (!reloaded) sessionStorage.setItem(RELOAD_KEY, '1');
    } catch {
      reloaded = true;
    }
    if (!reloaded) {
      window.location.reload();
      return new Promise(() => {});
    }
    throw err;
  });

const Admin = lazy(reloading(() => import('./admin/Admin.jsx')));
const Demo = lazy(reloading(() => import('./demo/Demo.jsx')));

/** /demo: if the page cannot start, point to the main site instead of an empty screen. */
class DemoBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error) {
    console.error('[demo]', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="demo-crash" role="alert">
        <p>Хуудсыг ачаалж чадсангүй.</p>
        <a href="/">DOMCH үндсэн сайт руу очих</a>
      </div>
    );
  }
}

/** Shows what went wrong instead of an empty page, with a way to try again. */
class AdminBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[admin]', error, info && info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const retry = () => {
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        /* ignore */
      }
      window.location.reload();
    };
    const signOut = () => {
      try {
        sessionStorage.removeItem('domch_admin_token');
      } catch {
        /* ignore */
      }
      retry();
    };
    return (
      <div className="admin-crash" role="alert">
        <h1>Удирдлагын хэсгийг ачаалж чадсангүй</h1>
        <p>Хуудсаа дахин ачаалж үзнэ үү. Дахиад гарвал доорх алдааны мэдээллийг илгээгээрэй.</p>
        <pre>{String((error && (error.stack || error.message)) || error).slice(0, 800)}</pre>
        <div className="admin-crash__btns">
          <button type="button" onClick={retry}>Дахин ачаалах</button>
          <button type="button" onClick={signOut}>Гараад дахин нэвтрэх</button>
        </div>
      </div>
    );
  }
}

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/admin') {
    return (
      <AdminBoundary>
        <Suspense fallback={<p className="admin-loading">Ачаалж байна…</p>}>
          <Admin />
        </Suspense>
      </AdminBoundary>
    );
  }
  if (path === '/demo') {
    return (
      <DemoBoundary>
        <Suspense fallback={<div className="demo-loading" />}>
          <Demo />
        </Suspense>
      </DemoBoundary>
    );
  }
  return <Landing />;
}
