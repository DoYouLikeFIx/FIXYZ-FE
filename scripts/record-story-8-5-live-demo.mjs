import { createHmac, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const artifactDir = resolve(projectRoot, 'output/playwright/story-8-5-live-demo');
const vitePort = process.env.FE_PORT ?? '4174';
const proxyPort = process.env.FE_PROXY_PORT ?? '4175';
const viteBaseUrl = process.env.FE_VITE_BASE_URL ?? `http://127.0.0.1:${vitePort}`;
const baseUrl = process.env.FE_BASE_URL ?? `http://127.0.0.1:${proxyPort}`;
const liveApiBaseUrl = process.env.LIVE_API_BASE_URL ?? 'http://127.0.0.1:8080';
const vaultHealthUrl = process.env.VAULT_HEALTH_URL ?? 'http://127.0.0.1:8200/v1/sys/health';
const vaultContainer = process.env.VAULT_CONTAINER ?? 'vault';
const redisContainer = process.env.REDIS_CONTAINER ?? 'redis';
const mysqlContainer = process.env.MYSQL_CONTAINER ?? 'mysql';
const channelServiceContainer = process.env.CHANNEL_SERVICE_CONTAINER ?? 'channel-service';
const DEFAULT_REGISTER_PASSWORD = process.env.LIVE_REGISTER_PASSWORD ?? 'LiveStory85!';
const DEFAULT_EXISTING_EMAIL = process.env.LIVE_EXISTING_EMAIL ?? 'story85_1773926809929847@example.com';
const USE_EXISTING_IDENTITY = process.env.LIVE_BOOTSTRAP_IDENTITY !== 'true';
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const videoBasename = 'story-8-5-live-demo';

const logStage = (message) => {
  console.log(`[story85] ${message}`);
};

const wait = (milliseconds) => new Promise((resolveWait) => {
  setTimeout(resolveWait, milliseconds);
});

const ensureDirectory = (path) => {
  mkdirSync(path, { recursive: true });
};

const firstHeaderValue = (value) =>
  value
    ?.split(',')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

const createLiveIdentity = () => {
  if (USE_EXISTING_IDENTITY) {
    return {
      email: DEFAULT_EXISTING_EMAIL,
      name: 'Story 8.5 Demo',
      password: DEFAULT_REGISTER_PASSWORD,
    };
  }

  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

  return {
    email: `story85_${suffix}@example.com`,
    name: `Story 85 ${suffix}`,
    password: DEFAULT_REGISTER_PASSWORD,
  };
};

const decodeBase32 = (value) => {
  const normalized = value.trim().replace(/[\s=-]/g, '').toUpperCase();
  let buffer = 0;
  let bitsLeft = 0;
  const output = [];

  for (const character of normalized) {
    const index = BASE32_ALPHABET.indexOf(character);

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

const waitForNextTotp = async (manualEntryKey, previousCode) => {
  const startedAt = Date.now();
  let nextCode = generateTotp(manualEntryKey);

  while (nextCode === previousCode || millisUntilNextTotpWindow() < 10_000) {
    if (Date.now() - startedAt > 45_000) {
      throw new Error('Timed out waiting for the next TOTP window.');
    }

    await wait(250);
    nextCode = generateTotp(manualEntryKey);
  }

  return nextCode;
};

const waitForHttpOk = async (url, options = {}) => {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const intervalMs = options.intervalMs ?? 500;
  const deadline = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, options.fetchOptions);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected ${response.status} from ${url}`);
    } catch (error) {
      lastError = error;
    }

    await wait(intervalMs);
  }

  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
};

const waitForContainerRunningState = async (containerName, expectedRunning, timeoutMs = 15_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastState = 'unknown';

  while (Date.now() < deadline) {
    const result = spawnSync(
      'docker',
      ['inspect', '-f', '{{.State.Running}}', containerName],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
    lastState = result.stdout.trim();

    if ((expectedRunning && lastState === 'true') || (!expectedRunning && lastState === 'false')) {
      return;
    }

    await wait(300);
  }

  throw new Error(
    `Timed out waiting for container ${containerName} running=${expectedRunning}. lastState=${lastState}`,
  );
};

const waitForContainerHealthStatus = async (containerName, expectedStatus, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'unknown';

  while (Date.now() < deadline) {
    const result = spawnSync(
      'docker',
      ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-health{{end}}', containerName],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
    lastStatus = result.stdout.trim();

    if (lastStatus === expectedStatus) {
      return;
    }

    await wait(500);
  }

  throw new Error(
    `Timed out waiting for container ${containerName} health=${expectedStatus}. lastStatus=${lastStatus}`,
  );
};

const getContainerHealthStatus = (containerName) =>
  spawnSync(
    'docker',
    ['inspect', '-f', '{{if .State.Health}}{{.State.Health.Status}}{{else}}no-health{{end}}', containerName],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  ).stdout.trim();

const ensureVaultHealthy = async () => {
  logStage(`waiting for vault health at ${vaultHealthUrl}`);
  await waitForHttpOk(vaultHealthUrl, {
    timeoutMs: 30_000,
  });
};

const ensureVaultStarted = async () => {
  logStage(`starting vault container ${vaultContainer}`);
  spawnSync('docker', ['start', vaultContainer], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  await waitForContainerRunningState(vaultContainer, true);
  await ensureVaultHealthy();
  logStage('vault is healthy');
};

const ensureRedisStarted = async () => {
  logStage(`starting redis container ${redisContainer}`);
  spawnSync('docker', ['start', redisContainer], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  await waitForContainerRunningState(redisContainer, true);
  logStage('redis is running');
};

const stopRedis = async () => {
  logStage(`stopping redis container ${redisContainer}`);
  spawnSync('docker', ['stop', '-t', '1', redisContainer], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  await waitForContainerRunningState(redisContainer, false);
  logStage('redis is fully stopped');
};

const ensureMysqlStarted = async () => {
  logStage(`starting mysql container ${mysqlContainer}`);
  spawnSync('docker', ['start', mysqlContainer], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  await waitForContainerRunningState(mysqlContainer, true);
  await waitForContainerHealthStatus(mysqlContainer, 'healthy');
  logStage('mysql is healthy');
};

const ensureChannelServiceHealthy = async () => {
  const healthStatus = getContainerHealthStatus(channelServiceContainer);

  if (healthStatus === 'healthy') {
    logStage(`${channelServiceContainer} is healthy`);
    return;
  }

  logStage(`restarting ${channelServiceContainer} because health=${healthStatus}`);
  spawnSync('docker', ['restart', channelServiceContainer], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  await waitForContainerRunningState(channelServiceContainer, true, 30_000);
  await waitForContainerHealthStatus(channelServiceContainer, 'healthy', 60_000);
  logStage(`${channelServiceContainer} is healthy`);
};

const stopMysql = async () => {
  logStage(`stopping mysql container ${mysqlContainer}`);
  spawnSync('docker', ['stop', '-t', '1', mysqlContainer], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  await waitForContainerRunningState(mysqlContainer, false);
  logStage('mysql is fully stopped');
};

const readRequestBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : undefined;
};

const readResponseBody = async (response) => {
  const chunks = [];

  for await (const chunk of response) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return chunks.length > 0 ? Buffer.concat(chunks) : Buffer.alloc(0);
};

const getIncomingHeaderValue = (headers, name) => {
  const value = headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value.join(', ');
  }

  return typeof value === 'string' ? value : undefined;
};

const buildRelayHeaders = (headers, bodyLength) => {
  const relayedHeaders = { ...headers };

  delete relayedHeaders.connection;
  delete relayedHeaders['transfer-encoding'];
  delete relayedHeaders['keep-alive'];
  delete relayedHeaders['proxy-authenticate'];
  delete relayedHeaders['proxy-authorization'];
  delete relayedHeaders.te;
  delete relayedHeaders.trailer;
  delete relayedHeaders.upgrade;

  if (bodyLength !== undefined) {
    relayedHeaders['content-length'] = String(bodyLength);
  }

  return relayedHeaders;
};

const isCapturedAuthRequest = (url) =>
  url.includes('/api/v1/auth/csrf') || url.includes('/api/v1/auth/login');

const waitForCapturedLoginResponse = async (proxyCapture, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (proxyCapture.lastLoginResponse) {
      return proxyCapture.lastLoginResponse;
    }

    await wait(250);
  }

  throw new Error('Timed out waiting for the proxied login response.');
};

const startBrowserProxyServer = async () => {
  logStage(`starting browser proxy on ${baseUrl}`);
  const proxyCapture = {
    authResponses: [],
    lastLoginResponse: null,
  };
  const server = http.createServer(async (request, response) => {
    if (!request.url) {
      response.writeHead(400);
      response.end('Missing request URL');
      return;
    }

    const upstreamBaseUrl =
      request.url.startsWith('/api') || request.url.startsWith('/actuator')
        ? liveApiBaseUrl
        : viteBaseUrl;

    try {
      const upstreamUrl = new URL(request.url, upstreamBaseUrl);
      const body =
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await readRequestBody(request);
      const upstreamHeaders = { ...request.headers };
      delete upstreamHeaders.host;
      delete upstreamHeaders.connection;

      await new Promise((resolveProxy, rejectProxy) => {
        const upstreamRequest = http.request(
          {
            protocol: upstreamUrl.protocol,
            hostname: upstreamUrl.hostname,
            port: upstreamUrl.port,
            method: request.method,
            path: `${upstreamUrl.pathname}${upstreamUrl.search}`,
            headers: upstreamHeaders,
          },
          (upstreamResponse) => {
            logStage(
              `proxy upstream ${request.method ?? 'GET'} ${request.url} ${upstreamResponse.statusCode ?? 'unknown'}`,
            );
            if (isCapturedAuthRequest(request.url)) {
              const relayedCookieHeader = upstreamResponse.headers['set-cookie'];
              if (relayedCookieHeader) {
                logStage(`proxy relayed set-cookie for ${request.url}`);
              }

              readResponseBody(upstreamResponse)
                .then((responseBody) => {
                  const relayedHeaders = buildRelayHeaders(upstreamResponse.headers, responseBody.length);
                  const capturedResponse = {
                    url: request.url,
                    status: upstreamResponse.statusCode ?? 502,
                    correlationId: firstHeaderValue(
                      getIncomingHeaderValue(upstreamResponse.headers, 'x-correlation-id'),
                    ),
                    traceparent: firstHeaderValue(
                      getIncomingHeaderValue(upstreamResponse.headers, 'traceparent'),
                    ),
                    bodyText: responseBody.toString('utf8'),
                  };

                  proxyCapture.authResponses.push(capturedResponse);

                  if (request.url.includes('/api/v1/auth/login')) {
                    proxyCapture.lastLoginResponse = capturedResponse;
                  }

                  response.writeHead(upstreamResponse.statusCode ?? 502, relayedHeaders);
                  response.end(responseBody);
                  resolveProxy();
                })
                .catch(rejectProxy);
              return;
            }

            response.writeHead(
              upstreamResponse.statusCode ?? 502,
              buildRelayHeaders(upstreamResponse.headers),
            );
            upstreamResponse.pipe(response);
            upstreamResponse.on('end', resolveProxy);
            upstreamResponse.on('error', rejectProxy);
          },
        );

        upstreamRequest.on('error', rejectProxy);
        if (body) {
          upstreamRequest.write(body);
        }
        upstreamRequest.end();
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logStage(`proxy error ${request.method ?? 'GET'} ${request.url}: ${message}`);
      response.writeHead(502, {
        'Content-Type': 'application/json',
      });
      response.end(JSON.stringify({
        code: 'PROXY_ERROR',
        message,
      }));
    }
  });

  await new Promise((resolveReady, rejectReady) => {
    server.once('error', rejectReady);
    server.listen(Number(proxyPort), '127.0.0.1', () => {
      resolveReady();
    });
  });

  await waitForHttpOk(`${baseUrl}/login`, {
    timeoutMs: 30_000,
  });
  logStage('browser proxy is ready');

  return {
    server,
    proxyCapture,
  };
};

const stopVault = async () => {
  logStage(`stopping vault container ${vaultContainer}`);
  spawnSync('docker', ['stop', '-t', '1', vaultContainer], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  await waitForContainerRunningState(vaultContainer, false);
  logStage('vault is fully stopped');
};

const startViteServer = async () => {
  const viteLogPath = resolve(artifactDir, `${videoBasename}-vite.log`);
  logStage(`starting vite server on ${viteBaseUrl}`);
  const child = spawn(
    'pnpm',
    ['exec', 'vite', '--host', '127.0.0.1', '--port', vitePort, '--strictPort'],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        LIVE_API_BASE_URL: liveApiBaseUrl,
        VITE_DEV_PROXY_TARGET: liveApiBaseUrl,
        VITE_API_BASE_URL: '',
        VITE_API_TIMEOUT_MS: process.env.VITE_API_TIMEOUT_MS ?? '45000',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let combinedLogs = '';
  const appendLog = (chunk) => {
    combinedLogs += chunk.toString();
    writeFileSync(viteLogPath, combinedLogs);
  };

  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);

  await new Promise((resolveReady, rejectReady) => {
    let settled = false;

    const settleResolve = () => {
      if (!settled) {
        settled = true;
        resolveReady();
      }
    };
    const settleReject = (error) => {
      if (!settled) {
        settled = true;
        rejectReady(error);
      }
    };

    child.once('error', (error) => {
      settleReject(new Error(`Failed to start Vite server: ${error.message}`));
    });

    child.once('exit', (code, signal) => {
      settleReject(new Error(`Vite server exited before becoming ready (code=${code}, signal=${signal})`));
    });

    waitForHttpOk(`${viteBaseUrl}/login`, {
      timeoutMs: 30_000,
    }).then(settleResolve).catch(settleReject);
  });
  logStage('vite server is ready');

  return child;
};

const closeChildProcess = async (child) => {
  if (!child || child.killed) {
    return;
  }

  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolveExit) => {
      child.once('exit', resolveExit);
    }),
    wait(5_000),
  ]);

  if (child.exitCode === null && !child.killed) {
    child.kill('SIGKILL');
  }
};

const closeServer = async (server) => {
  if (!server) {
    return;
  }

  await new Promise((resolveClose) => {
    server.close(() => resolveClose());
  });
};

const registerAndEnrollTotp = async (browser, identity) => {
  logStage(`registering live user ${identity.email}`);
  const context = await browser.newContext({
    baseURL: viteBaseUrl,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  await page.goto('/register?redirect=/orders');
  await page.getByTestId('register-email').fill(identity.email);
  await page.getByTestId('register-name').fill(identity.name);
  await page.getByTestId('register-password').fill(identity.password);
  await page.getByTestId('register-password-confirm').fill(identity.password);

  const registerLoginResponsePromise = page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/auth/login')
      && response.request().method() === 'POST',
  );
  await page.getByTestId('register-submit').click();

  const registerLoginResponse = await registerLoginResponsePromise;
  if (!registerLoginResponse.ok()) {
    throw new Error(`Register login bootstrap failed with ${registerLoginResponse.status()}`);
  }

  await page.getByTestId('totp-enroll-manual-key').waitFor();
  const manualEntryKey = (await page.getByTestId('totp-enroll-manual-key').textContent())?.trim();

  if (!manualEntryKey) {
    throw new Error('Missing TOTP manual entry key.');
  }

  const enrollmentCode = generateTotp(manualEntryKey);
  await page.getByTestId('totp-enroll-code').fill(enrollmentCode);
  await page.getByTestId('totp-enroll-submit').click();
  await page.getByTestId('protected-area-title').waitFor();

  await context.close();
  logStage('registration and TOTP enrollment complete');

  return {
    manualEntryKey,
    lastUsedTotp: enrollmentCode,
  };
};

const recordLiveDemo = async (browser, identity, proxyCapture) => {
  logStage('starting recorded browser flow');
  const context = await browser.newContext({
    baseURL: baseUrl,
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: artifactDir,
      size: {
        width: 1280,
        height: 720,
      },
    },
  });
  const page = await context.newPage();
  const pageVideo = page.video();

  page.on('request', (request) => {
    if (request.url().includes('/api/v1/auth')) {
      logStage(`browser request ${request.method()} ${request.url()}`);
    }
  });
  page.on('response', (response) => {
    if (response.url().includes('/api/v1/auth')) {
      logStage(`browser response ${response.status()} ${response.url()}`);
    }
  });
  page.on('pageerror', (error) => {
    logStage(`browser pageerror ${error.message}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      logStage(`browser console error ${message.text()}`);
    }
  });

  let correlationId;
  let loginStatus;

  try {
    await page.goto('/login?redirect=/orders');
    await wait(1_500);
    const csrfBootstrap = await page.evaluate(async () => {
      try {
        const { fetchCsrfToken } = await import('/src/lib/axios.ts');
        const payload = await fetchCsrfToken(true);

        return {
          ok: true,
          payload,
        };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    if (!csrfBootstrap.ok) {
      throw new Error(`Axios csrf bootstrap failed: ${csrfBootstrap.error}`);
    }

    logStage(`axios csrf bootstrap payload=${JSON.stringify(csrfBootstrap.payload)}`);
    await page.getByTestId('login-email').fill(identity.email);
    await page.getByTestId('login-password').fill(identity.password);
    await wait(300);

    await stopMysql();

    proxyCapture.lastLoginResponse = null;
    await page.getByTestId('login-submit').click();

    const loginResponse = await waitForCapturedLoginResponse(proxyCapture);
    loginStatus = loginResponse.status;
    correlationId = loginResponse.correlationId;
    const loginPayload = loginResponse.bodyText ? JSON.parse(loginResponse.bodyText) : null;
    logStage(
      `captured login response status=${loginStatus} correlationId=${correlationId ?? 'missing'} `
        + `payload=${JSON.stringify(loginPayload)}`,
    );

    await ensureMysqlStarted();

    const supportReference = page.getByTestId('error-message');
    await supportReference.waitFor({ timeout: 20_000 });

    const supportText = (await supportReference.textContent())?.trim() ?? '';
    if (!correlationId || !supportText.includes(correlationId)) {
      throw new Error(
        `Support reference did not include the login correlation id. corr=${correlationId} text=${supportText}`,
      );
    }

    logStage('support reference is visible with matching correlation id');
    await page.screenshot({
      path: resolve(artifactDir, `${videoBasename}-final.png`),
    });
    await wait(1_500);
  } finally {
    await ensureMysqlStarted();
    await context.close();
  }

  return {
    correlationId,
    loginStatus,
    videoPath: pageVideo ? await pageVideo.path() : undefined,
  };
};

const transcodeVideo = (inputPath) => {
  if (!inputPath || !existsSync(inputPath)) {
    return undefined;
  }

  const outputPath = resolve(artifactDir, `${videoBasename}.mp4`);
  logStage(`transcoding video to ${outputPath}`);
  rmSync(outputPath, { force: true });

  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-i',
      inputPath,
      '-vf',
      'setpts=0.6*PTS',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '30',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      '-an',
      outputPath,
    ],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    },
  );

  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${result.stderr?.trim() ?? 'unknown error'}`);
  }

  logStage('video transcode complete');
  return outputPath;
};

const main = async () => {
  logStage('preparing artifact directory');
  ensureDirectory(artifactDir);
  rmSync(resolve(artifactDir, `${videoBasename}.mp4`), { force: true });
  rmSync(resolve(artifactDir, `${videoBasename}.webm`), { force: true });
  rmSync(resolve(artifactDir, `${videoBasename}.json`), { force: true });
  rmSync(resolve(artifactDir, `${videoBasename}-final.png`), { force: true });

  const identity = createLiveIdentity();
  let viteServer;
  let browserProxyServer;
  let proxyCapture;

  try {
    await ensureVaultStarted();
    await ensureRedisStarted();
    await ensureMysqlStarted();
    await ensureChannelServiceHealthy();
    viteServer = await startViteServer();
    ({ server: browserProxyServer, proxyCapture } = await startBrowserProxyServer());

    logStage('launching browser');
    const browser = await chromium.launch({
      headless: true,
      slowMo: 120,
    });

    try {
      if (USE_EXISTING_IDENTITY) {
        logStage(`using existing live identity ${identity.email}`);
      } else {
        await registerAndEnrollTotp(browser, identity);
      }

      const demoResult = await recordLiveDemo(browser, identity, proxyCapture);
      const mp4Path = transcodeVideo(demoResult.videoPath);

      const normalizedWebmPath = demoResult.videoPath
        ? resolve(artifactDir, `${videoBasename}.webm`)
        : undefined;

      if (demoResult.videoPath && normalizedWebmPath && demoResult.videoPath !== normalizedWebmPath) {
        rmSync(normalizedWebmPath, { force: true });
        writeFileSync(
          resolve(artifactDir, `${videoBasename}.json`),
          JSON.stringify({
            baseUrl,
            loginStatus: demoResult.loginStatus,
            correlationId: demoResult.correlationId,
            email: identity.email,
            video: {
              webm: normalizedWebmPath,
              raw: demoResult.videoPath,
              mp4: mp4Path,
            },
          }, null, 2),
        );
        copyFileSync(demoResult.videoPath, normalizedWebmPath);
      } else {
        writeFileSync(
          resolve(artifactDir, `${videoBasename}.json`),
          JSON.stringify({
            baseUrl,
            loginStatus: demoResult.loginStatus,
            correlationId: demoResult.correlationId,
            email: identity.email,
            video: {
              webm: demoResult.videoPath,
              mp4: mp4Path,
            },
          }, null, 2),
        );
      }

      console.log(JSON.stringify({
        ok: true,
        baseUrl,
        loginStatus: demoResult.loginStatus,
        correlationId: demoResult.correlationId,
        mp4Path,
        webmPath: normalizedWebmPath ?? demoResult.videoPath,
      }, null, 2));
    } finally {
      logStage('closing browser');
      await browser.close();
    }
  } finally {
    logStage('cleaning up processes');
    await ensureMysqlStarted();
    await ensureRedisStarted();
    await ensureVaultStarted();
    await ensureChannelServiceHealthy();
    await closeServer(browserProxyServer);
    await closeChildProcess(viteServer);
  }
};

main()
  .then(() => {
    process.exit(0);
  })
  .catch(async (error) => {
    try {
      await ensureMysqlStarted();
      await ensureRedisStarted();
      await ensureVaultStarted();
      await ensureChannelServiceHealthy();
    } catch {
      // Best effort recovery only.
    }

    console.error(error);
    process.exit(1);
  });
