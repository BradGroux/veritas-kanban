/**
 * Scenario 2: Read-Heavy Load
 *
 * 50 virtual users hammering GET /tasks and GET /tasks/:id
 * for 30 seconds.
 *
 * Thresholds:
 *   p(95) response time < 200 ms
 *   error rate < 1 %
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { API_BASE, defaultHeaders } from '../config.js';

const errorRate = new Rate('errors');
const listDuration = new Trend('list_duration', true);
const detailDuration = new Trend('detail_duration', true);

export const options = {
  vus: 50,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<200'],
    errors: ['rate<0.01'],
  },
};

export default function () {
  // ── List tasks ─────────────────────────────────────────────
  const listRes = http.get(`${API_BASE}/tasks`, {
    headers: defaultHeaders,
    tags: { name: 'GET /tasks' },
  });

  listDuration.add(listRes.timings.duration);

  const listOk = check(listRes, {
    'list → 200': (r) => r.status === 200,
  });
  errorRate.add(!listOk);

  // Grab a task id from the list for detail reads
  let taskId = null;
  try {
    const body = JSON.parse(listRes.body);
    const tasks = Array.isArray(body)
      ? body
      : body.tasks || (Array.isArray(body.data) ? body.data : body.data?.tasks) || [];
    if (tasks.length > 0) {
      // Pick a random task
      taskId = tasks[Math.floor(Math.random() * tasks.length)].id;
    }
  } catch {
    // ignore parse errors
  }

  sleep(0.1);

  // ── Read single task (if we found one) ─────────────────────
  if (taskId) {
    const detailRes = http.get(`${API_BASE}/tasks/${taskId}`, {
      headers: defaultHeaders,
      tags: { name: 'GET /tasks/:id' },
    });

    detailDuration.add(detailRes.timings.duration);

    const detailOk = check(detailRes, {
      'detail → 200': (r) => r.status === 200,
    });
    errorRate.add(!detailOk);
  }

  sleep(0.2);
}
