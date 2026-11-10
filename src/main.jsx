import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App.jsx';
import './styles.css';

// Vercel Web Analytics: page views of the public site only (the admin is left out)
const skipAdmin = (event) => (new URL(event.url).pathname.startsWith('/admin') ? null : event);

createRoot(document.getElementById('root')).render(
  <>
    <App />
    <Analytics beforeSend={skipAdmin} />
  </>,
);
