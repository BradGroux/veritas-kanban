/**
 * Scenario 1: API CRUD Smoke Test
 *
 * Exercises the full task lifecycle:
 *   Create → Read → Update → Delete
 *
 * 1 virtual user, 1 iteration.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { API_BASE, defaultHeaders, makeTask } from '../config.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    checks: ['rate==1.0'], // every check must pass
  },
};

export default function () {
  // ── CREATE ─────────────────────────────────────────────────
  const payload = makeTask('smoke');
  const createRes = http.post(`${API_BASE}/tasks`, JSON.stringify(payload), {
    headers: defaultHeaders,
  });

  const createOk = check(createRes, {
    'POST /tasks → 201': (r) => r.status === 201,
    'POST /tasks → has id': (r) => {
      try {
        const body = JSON.parse(r.body);
        return !!(body.id || body.task?.id || body.data?.id || body.data?.task?.id);
      } catch {
        return false;
      }
    },
  });

  if (!createOk) {
    console.error(`CREATE failed: ${createRes.status} — ${createRes.body}`);
    return;
  }

  const created = JSON.parse(createRes.body);
  const taskId = created.id || created.task?.id || created.data?.id || created.data?.task?.id;

  sleep(0.3);

  // ── READ (single) ─────────────────────────────────────────
  const getRes = http.get(`${API_BASE}/tasks/${taskId}`, {
    headers: defaultHeaders,
  });

  check(getRes, {
    'GET /tasks/:id → 200': (r) => r.status === 200,
  });

  sleep(0.3);

  // ── UPDATE ─────────────────────────────────────────────────
  const updateRes = http.patch(
    `${API_BASE}/tasks/${taskId}`,
    JSON.stringify({ title: `${payload.title}-updated`, priority: 'high' }),
    { headers: defaultHeaders }
  );

  check(updateRes, {
    'PATCH /tasks/:id → 200': (r) => r.status === 200,
  });

  sleep(0.3);

  // ── READ LIST ──────────────────────────────────────────────
  const listRes = http.get(`${API_BASE}/tasks`, {
    headers: defaultHeaders,
  });

  check(listRes, {
    'GET /tasks → 200': (r) => r.status === 200,
    'GET /tasks → is array or has tasks': (r) => {
      try {
        const body = JSON.parse(r.body);
        return (
          Array.isArray(body) ||
          Array.isArray(body.tasks) ||
          Array.isArray(body.data) ||
          Array.isArray(body.data?.tasks)
        );
      } catch {
        return false;
      }
    },
  });

  sleep(0.3);

  // ── DELETE ─────────────────────────────────────────────────
  const delRes = http.del(`${API_BASE}/tasks/${taskId}`, null, {
    headers: defaultHeaders,
  });

  check(delRes, {
    'DELETE /tasks/:id → 200 or 204': (r) => r.status === 200 || r.status === 204,
  });
}
