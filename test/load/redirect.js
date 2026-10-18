// Redirect load test. Run with test/load/run.sh, or:
//   docker run --rm -i -e BASE_URL=http://host.docker.internal:3301 grafana/k6:2.3.0 run - < test/load/redirect.js
// Expects the dataset from test/load/seed.sql (codes c0000001..c1000000).
import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://host.docker.internal:3301';
const RATE = Number(__ENV.RATE || 1000);
const DURATION = __ENV.DURATION || '60s';

export const options = {
  discardResponseBodies: true,
  scenarios: {
    redirects: {
      executor: 'constant-arrival-rate',
      rate: RATE,
      timeUnit: '1s',
      duration: DURATION,
      preAllocatedVUs: 200,
      maxVUs: 1000,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:hot}': ['p(95)<50'],
  },
  summaryTrendStats: ['avg', 'p(50)', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const rand = (n) => Math.floor(Math.random() * n);
const code = (n) => `c${String(n).padStart(7, '0')}`;

// Traffic shape: link popularity is heavily skewed, so most requests hit a small hot set
// (served from Redis); the long tail mostly misses the cache; a few are unknown codes.
function pick() {
  const r = Math.random();
  if (r < 0.9) return { kind: 'hot', path: code(1 + Math.floor(Math.random() * 1000)) };
  if (r < 0.99) return { kind: 'tail', path: code(1 + Math.floor(Math.random() * 1000000)) };
  return { kind: 'unknown', path: `zz${Math.floor(Math.random() * 1e9)}` };
}

// 404 (unknown code) and 410 (seeded disabled/expired links) are correct answers, not failures.
http.setResponseCallback(http.expectedStatuses(302, 404, 410));

export default function () {
  const { kind, path } = pick();
  const res = http.get(`${BASE_URL}/${path}`, {
    redirects: 0,
    tags: { kind, name: '/:code' },
    // Visitors come from many addresses; a random one per request keeps per-IP limits realistic
    // (and exercises the rate limiter's key churn in Redis).
    headers: { 'X-Forwarded-For': `10.${rand(256)}.${rand(256)}.${rand(256)}` },
  });
  // Seeded links are 302, or 410 when disabled/expired; unknown codes are 404.
  check(res, {
    'expected status': (r) =>
      kind === 'unknown' ? r.status === 404 : r.status === 302 || r.status === 410,
  });
}
