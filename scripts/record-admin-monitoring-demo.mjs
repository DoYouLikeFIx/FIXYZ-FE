import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const feRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(feRoot, '..');
const outputDir = path.join(repoRoot, 'output', 'playwright');
const tempVideoDir = path.join(outputDir, 'tmp-admin-monitoring-demo');
const outputWebmPath = path.join(outputDir, 'story-7-8-admin-monitoring-demo.webm');
const outputMp4Path = path.join(outputDir, 'story-7-8-admin-monitoring-demo.mp4');
const host = '127.0.0.1';
const port = Number(process.env.DEMO_FE_PORT ?? '4180');
const baseUrl = `http://${host}:${port}`;
const grafanaPort = Number(process.env.DEMO_GRAFANA_PORT ?? '4190');
const grafanaBaseUrl = `http://${host}:${grafanaPort}`;
const liveApiBaseUrl = (process.env.LIVE_API_BASE_URL?.trim() || 'http://127.0.0.1:8080').replace(/\/$/, '');
const defaultRegisterPassword = process.env.LIVE_REGISTER_PASSWORD ?? 'LiveAdminMonitoring1!';
const base32Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const liveChannelDbContainer = process.env.LIVE_CHANNEL_DB_CONTAINER?.trim() || 'mysql';
const liveChannelDbUser = process.env.LIVE_CHANNEL_DB_USER?.trim() || 'fix';
const liveChannelDbPassword = process.env.LIVE_CHANNEL_DB_PASSWORD?.trim() || 'fix';
const liveChannelDbName = process.env.LIVE_CHANNEL_DB_NAME?.trim() || 'channel_db';
const configuredMonitoringPanelsJson = process.env.VITE_ADMIN_MONITORING_PANELS_JSON?.trim();

const buildFallbackDemoMonitoringPanels = (mockGrafanaBaseUrl) => [
  {
    key: 'executionVolume',
    title: 'Execution volume',
    description: 'Order execution throughput panel',
    mode: 'link',
    linkUrl: `${mockGrafanaBaseUrl}/d/ops/exec-volume`,
    dashboardUid: 'ops-overview',
    panelId: 11,
    sourceMetricHint: 'http_server_requests_seconds / execution throughput',
    freshness: {
      source: 'grafana-panel',
      indicatorLabel: 'Grafana panel freshness',
      lastUpdatedLabel: 'Last updated',
      status: 'live',
      statusMessage: 'Freshness OK',
      lastUpdatedAt: '2026-03-24T09:15:00Z',
    },
    drillDown: {
      grafanaUrl: `${mockGrafanaBaseUrl}/d/ops/exec-volume?viewPanel=11`,
      adminAuditUrl: '/admin?auditEventType=ORDER_EXECUTE',
    },
  },
  {
    key: 'pendingSessions',
    title: 'Pending sessions',
    description: 'Order session recovery backlog',
    mode: 'link',
    linkUrl: `${mockGrafanaBaseUrl}/d/ops/pending-sessions`,
    dashboardUid: 'ops-overview',
    panelId: 12,
    sourceMetricHint: 'channel.order.recovery.*',
    freshness: {
      source: 'grafana-panel',
      indicatorLabel: 'Grafana panel freshness',
      lastUpdatedLabel: 'Last updated',
      status: 'stale',
      statusMessage: 'Scrape delay detected',
      lastUpdatedAt: '2026-03-24T09:00:00Z',
    },
    drillDown: {
      grafanaUrl: `${mockGrafanaBaseUrl}/d/ops/pending-sessions?viewPanel=12`,
      adminAuditUrl: '/admin?auditEventType=ORDER_SESSION_CREATE',
    },
  },
  {
    key: 'marketDataIngest',
    title: 'Market data ingest',
    description: 'Market data pipeline health',
    mode: 'link',
    linkUrl: `${mockGrafanaBaseUrl}/d/ops/market-data`,
    dashboardUid: 'ops-overview',
    panelId: 13,
    sourceMetricHint: 'fep.marketdata.*',
    freshness: {
      source: 'grafana-companion-panel',
      indicatorLabel: 'Companion freshness panel',
      lastUpdatedLabel: 'Last updated',
      companionPanelUrl: `${mockGrafanaBaseUrl}/d/ops/market-data?viewPanel=31`,
      status: 'unavailable',
      statusMessage: 'Check ingest freshness',
      lastUpdatedAt: '2026-03-24T08:52:00Z',
    },
    drillDown: {
      grafanaUrl: `${mockGrafanaBaseUrl}/d/ops/market-data?viewPanel=13`,
    },
  },
];

