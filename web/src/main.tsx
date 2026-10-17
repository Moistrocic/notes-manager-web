import React, { useEffect, type ReactNode } from 'react';
import ReactDOM from 'react-dom/client';
import 'katex/dist/katex.min.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { installCodeTheme } from './lib/code-theme';
import './styles.css';

declare global {
  interface Window {
    __boot?: {
      /** The interface rendered: the static boot screen can step aside. */
      markMounted: () => void;
      /** Says what went wrong on the boot screen, while it is still showing. */
      showError: (title: string, message?: string) => void;
      /** 'loading' | 'error' - what index.html is showing. */
      state: () => string | null;
    };
  }
}

// One palette, shared by the editor and the preview pane.
installCodeTheme();

const container = document.getElementById('root');
if (!container) throw new Error('Root container missing');

/**
 * Tells the boot screen that the interface is real.
 *
 * index.html shows a loading screen and gives up after twelve seconds if
 * nothing says otherwise; a commit is the only moment that can honestly say
 * "it rendered". It sits inside the boundary, so a render error still shows the
 * panel instead of a spinner that never ends.
 */
function BootSignal({ children }: { children: ReactNode }) {
  useEffect(() => {
    window.__boot?.markMounted();
  }, []);
  return <>{children}</>;
}

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary label="root">
      <BootSignal>
        <App />
      </BootSignal>
    </ErrorBoundary>
  </React.StrictMode>,
);
