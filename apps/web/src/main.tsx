import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { I18nProvider } from './shared/i18n';
import { ThemeProvider } from './shared/theme';
import { AppErrorBoundary } from './shared/ui/AppErrorBoundary';
import { startErrorReporting } from './shared/errorReporting';
import { adoptPayPalReturn } from './shared/paypalCheckout';
import './index.css';
import './theme.css';
import './slab.css';
import './components.css';
import './buttons.css';
import './landing.css';
import './app.css';
import './gallery.css';
import './screens.css';
import './motion.css';

// Keys the app no longer reads: the rail is never pinned, and the product has one language.
try {
  localStorage.removeItem('bault.railPinned');
  localStorage.removeItem('bault.locale');
} catch {
}

void startErrorReporting();

adoptPayPalReturn();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <ThemeProvider>
        <I18nProvider>
          <App />
        </I18nProvider>
      </ThemeProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
