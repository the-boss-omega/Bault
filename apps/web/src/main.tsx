import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider } from './shared/i18n';
import { ThemeProvider } from './shared/theme';
import { ErrorBoundary } from './shared/ui/ErrorBoundary';
import './index.css';
import './theme.css';
import './components.css';
import './landing.css';
import './motion.css';

try {
  localStorage.removeItem('bault.railPinned');
} catch {
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

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
