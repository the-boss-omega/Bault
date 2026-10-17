import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider } from './shared/i18n';
import { ThemeProvider } from './shared/theme';
import { ErrorBoundary } from './shared/ui/ErrorBoundary';
import './index.css';

/** Remove the retired `bault.railPinned` preference that older builds stored. Nothing reads it. */
try {
  localStorage.removeItem('bault.railPinned');
} catch {
  /* private mode: nothing to clean up */
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

/**
 * The error boundary sits inside the theme and i18n providers so a render
 * failure is still shown in the viewer's theme and reading direction. The
 * providers themselves do almost nothing that can throw.
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
