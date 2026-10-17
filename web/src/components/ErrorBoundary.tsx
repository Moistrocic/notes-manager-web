import { Component, type ErrorInfo, type ReactNode } from 'react';

/** What the boundary draws when a child threw. */
type Fallback = ReactNode | ((error: Error, reset: () => void) => ReactNode);

export interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Drawn instead of `children`. A function receives the error and a reset, for
   * boundaries that want to offer a retry. Without one, the full-page panel is
   * used - the last thing between a render error and a blank screen.
   */
  fallback?: Fallback;
  /** Named in the console, so a failure can be located at a glance. */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * The last line before a blank page.
 *
 * A render error used to take the whole tree down and leave the window's
 * background colour - nothing to read, nothing to click, and no clue whether
 * the network, a stale build or a bug did it. This catches it, keeps the error
 * in the console for whoever is debugging, and puts a way forward on the
 * screen. The styles are inline and the colours fall back to the theme's own,
 * because the panel must not depend on the stylesheet that may be the problem.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The panel is the visible report; the component stack is for the console.
    console.error(`[error-boundary]${this.props.label ? ` ${this.props.label}` : ''}`, error, info.componentStack);
  }

  /** Clears the caught error. Only rendered fallbacks can call it. */
  reset = (): void => this.setState({ error: null });

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fallback } = this.props;
    if (typeof fallback === 'function') return fallback(error, this.reset);
    if (fallback !== undefined) return fallback;
    return <CrashPanel error={error} />;
  }
}

/** A cache that is safe to throw away: nothing here is the user's own writing. */
async function clearSiteCache(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* no cache storage, or it refused: the reload is the part that matters */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* private mode */
  }
  window.location.reload();
}

function CrashPanel({ error }: { error: Error }) {
  const detail = error.stack || `${error.name}: ${error.message}`;
  return (
    <div
      data-testid="error-boundary"
      role="alert"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        boxSizing: 'border-box',
        background: 'var(--surface, #060a16)',
        color: 'var(--text, #e9edff)',
        fontFamily:
          "'Inter var', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <div
        style={{
          width: 'min(560px, 100%)',
          boxSizing: 'border-box',
          padding: '36px 32px',
          border: '1px solid var(--line, rgba(255, 255, 255, 0.08))',
          borderRadius: 20,
          background: 'var(--panel-solid, #0e1426)',
          boxShadow: 'var(--shadow-strong, 0 40px 90px -40px rgba(0, 0, 0, 0.95))',
        }}
      >
        <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '0.01em' }}>页面出错了</div>
        <p
          style={{
            margin: '10px 0 0',
            fontSize: 13,
            lineHeight: 1.7,
            color: 'var(--muted, #96a2c8)',
          }}
        >
          界面在渲染时中断了。刷新页面通常能恢复；如果反复出现，请把下面的信息复制给维护者。
        </p>
        <pre
          data-testid="error-boundary-message"
          style={{
            margin: '16px 0 0',
            padding: '12px 14px',
            maxHeight: 220,
            overflow: 'auto',
            boxSizing: 'border-box',
            border: '1px solid var(--line, rgba(255, 255, 255, 0.08))',
            borderRadius: 12,
            background: 'var(--accent-soft, rgba(139, 108, 255, 0.16))',
            color: 'var(--muted, #96a2c8)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 11.5,
            lineHeight: 1.6,
            textAlign: 'left',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            userSelect: 'text',
          }}
        >
          {detail}
        </pre>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 18 }}>
          <button
            type="button"
            data-testid="error-reload"
            onClick={() => window.location.reload()}
            style={{
              padding: '9px 20px',
              border: '1px solid var(--accent, #8b6cff)',
              borderRadius: 999,
              background: 'var(--accent, #8b6cff)',
              color: '#0b1020',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            重新加载
          </button>
          <button
            type="button"
            data-testid="error-clear-cache"
            title="只清掉缓存的资源，不会动笔记和偏好设置"
            onClick={() => void clearSiteCache()}
            style={{
              padding: '9px 20px',
              border: '1px solid var(--line, rgba(255, 255, 255, 0.08))',
              borderRadius: 999,
              background: 'transparent',
              color: 'var(--muted, #96a2c8)',
              fontSize: 12.5,
              cursor: 'pointer',
            }}
          >
            清除缓存并重载
          </button>
        </div>
      </div>
    </div>
  );
}
