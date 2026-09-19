import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider } from './shared/i18n';
import { ThemeProvider } from './shared/theme';
import { ErrorBoundary } from './shared/ui/ErrorBoundary';
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

/**
 * The boundary sits INSIDE the providers, not outside them.
 *
 * A render failure should still be shown in the viewer's theme and reading
 * direction — a fallback that appears untinted and left-to-right in a Hebrew RTL
 * session looks like a second, worse failure. Putting it here also means the
 * providers themselves are the only thing left uncovered, and they do almost
 * nothing that can throw.
 */
createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
);
