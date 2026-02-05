import { Component, type ReactNode } from 'react';
import { I18nContext } from '../contexts/I18nContext';
import { logger } from '../utils/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  static contextType = I18nContext;
  declare context: React.ContextType<typeof I18nContext>;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logger.error('React error boundary caught an error', error, {
      componentStack: errorInfo.componentStack,
    });
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      const t = this.context?.t;
      const title = t ? t('errors.INTERNAL_SERVER_ERROR') : 'Something went wrong';
      const description = t
        ? `${t('app.error')}: ${t('errors.INTERNAL_SERVER_ERROR')}`
        : 'An unexpected error occurred. Please try again.';
      const retryLabel = t ? t('common.retry') : 'Try again';
      const detailsLabel = t ? t('common.details') : 'Error details';

      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <h2>{title}</h2>
            <p>{description}</p>
            {this.state.error && (
              <details>
                <summary>{detailsLabel}</summary>
                <pre>{this.state.error.message}</pre>
              </details>
            )}
            <button onClick={this.handleRetry} className="btn btn-primary">
              {retryLabel}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
