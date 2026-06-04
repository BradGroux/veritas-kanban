/**
 * Scenario 4: Mixed Workload
 *
 * 70 % reads, 30 % writes — 30 virtual users.
 * Ramp up from 0 → 30 over 10 s, hold for 50 s.
 * Total duration: 60 seconds.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { API_BASE, defaultHeaders, makeTask } from '../config.js';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '10s', target: 30 }, // ramp up
    { duration: '50s', target: 30 }, // hold
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    errors: ['rate<0.01'],
  },
};

// ── Read scenario (70 %) ─────────────────────────────────────
function readScenario() {
  const listRes = http.get(`${API_BASE}/tasks`, {
    headers: defaultHeaders,
    tags: { name: 'GET /tasks' },
  });

  const listOk = check(listRes, { 'list → 200': (r) => r.status === 200 });
  errorRate.add(!listOk);

  // Read a random task from the list
  try {
    const body = JSON.parse(listRes.body);
    const tasks = Array.isArray(body)
      ? body
      : body.tasks || (Array.isArray(body.data) ? body.data : body.data?.tasks) || [];
    if (tasks.length > 0) {
      const id = tasks[Math.floor(Math.random() * tasks.length)].id;
      const detailRes = http.get(`${API_BASE}/tasks/${id}`, {
        headers: defaultHeaders,
        tags: { name: 'GET /tasks/:id' },
      });
      const detailOk = check(detailRes, { 'detail → 200': (r) => r.status === 200 });
      errorRate.add(!detailOk);
    }
  } catch {
    // ignore
  }

  sleep(0.3);
}

// ── Write scenario (30 %) ────────────────────────────────────
function writeScenario() {
  const payload = makeTask('mixed');
  const createRes = http.post(`${API_BASE}/tasks`, JSON.stringify(payload), {
    headers: defaultHeaders,
    tags: { name: 'POST /tasks' },
  });

  const createOk = check(createRes, { 'create → 201': (r) => r.status === 201 });
  errorRate.add(!createOk);

  if (!createOk) {
    sleep(0.5);
    return;
  }

  const created = JSON.parse(createRes.body);
  const taskId = created.id || created.task?.id || created.data?.id || created.data?.task?.id;

  sleep(0.2);

  // Update
  const updateRes = http.patch(
    `${API_BASE}/tasks/${taskId}`,
    JSON.stringify({ priority: 'high' }),
    {
      headers: defaultHeaders,
      tags: { name: 'PATCH /tasks/:id' },
    }
  );
  const updateOk = check(updateRes, { 'update → 200': (r) => r.status === 200 });
  errorRate.add(!updateOk);

  sleep(0.2);

  // Delete (cleanup)
  const delRes = http.del(`${API_BASE}/tasks/${taskId}`, null, {
    headers: defaultHeaders,
    tags: { name: 'DELETE /tasks/:id' },
  });
  const delOk = check(delRes, { 'delete → 200/204': (r) => r.status === 200 || r.status === 204 });
  errorRate.add(!delOk);

  sleep(0.3);
}

// ── Main ─────────────────────────────────────────────────────
export default function () {
  if (Math.random() < 0.7) {
    readScenario();
  } else {
    writeScenario();
  }
}
