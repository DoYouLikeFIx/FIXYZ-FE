import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const feRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const srcRoot = resolve(feRoot, 'src');

const REQUIRED_ROOTS = [
  'src/api',
  'src/pages',
  'src/components',
  'src/context',
  'src/hooks',
  'src/router',
  'src/store',
  'src/lib',
  'src/order',
  'src/types',
  'src/utils',
  'tests/unit',
  'tests/integration',
  'tests/collab-webhook',
  'tests/supply-chain',
  'e2e',
] as const;

const normalize = (targetPath: string) =>
  relative(feRoot, targetPath).split(sep).join('/');

const collectFiles = (dir: string): string[] => {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(entryPath);
    }
    return entry.isFile() ? [entryPath] : [];
  });
};

const scanSourceFiles = (
  matcher: (filePath: string, source: string) => boolean,
): string[] =>
  collectFiles(srcRoot)
    .filter((filePath) => /\.(ts|tsx)$/.test(filePath))
    .filter((filePath) => matcher(filePath, readFileSync(filePath, 'utf8')))
    .map(normalize)
    .sort();

describe('web structure conventions', () => {
  it('keeps the required frontend roots in place', () => {
    const missing = REQUIRED_ROOTS.filter((rootPath) => !existsSync(resolve(feRoot, rootPath)));

    expect(missing).toEqual([]);
  });

  it('keeps production source free of colocated test files', () => {
    const offendingFiles = collectFiles(srcRoot)
      .filter((filePath) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(filePath))
      .map(normalize);

    expect(offendingFiles).toEqual([]);
    expect(existsSync(resolve(srcRoot, 'test'))).toBe(false);
    expect(existsSync(resolve(feRoot, 'test'))).toBe(false);
  });

  it('owns EventSource wiring only inside NotificationContext', () => {
    const eventSourceOwners = scanSourceFiles((_, source) => /new\s+EventSource\s*\(/.test(source));

    expect(eventSourceOwners).toEqual(['src/context/NotificationContext.tsx']);
  });

  it('keeps route-level data loading off React Router loaders', () => {
    const loaderOwners = scanSourceFiles(
      (_, source) =>
        /\bcreateBrowserRouter\s*\(/.test(source)
        || /\buseLoaderData\s*\(/.test(source)
        || /\bloader\s*:/.test(source),
    );

    expect(loaderOwners).toEqual([]);
  });

  it('centralizes axios instance creation in lib/axios.ts', () => {
    const axiosOwners = scanSourceFiles((_, source) => /axios\.create\s*\(/.test(source));

    expect(axiosOwners).toEqual(['src/lib/axios.ts']);
  });

  it('keeps App.tsx as the BrowserRouter and NotificationProvider shell', () => {
    const appSource = readFileSync(resolve(srcRoot, 'App.tsx'), 'utf8');

    expect(appSource).toContain('<BrowserRouter>');
    expect(appSource).toContain('<NotificationProvider>');
    expect(appSource).toContain('<AppRouter />');
  });
});