const parseMonitoringPanels = () => {
  if (!configuredMonitoringPanelsJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(configuredMonitoringPanelsJson);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error('Monitoring descriptor JSON must be a non-empty array.');
    }

    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid VITE_ADMIN_MONITORING_PANELS_JSON for demo recording: ${message}`);
  }
};

const renderGrafanaPage = (pathname, searchParams) => {
  const dashboardMeta = (() => {
    switch (pathname) {
      case '/d/ops/exec-volume':
        return {
          eyebrow: 'Operations / Throughput',
          title: 'Execution Volume Dashboard',
          statLabel: 'Orders / min',
          statValue: '1,284',
          statTone: 'live',
          detail: 'Latency p95 184ms · Success 99.94%',
          series: [34, 42, 48, 51, 60, 72, 78, 84, 76, 88, 97, 106],
          chips: ['Prometheus', 'Live', 'viewPanel=11'],
        };
      case '/d/ops/pending-sessions':
        return {
          eyebrow: 'Operations / Recovery',
          title: 'Pending Sessions Dashboard',
          statLabel: 'Recovery backlog',
          statValue: '7',
          statTone: 'stale',
          detail: 'Manual queue rising · scrape delay detected',
          series: [2, 3, 3, 4, 4, 5, 6, 7, 7, 8, 7, 7],
          chips: ['Prometheus', 'Stale', 'viewPanel=12'],
        };
      default:
        return {
          eyebrow: 'Operations / Market Data',
          title: 'Market Data Ingest Dashboard',
          statLabel: 'Ingest freshness',
          statValue: 'Unavailable',
          statTone: 'unavailable',
          detail: 'Companion freshness panel required',
          series: [65, 64, 63, 61, 60, 58, 55, 52, 50, 48, 46, 44],
          chips: ['Grafana', 'Companion', searchParams.get('viewPanel') ?? 'panel'],
        };
    }
  })();
  const statusColor = dashboardMeta.statTone === 'live'
    ? 'var(--live)'
    : dashboardMeta.statTone === 'stale'
      ? 'var(--stale)'
      : 'var(--unavailable)';

  const maxValue = Math.max(...dashboardMeta.series);
  const points = dashboardMeta.series
    .map((value, index) => {
      const x = 40 + index * 62;
      const y = 250 - ((value / maxValue) * 180);
      return `${x},${y}`;
    })
    .join(' ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${dashboardMeta.title}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0b1020;
        --panel: #131a2e;
        --panel-strong: #1a2340;
        --border: rgba(255,255,255,0.08);
        --text: #f2f5ff;
        --muted: #98a3c7;
        --brand: #ff8f3d;
        --live: #57d28c;
        --stale: #ffb648;
        --unavailable: #f06f9b;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at top left, rgba(255,143,61,0.18), transparent 28%),
          linear-gradient(180deg, #0a0f1d 0%, #10182d 100%);
        color: var(--text);
      }
      .shell { min-height: 100vh; padding: 28px; }
      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 24px;
      }
      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--brand);
        margin: 0 0 8px;
      }
      h1 {
        margin: 0;
        font-size: 34px;
        line-height: 1.1;
      }
      .subtitle {
        color: var(--muted);
        margin: 10px 0 0;
      }
      .range {
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.04);
        border-radius: 999px;
        padding: 10px 16px;
        color: var(--muted);
        font-size: 14px;
      }
      .grid {
        display: grid;
        grid-template-columns: 320px 1fr;
        gap: 20px;
      }
      .card {
        background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02));
        border: 1px solid var(--border);
        border-radius: 22px;
        padding: 22px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.35);
      }
      .stat-label {
        color: var(--muted);
        font-size: 13px;
        margin-bottom: 8px;
      }
      .stat-value {
        font-size: 40px;
        font-weight: 700;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-top: 14px;
        padding: 7px 12px;
        border-radius: 999px;
        font-size: 13px;
        background: rgba(255,255,255,0.06);
      }
      .pill::before {
        content: "";
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: ${statusColor};
      }
      .detail {
        margin-top: 14px;
        color: var(--muted);
        line-height: 1.5;
      }
      .chips {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        margin-top: 18px;
      }
      .chip {
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(255,255,255,0.05);
        color: var(--muted);
        font-size: 12px;
      }
      .chart {
        min-height: 420px;
      }
      .chart svg {
        width: 100%;
        height: 100%;
      }
      .chart-title {
        margin: 0 0 14px;
        font-size: 18px;
      }
      .chart-caption {
        color: var(--muted);
        margin: 0 0 16px;
      }
      .footer {
        margin-top: 18px;
        color: var(--muted);
        font-size: 13px;
      }
    </style>
  </head>
  <body>
    <main class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">${dashboardMeta.eyebrow}</p>
          <h1>${dashboardMeta.title}</h1>
          <p class="subtitle">Demo-safe Grafana stand-in for monitoring walkthrough capture</p>
        </div>
        <div class="range">Last 15m · Auto-refresh 10s</div>
      </header>

      <section class="grid">
        <article class="card">
          <div class="stat-label">${dashboardMeta.statLabel}</div>
          <div class="stat-value">${dashboardMeta.statValue}</div>
          <div class="pill">${dashboardMeta.statTone.toUpperCase()}</div>
          <p class="detail">${dashboardMeta.detail}</p>
          <div class="chips">
            ${dashboardMeta.chips.map((chip) => `<span class="chip">${chip}</span>`).join('')}
          </div>
        </article>

        <article class="card chart">
          <h2 class="chart-title">Panel trend</h2>
          <p class="chart-caption">Synthetic line for demo capture. Structure mirrors Grafana panel review.</p>
          <svg viewBox="0 0 760 320" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="20" y="20" width="720" height="260" rx="20" fill="rgba(255,255,255,0.02)" stroke="rgba(255,255,255,0.07)"/>
            <path d="M40 250 L710 250" stroke="rgba(255,255,255,0.10)" />
            <path d="M40 190 L710 190" stroke="rgba(255,255,255,0.08)" />
            <path d="M40 130 L710 130" stroke="rgba(255,255,255,0.08)" />
            <path d="M40 70 L710 70" stroke="rgba(255,255,255,0.08)" />
            <polyline
              points="${points}"
              stroke="#ff8f3d"
              stroke-width="6"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <div class="footer">Path: ${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}</div>
        </article>
      </section>
    </main>
  </body>
</html>`;
};

