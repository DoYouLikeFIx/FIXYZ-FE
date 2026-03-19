import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

import { AdminRoute } from '@/router/AdminRoute';
import { ADMIN_ROUTE, DEFAULT_PROTECTED_ROUTE } from '@/router/navigation';
import { resetAuthStore, useAuthStore } from '@/store/useAuthStore';
import type { Member } from '@/types/auth';

const adminMemberFixture: Member = {
  memberUuid: 'member-admin-001',
  email: 'admin@example.com',
  name: 'Admin User',
  role: 'ROLE_ADMIN',
  totpEnrolled: true,
};

const regularMemberFixture: Member = {
  memberUuid: 'member-user-001',
  email: 'user@example.com',
  name: 'Regular User',
  role: 'ROLE_USER',
  totpEnrolled: true,
};

const adminLikeMemberFixture: Member = {
  memberUuid: 'member-admin-like-001',
  email: 'admin-like@example.com',
  name: 'Adminlike User',
  role: 'ROLE_FOOADMIN',
  totpEnrolled: true,
};

const LoginRouteProbe = () => {
  const { search } = useLocation();

  return <div data-testid="route-login">{search}</div>;
};

describe('AdminRoute', () => {
  beforeEach(() => {
    resetAuthStore();
  });

  const renderAdminLayout = () =>
    render(
      <MemoryRouter initialEntries={[ADMIN_ROUTE]}>
        <Routes>
          <Route element={<AdminRoute />}>
            <Route path={ADMIN_ROUTE} element={<div data-testid="route-admin-content" />} />
          </Route>
          <Route path={DEFAULT_PROTECTED_ROUTE} element={<div data-testid="route-default" />} />
          <Route path="/login" element={<LoginRouteProbe />} />
        </Routes>
      </MemoryRouter>,
    );

  it('allows admin members through', () => {
    useAuthStore.setState({
      member: adminMemberFixture,
      status: 'authenticated',
    });

    renderAdminLayout();

    expect(screen.getByTestId('route-admin-content')).toBeInTheDocument();
  });

  it('blocks non-admin members by routing to protected area', async () => {
    useAuthStore.setState({
      member: regularMemberFixture,
      status: 'authenticated',
    });

    renderAdminLayout();

    expect(await screen.findByTestId('route-default')).toBeInTheDocument();
  });

  it('blocks admin-like role strings when they are not exact ROLE_ADMIN', async () => {
    useAuthStore.setState({
      member: adminLikeMemberFixture,
      status: 'authenticated',
    });

    renderAdminLayout();

    expect(await screen.findByTestId('route-default')).toBeInTheDocument();
  });

  it('redirects unauthenticated users to login with return path', async () => {
    useAuthStore.setState({
      member: null,
      status: 'anonymous',
    });

    renderAdminLayout();

    expect(await screen.findByTestId('route-login')).toHaveTextContent('redirect=%2Fadmin');
  });

  it('shows checking state while auth status is not ready', () => {
    useAuthStore.setState({
      member: null,
      status: 'checking',
    });

    renderAdminLayout();

    expect(screen.getByText('관리자 권한을 확인하고 있습니다.')).toBeInTheDocument();
  });
});
