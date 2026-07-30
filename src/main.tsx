import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Global handler for stale asset chunk loading errors (e.g. 404 on re-deployed hashed JS bundles)
window.addEventListener('error', (e) => {
  const target = e.target as HTMLElement | null;
  if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
    const isReloaded = sessionStorage.getItem('stale_asset_reloaded');
    if (!isReloaded) {
      sessionStorage.setItem('stale_asset_reloaded', 'true');
      window.location.reload();
    }
  }
}, true);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);


