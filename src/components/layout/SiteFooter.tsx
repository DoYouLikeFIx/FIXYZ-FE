interface SiteFooterProps {
  variant?: 'auth' | 'protected';
}

const footerLinks = ['회사소개', '이용약관', '개인정보 처리방침'];

export function SiteFooter({
  variant = 'auth',
}: SiteFooterProps) {
  return (
    <footer className={`site-footer site-footer--${variant}`}>
      <section className="site-footer__content">
        <section className="site-footer__brandline">
          <div className="footer-brand">
            <span className="footer-brand__mark" aria-hidden="true" />
            <span>FIX Platform</span>
          </div>
          <p>간편한 모의 투자와 안전한 인증 흐름을 위한 데모 플랫폼</p>
        </section>

        <nav className="site-footer__links" aria-label="푸터 링크">
          {footerLinks.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </nav>

        <section className="site-footer__support">
          <span>고객센터 1661-0000</span>
          <span>partnership@fixplatform.com</span>
        </section>
      </section>

      <div className="site-footer__copyright">
        Copyright © FIX Platform. All rights reserved.
      </div>
    </footer>
  );
}
