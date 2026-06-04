/**
 * Scenario 3: Write-Heavy Load
 *
 * 20 virtual users creating, updating, and deleting tasks
 * for 30 seconds.
 *
 * Thresholds:
 *   p(95) response time < 500 ms
 *   error rate < 1 %
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { API_BASE, defaultHeaders, makeTask } from '../config.js';

const errorRate = new Rate('errors');

export const options = {
  vus: 20,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.01'],
  },
};

export default function () {
  // ── CREATE ─────────────────────────────────────────────────
  const payload = makeTask('write-load');
  const createRes = http.post(`${API_BASE}/tasks`, JSON.stringify(payload), {
    headers: defaultHeaders,
    tags: { name: 'POST /tasks' },
  });

  const createOk = check(createRes, {
    'create → 201': (r) => r.status === 201,
  });
  errorRate.add(!createOk);

  if (!createOk) {
    sleep(0.5);
    return;
  }

  const created = JSON.parse(createRes.body);
  const taskId = created.id || created.task?.id || created.data?.id || created.data?.task?.id;

  sleep(0.2);

  // ── UPDATE ─────────────────────────────────────────────────
  const updateRes = http.patch(
    `${API_BASE}/tasks/${taskId}`,
    JSON.stringify({
      title: `${payload.title}-updated`,
      priority: 'high',
      description: 'Updated during write-load test',
    }),
    {
      headers: defaultHeaders,
      tags: { name: 'PATCH /tasks/:id' },
    }
  );

  const updateOk = check(updateRes, {
    'update → 200': (r) => r.status === 200,
  });
  errorRate.add(!updateOk);

  sleep(0.2);

  // ── DELETE ─────────────────────────────────────────────────
  const delRes = http.del(`${API_BASE}/tasks/${taskId}`, null, {
    headers: defaultHeaders,
    tags: { name: 'DELETE /tasks/:id' },
  });

  const delOk = check(delRes, {
    'delete → 200 or 204': (r) => r.status === 200 || r.status === 204,
  });
  errorRate.add(!delOk);

  sleep(0.3);
}