const pause = async (milliseconds = 1_200) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const createLiveIdentity = () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    email: `admin_monitoring_demo_${suffix}@example.com`,
    name: `Admin Monitoring Demo ${suffix}`,
    password: defaultRegisterPassword,
  };
};

const escapeSqlString = (value) =>
  value.replaceAll('\\', '\\\\').replaceAll("'", "''");

const decodeBase32 = (value) => {
  const normalized = value.trim().replace(/[\s=-]/g, '').toUpperCase();
  let buffer = 0;
  let bitsLeft = 0;
  const output = [];

  for (const character of normalized) {
    const index = base32Alphabet.indexOf(character);

    if (index < 0) {
      throw new Error(`Unsupported base32 character: ${character}`);
    }

    buffer = (buffer << 5) | index;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      output.push((buffer >> (bitsLeft - 8)) & 0xff);
      bitsLeft -= 8;
    }
  }

  return Buffer.from(output);
};

const generateTotp = (manualEntryKey, now = Date.now()) => {
  const counter = Math.floor(now / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', decodeBase32(manualEntryKey))
    .update(counterBuffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);

  return String(binary % 1_000_000).padStart(6, '0');
};

const millisUntilNextTotpWindow = (now = Date.now()) => 30_000 - (now % 30_000);

const generateStableTotp = async (manualEntryKey, minRemainingMs = 8_000) => {
  if (millisUntilNextTotpWindow() < minRemainingMs) {
    await pause(millisUntilNextTotpWindow() + 1_500);
  }

  return generateTotp(manualEntryKey);
};

const waitForNextTotp = async (manualEntryKey, previousCode) => {
  const startedAt = Date.now();
  let nextCode = generateTotp(manualEntryKey);

  while (nextCode === previousCode || millisUntilNextTotpWindow() < 10_000) {
    if (Date.now() - startedAt > 45_000) {
      throw new Error('Timed out waiting for the next TOTP window.');
    }

    await pause(250);
    nextCode = generateTotp(manualEntryKey);
  }

  return nextCode;
};

const waitForUrl = async (page, predicate, timeout = 20_000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeout) {
    const url = new URL(page.url());

    if (predicate(url)) {
      return url;
    }

    await pause(250);
  }

  throw new Error(`Timed out waiting for URL predicate after ${timeout}ms.`);
};

