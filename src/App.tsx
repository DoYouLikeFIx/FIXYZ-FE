import { BrowserRouter } from 'react-router-dom';

import { useAppBootstrap } from '@/hooks/auth/useAppBootstrap';
import { AppRouter } from '@/router/AppRouter';

function AppBootstrap() {
  useAppBootstrap();

  return <AppRouter />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppBootstrap />
    </BrowserRouter>
  );
}
