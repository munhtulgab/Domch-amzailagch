import { lazy, Suspense } from 'react';
import Landing from './Landing.jsx';

const Admin = lazy(() => import('./admin/Admin.jsx'));

export default function App() {
  const path = window.location.pathname.replace(/\/+$/, '');
  if (path === '/admin') {
    return (
      <Suspense fallback={<p className="admin-loading">Ачаалж байна…</p>}>
        <Admin />
      </Suspense>
    );
  }
  return <Landing />;
}