const typeSlow = async (locator, value) => {
  await locator.click();
  await locator.pressSequentially(value, {
    delay: 45,
  });
};

const waitForServer = async (url, timeout = 60_000) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeout) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
      });

      if (response.status < 500) {
        return;
      }
    } catch {
      // Retry until timeout.
    }

    await pause(500);
  }

  throw new Error(`Timed out waiting for ${url}`);
};

const assertLiveAuthHealthy = async () => {
  const response = await fetch(`${liveApiBaseUrl}/api/v1/auth/csrf`);

  if (!response.ok) {
    throw new Error(`Live backend auth bootstrap is unhealthy: /api/v1/auth/csrf -> ${response.status}`);
  }
};

const startMockGrafanaServer = async () => {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', grafanaBaseUrl);
    const pathname = requestUrl.pathname;

    if (!pathname.startsWith('/d/') && !pathname.startsWith('/d-solo/')) {
      response.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end('Not Found');
      return;
    }

    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(renderGrafanaPage(pathname, requestUrl.searchParams));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(grafanaPort, host, () => {
      server.off('error', reject);
      resolve();
    });
  });

  return server;
};

const stopHttpServer = async (server) => {
  if (!server?.listening) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const startDemoViteServer = async (monitoringPanels) => {
  const serverProcess = spawn(
    'pnpm',
    ['exec', 'vite', '--host', host, '--port', String(port), '--strictPort'],
    {
      cwd: feRoot,
      env: {
        ...process.env,
        LIVE_API_BASE_URL: liveApiBaseUrl,
        VITE_DEV_PROXY_TARGET: liveApiBaseUrl,
        VITE_API_BASE_URL: '',
        VITE_ADMIN_MONITORING_PANELS_JSON: JSON.stringify(monitoringPanels),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  serverProcess.stdout.on('data', (chunk) => {
    process.stdout.write(`[vite] ${chunk}`);
  });
  serverProcess.stderr.on('data', (chunk) => {
    process.stderr.write(`[vite] ${chunk}`);
  });

  const exitPromise = new Promise((resolve) => {
    serverProcess.once('exit', (code, signal) => {
      resolve({
        code,
        signal,
      });
    });
  });

  await waitForServer(`${baseUrl}/login`);

  return {
    serverProcess,
    exitPromise,
  };
};

const stopProcess = async (childProcess) => {
  if (!childProcess || childProcess.killed) {
    return;
  }

  childProcess.kill('SIGTERM');
  await pause(1_000);

  if (!childProcess.killed) {
    childProcess.kill('SIGKILL');
  }
};

const promoteMemberToAdmin = (email) => {
  const sql = [
    `UPDATE members SET role='ROLE_ADMIN' WHERE email='${escapeSqlString(email)}';`,
    `SELECT role FROM members WHERE email='${escapeSqlString(email)}';`,
  ].join(' ');

  const result = spawnSync(
    'docker',
    [
      'exec',
      liveChannelDbContainer,
      'mysql',
      `-u${liveChannelDbUser}`,
      `-p${liveChannelDbPassword}`,
      '-N',
      '-B',
      '-D',
      liveChannelDbName,
      '-e',
      sql,
    ],
    {
      encoding: 'utf8',
    },
  );

  if (result.status !== 0 || !result.stdout.includes('ROLE_ADMIN')) {
    throw new Error(
      `Failed to promote demo member to ROLE_ADMIN: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
};

const cleanupProvisionedIdentity = (email) => {
  const escapedEmail = escapeSqlString(email);
  const sql = [
    `SET @member_id := (SELECT id FROM members WHERE email='${escapedEmail}' LIMIT 1);`,
    'DELETE FROM manual_recovery_queue_entries',
    ' WHERE order_session_id IN (SELECT order_session_id FROM order_sessions WHERE member_id = @member_id);',
    'DELETE FROM audit_logs',
    ' WHERE member_id = @member_id',
    '    OR order_session_id IN (SELECT id FROM order_sessions WHERE member_id = @member_id);',
    'DELETE FROM security_events',
    ' WHERE member_id = @member_id',
    '    OR admin_member_id = @member_id',
    '    OR order_session_id IN (SELECT id FROM order_sessions WHERE member_id = @member_id);',
    'DELETE FROM notifications WHERE member_id = @member_id;',
    'DELETE FROM otp_verifications WHERE member_id = @member_id;',
    'DELETE FROM password_reset_tokens WHERE member_id = @member_id;',
    'DELETE FROM order_sessions WHERE member_id = @member_id;',
    'DELETE FROM members WHERE id = @member_id;',
    `SELECT COUNT(*) FROM members WHERE email='${escapedEmail}';`,
  ].join(' ');

  const result = spawnSync(
    'docker',
    [
      'exec',
      liveChannelDbContainer,
      'mysql',
      `-u${liveChannelDbUser}`,
      `-p${liveChannelDbPassword}`,
      '-N',
      '-B',
      '-D',
      liveChannelDbName,
      '-e',
      sql,
    ],
    {
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Failed to clean up demo member: ${result.stderr || result.stdout || 'unknown error'}`,
    );
  }
};

const convertWebmToMp4 = () => {
  if (!existsSync(outputWebmPath)) {
    throw new Error(`Missing recorded webm at ${outputWebmPath}`);
  }

  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      outputWebmPath,
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outputMp4Path,
    ],
    {
      encoding: 'utf8',
    },
  );

  if (result.status !== 0) {
    throw new Error(`Failed to convert demo video to mp4: ${result.stderr || result.stdout || 'unknown error'}`);
  }
};

const saveRecordedVideo = async (page) => {
  const video = page.video();

  if (!video) {
    throw new Error('Playwright did not attach a video recorder to the demo page.');
  }

  await page.close();
  await video.saveAs(outputWebmPath);
};

const waitForOrderAuthorizationStep = async (page, timeout = 30_000) => {
  const startedAt = Date.now();
  const orderSessionOtpInput = page.getByTestId('order-session-otp-input');
  const executeButton = page.getByTestId('order-session-execute');

  while (Date.now() - startedAt <= timeout) {
    if (await orderSessionOtpInput.isVisible().catch(() => false)) {
      return 'otp';
    }

    if (await executeButton.isVisible().catch(() => false)) {
      return 'execute';
    }

    await pause(250);
  }

  throw new Error('Expected the order flow to show an OTP challenge or execute button within 30s.');
};

const createExecutedOrderForIdentity = async (page, identity) => {
  await page.goto('/orders');
  await page.getByTestId('order-session-create').waitFor({
    state: 'visible',
  });
  await pause(1_000);

  const createOrderSessionResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/orders/sessions')
      && !response.url().includes('/execute')
      && response.request().method() === 'POST',
  );
  await page.getByTestId('order-session-create').click();
  const createOrderSessionResponse = await createOrderSessionResponsePromise;

  if (!createOrderSessionResponse.ok()) {
    throw new Error('Failed to create live order session for the demo flow.');
  }

  let nextIdentity = identity;
  const authorizationStep = await waitForOrderAuthorizationStep(page);

  if (authorizationStep === 'otp') {
    const orderOtpCode = await waitForNextTotp(identity.manualEntryKey, identity.lastUsedTotp);
    await typeSlow(page.getByTestId('order-session-otp-input'), orderOtpCode);
    nextIdentity = {
      ...identity,
      lastUsedTotp: orderOtpCode,
    };
    await pause(800);
  }

  await page.getByTestId('order-session-execute').waitFor({
    state: 'visible',
  });
  await pause(800);

  const executeOrderSessionResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/orders/sessions/')
      && response.url().includes('/execute')
      && response.request().method() === 'POST',
  );
  await page.getByTestId('order-session-execute').click();
  const executeOrderSessionResponse = await executeOrderSessionResponsePromise;

  if (!executeOrderSessionResponse.ok()) {
    throw new Error('Failed to execute the live order session for the demo flow.');
  }

  await page.getByTestId('order-session-summary').waitFor({
    state: 'visible',
  });
  await pause(2_000);

  return nextIdentity;
};

