import { BrowserRouter } from 'react-router-dom';

import { NotificationProvider } from '@/context/NotificationContext';
import { useAppBootstrap } from '@/hooks/auth/useAppBootstrap';
import { AppRouter } from '@/router/AppRouter';

function AppBootstrap() {
  useAppBootstrap();

  return <AppRouter />;
}

export default function App() {
  return (
    <BrowserRouter>
      <NotificationProvider>
        <AppBootstrap />
      </NotificationProvider>
    </BrowserRouter>
  );
}
