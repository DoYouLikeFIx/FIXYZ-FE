const baseUrl = (
  process.env.LIVE_API_BASE_URL
  ?? process.env.VITE_DEV_PROXY_TARGET
  ?? 'http://127.0.0.1:8080'
).replace(/\/$/, '');

const response = await fetch(`${baseUrl}/api/v1/auth/csrf`, {
  method: 'GET',
  headers: {
    Accept: 'application/json',
  },
});
const payload = await response.text();

if (!response.ok) {
  console.error(
    `LIVE auth preflight failed: ${response.status} ${response.statusText} ${payload || ''}`.trim(),
  );
  process.exit(1);
}

console.log(
  `LIVE auth preflight passed: /api/v1/auth/csrf -> ${response.status} ${response.statusText}`,
);
