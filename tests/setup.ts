import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

class SetupEventSourceMock {
  readonly url: string;

  readonly withCredentials: boolean;

  onerror: ((event: Event) => void) | null = null;

  onopen: ((event: Event) => void) | null = null;

  constructor(url: string | URL, init?: EventSourceInit) {
    this.url = String(url);
    this.withCredentials = init?.withCredentials ?? false;
  }

  addEventListener() {}

  removeEventListener() {}

  close() {}
}

vi.stubGlobal('EventSource', SetupEventSourceMock as unknown as typeof EventSource);