const runDemo = async () => {
  await mkdir(outputDir, {
    recursive: true,
  });
  await rm(tempVideoDir, {
    recursive: true,
    force: true,
  });
  await mkdir(tempVideoDir, {
    recursive: true,
  });
  await rm(outputWebmPath, {
    force: true,
  });
  await rm(outputMp4Path, {
    force: true,
  });

  await assertLiveAuthHealthy();
  const mockGrafanaServer = configuredMonitoringPanelsJson
    ? null
    : await startMockGrafanaServer();
  const monitoringPanels = parseMonitoringPanels() ?? buildFallbackDemoMonitoringPanels(grafanaBaseUrl);
  const { serverProcess, exitPromise } = await startDemoViteServer(monitoringPanels);

  const browser = await chromium.launch({
    headless: true,
    slowMo: 120,
  });

  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: {
      width: 1366,
      height: 900,
    },
    recordVideo: {
      dir: tempVideoDir,
      size: {
        width: 1366,
        height: 900,
      },
    },
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30_000);

  let provisionedIdentity = null;

  try {
    await page.goto('/admin?auditEventType=ORDER_EXECUTE');
    await waitForUrl(page, (url) => url.pathname === '/login');
    await pause(2_000);

    provisionedIdentity = createLiveIdentity();

    await page.goto('/register?redirect=%2Fadmin');
    await pause(1_000);
    await typeSlow(page.getByTestId('register-email'), provisionedIdentity.email);
    await typeSlow(page.getByTestId('register-name'), provisionedIdentity.name);
    await typeSlow(page.getByTestId('register-password'), provisionedIdentity.password);
    await typeSlow(page.getByTestId('register-password-confirm'), provisionedIdentity.password);
    await pause(500);
    await page.getByTestId('register-submit').click();

    await page.getByTestId('totp-enroll-manual-key').waitFor({
      state: 'visible',
    });
    await pause(1_500);
    const manualEntryKey = ((await page.getByTestId('totp-enroll-manual-key').textContent()) ?? '').trim();

    if (!manualEntryKey) {
      throw new Error('Failed to read the TOTP manual entry key during demo registration.');
    }

    const enrollmentCode = await generateStableTotp(manualEntryKey);
    await typeSlow(page.getByTestId('totp-enroll-code'), enrollmentCode);
    await pause(500);
    await page.getByTestId('totp-enroll-submit').click();

    await waitForUrl(page, (url) => url.pathname === '/portfolio');
    await pause(2_000);

    provisionedIdentity = {
      ...provisionedIdentity,
      manualEntryKey,
      lastUsedTotp: enrollmentCode,
    };

    await page.goto('/admin');
    await waitForUrl(page, (url) => url.pathname === '/portfolio');
    await pause(2_000);

    provisionedIdentity = await createExecutedOrderForIdentity(page, provisionedIdentity);

    promoteMemberToAdmin(provisionedIdentity.email);
    await page.context().clearCookies();
    await page.goto('/login?redirect=%2Fadmin');
    await pause(1_000);

    await typeSlow(page.getByTestId('login-email'), provisionedIdentity.email);
    await typeSlow(page.getByTestId('login-password'), provisionedIdentity.password);
    await pause(500);
    await page.getByTestId('login-submit').click();

    await page.getByTestId('login-mfa-input').waitFor({
      state: 'visible',
    });
    await pause(1_000);

    const loginCode = await waitForNextTotp(
      provisionedIdentity.manualEntryKey,
      provisionedIdentity.lastUsedTotp,
    );
    provisionedIdentity = {
      ...provisionedIdentity,
      lastUsedTotp: loginCode,
    };

    await typeSlow(page.getByTestId('login-mfa-input'), loginCode);
    await pause(500);
    await page.getByTestId('login-mfa-submit').click();

    await waitForUrl(page, (url) => url.pathname === '/admin');
    await page.getByTestId('topbar-admin-link').waitFor({
      state: 'visible',
    });
    await pause(2_000);

    await page.getByTestId('admin-monitoring-card-executionVolume').scrollIntoViewIfNeeded();
    await pause(1_500);
    await page.getByTestId('admin-monitoring-card-executionVolume').hover();
    await pause(1_000);
    const openExecutionVolume = page.getByTestId('admin-monitoring-open-executionVolume');
    const executionDashboardUrl = await openExecutionVolume.getAttribute('href');

    if (!executionDashboardUrl) {
      throw new Error('Execution volume dashboard URL is missing in the demo descriptor.');
    }

    await page.evaluate(() => {
      const button = document.querySelector('[data-testid="admin-monitoring-open-executionVolume"]');

      if (button instanceof HTMLAnchorElement) {
        button.target = '_self';
      }
    });
    await pause(600);
    await openExecutionVolume.click();
    await waitForUrl(page, (url) => url.href === executionDashboardUrl || url.pathname.startsWith('/d/ops/exec-volume'));
    await pause(2_200);
    await page.mouse.wheel(0, 360);
    await pause(2_000);

    await page.goto(`${baseUrl}/admin`);
    await page.getByTestId('admin-console-title').waitFor({
      state: 'visible',
    });
    await page.getByTestId('admin-monitoring-card-executionVolume').scrollIntoViewIfNeeded();
    await pause(1_200);

    const auditResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes('/api/v1/admin/audit-logs')
        && response.request().method() === 'GET'
        && new URL(response.url()).searchParams.get('eventType') === 'ORDER_EXECUTE',
    );
    await page.getByTestId('admin-monitoring-audit-executionVolume').click();
    const auditResponse = await auditResponsePromise;

    if (!auditResponse.ok()) {
      throw new Error('Admin audit drill-down did not return a successful live response during video capture.');
    }

    await page.locator('[data-testid^="admin-audit-row-"]').filter({
      hasText: 'ORDER_EXECUTE',
    }).first().waitFor({
      state: 'visible',
    });
    await pause(4_000);

    await saveRecordedVideo(page);
    await context.close();
    await browser.close();

    convertWebmToMp4();

    const tempFiles = await readdir(tempVideoDir).catch(() => []);
    if (tempFiles.length > 0) {
      await rm(tempVideoDir, {
        recursive: true,
        force: true,
      });
    }

    console.log(`Demo video saved: ${outputWebmPath}`);
    console.log(`Demo video converted: ${outputMp4Path}`);
  } catch (error) {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    throw error;
  } finally {
    if (provisionedIdentity?.email) {
      cleanupProvisionedIdentity(provisionedIdentity.email);
    }

    await stopHttpServer(mockGrafanaServer).catch(() => {});
    await stopProcess(serverProcess);
    const exitResult = await Promise.race([
      exitPromise,
      pause(2_000).then(() => null),
    ]);

    if (exitResult && exitResult.code && exitResult.code !== 0) {
      console.warn(`Vite demo server exited with code ${exitResult.code}`);
    }
  }
};

runDemo().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
