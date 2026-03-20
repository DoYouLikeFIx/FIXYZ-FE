import {
  Component,
  type ErrorInfo,
  type ReactNode,
} from 'react';

import { getApiErrorDiagnosticLog } from '@/lib/axios';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return {
      hasError: true,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(
      'Unhandled React error',
      getApiErrorDiagnosticLog(error) ?? error,
      errorInfo,
    );
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="route-status-shell" role="alert">
          <div className="route-status-card">
            <p className="route-status-kicker">Application recovery</p>
            <h1>예상치 못한 오류가 발생했습니다.</h1>
            <p>
              페이지를 새로고침한 뒤 다시 시도해 주세요. 문제가 계속되면 잠시 후
              다시 접속해 주세요.
            </p>
            <button
              type="button"
              onClick={() => {
                window.location.reload();
              }}
            >
              새로고침
            </button>
          </div>
        </main>
      );
    }

    return this.props.children;
  }
}
