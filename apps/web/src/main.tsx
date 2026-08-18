import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider } from './shared/i18n';
import './index.css';

/**
 * Drop the retired rail-pin preference.
 *
 * The rail used to persist `bault.railPinned`, and browsers that ran the old
 * build still hold that key. Nothing reads it any more, so leaving it would only
 * be a stale row in devtools that suggests a setting the product no longer has.
 * Removed once, on boot, and never written again.
 */
try {
  localStorage.removeItem('bault.railPinned');
} catch {
  /* private mode — nothing to clean up */
}

// Mount point: finds <div id="root"> from index.html and renders the SPA.
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <I18nProvider>
      <App />
    </I18nProvider>
  </StrictMode>,
);
