import type { MouseEventHandler, ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { SiteFooter } from '@/components/layout/SiteFooter';
import type { AuthMode } from '@/types/auth-ui';

interface AuthFrameProps {
  mode: AuthMode;
  displayMode: AuthMode;
  title: ReactNode;
  feedbackMessage?: string | null;
  feedbackTone?: 'info' | 'error';
  feedbackTestId?: string;
  onLoginTabClick: MouseEventHandler<HTMLAnchorElement>;
  onRegisterTabClick: MouseEventHandler<HTMLAnchorElement>;
  children: ReactNode;
}

const navigationItems = [
  '거래소',
  '자산',
  '입출금',
  '시장동향',
  '혜택·서비스',
  '고객지원',
];

export function AuthFrame({
  mode,
  displayMode,
  title,
  feedbackMessage,
  feedbackTone = 'info',
  feedbackTestId,
  onLoginTabClick,
  onRegisterTabClick,
  children,
}: AuthFrameProps) {
  return (
    <main className="auth-shell">
      <div className="auth-site">
        <header className="auth-header">
          <Link className="brand" to="/login">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-text">FIX Platform</span>
          </Link>

          <nav className="site-nav" aria-label="서비스 안내">
            {navigationItems.map((item) => (
              <span key={item} className="site-nav__item">
                {item}
              </span>
            ))}
          </nav>

          <div className="site-actions">
            <Link className="site-action-link" to="/login">
              로그인
            </Link>
            <Link className="site-action-pill" to="/register">
              회원가입
            </Link>
          </div>
        </header>

        <section className={`auth-stage auth-stage--${mode}`}>
          <div className="auth-glow" aria-hidden="true" />

          <div className={`auth-card-shell auth-card-shell--${mode}`}>
            <section className={`auth-card auth-card--${mode}`}>
              <h1 className="auth-title">{title}</h1>
              <div
                className={`auth-tabs auth-tabs--${displayMode}`}
                role="tablist"
                aria-label="인증 탭"
              >
                <Link
                  className={`auth-tab ${displayMode === 'login' ? 'auth-tab--active' : ''}`}
                  to="/login"
                  aria-current={mode === 'login' ? 'page' : undefined}
                  onClick={onLoginTabClick}
                >
                  로그인
                </Link>
                <Link
                  className={`auth-tab ${displayMode === 'register' ? 'auth-tab--active' : ''}`}
                  to="/register"
                  aria-current={mode === 'register' ? 'page' : undefined}
                  onClick={onRegisterTabClick}
                >
                  회원가입
                </Link>
              </div>

              {feedbackMessage && (
                <div
                  className={`feedback feedback--${feedbackTone}`}
                  data-testid={feedbackTestId}
                  role="alert"
                >
                  {feedbackMessage}
                </div>
              )}

              {children}
            </section>
          </div>
        </section>

        <SiteFooter variant="auth" />
      </div>
    </main>
  );
}
