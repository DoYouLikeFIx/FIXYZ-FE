import type { MouseEventHandler } from 'react';

import type { AuthMode } from '@/types/auth-ui';

export interface AuthFrameControllerProps {
  displayMode: AuthMode;
  feedbackMessage?: string | null;
  feedbackTone?: 'info' | 'error';
  feedbackTestId?: string;
  onLoginTabClick: MouseEventHandler<HTMLAnchorElement>;
  onRegisterTabClick: MouseEventHandler<HTMLAnchorElement>;
}
