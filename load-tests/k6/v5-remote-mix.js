/**
 * Scenario 6: v5 Remote and SQLite Mix
 *
 * Seeds a representative remote dataset, then exercises board reads, task
 * search, dashboard metrics, workflow run metadata, chat history, write churn,
 * and WebSocket task/workflow/chat subscriptions.
 */
import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { API_BASE, WS_URL, API_KEY, defaultHeaders, makeTask } from '../config.js';

const errors = new Rate('v5_errors');
const wsErrors = new Rate('v5_ws_errors');
const wsMessages = new Counter('v5_ws_messages_received');

const boardDuration = new Trend('v5_board_duration', true);
const detailDuration = new Trend('v5_detail_duration', true);
const dashboardDuration = new Trend('v5_dashboard_duration', true);
const searchDuration = new Trend('v5_search_duration', true);
const workflowRunsDuration = new Trend('v5_workflow_runs_duration', true);
const chatHistoryDuration = new Trend('v5_chat_history_duration', true);
const writeDuration = new Trend('v5_write_duration', true);

const seedTaskCount = Number(__ENV.V5_SEED_TASKS || '120');
const seedChatCount = Number(__ENV.V5_SEED_CHATS || '12');
const httpVus = Number(__ENV.V5_HTTP_VUS || '20');
const wsVus = Number(__ENV.V5_WS_VUS || '30');
const duration = __ENV.V5_DURATION || '45s';
const wsHoldMs = Number(__ENV.V5_WS_HOLD_MS || '40000');

export const options = {
  scenarios: {
    http_mix: {
      executor: 'constant-vus',
      vus: httpVus,
      duration,
      exec: 'httpMix',
    },
    ws_clients: {
      executor: 'constant-vus',
      vus: wsVus,
      duration,
      exec: 'wsClients',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    v5_errors: ['rate<0.01'],
    v5_ws_errors: ['rate<0.05'],
    v5_board_duration: ['p(95)<350'],
    v5_detail_duration: ['p(95)<250'],
    v5_dashboard_duration: ['p(95)<750'],
    v5_search_duration: ['p(95)<750'],
    v5_workflow_runs_duration: ['p(95)<500'],
    v5_chat_history_duration: ['p(95)<500'],
    v5_write_duration: ['p(95)<750'],
  },
};

function parseJson(response) {
  try {
    return JSON.parse(response.body);
  } catch {
    return null;
  }
}

function pick(values) {
  if (!values || values.length === 0) return null;
  return values[Math.floor(Math.random() * values.length)];
}

function record(response, trend, label, expectedStatuses = [200]) {
  trend.add(response.timings.duration);
  const ok = check(response, {
    [label]: (r) => expectedStatuses.includes(r.status),
  });
  errors.add(!ok);
  return ok;
}

function createTask(prefix) {
  const response = http.post(`${API_BASE}/tasks`, JSON.stringify(makeTask(prefix)), {
    headers: defaultHeaders,
    tags: { name: 'POST /tasks' },
  });
  const body = parseJson(response);
  return response.status === 201
    ? body?.id || body?.task?.id || body?.data?.id || body?.data?.task?.id || null
    : null;
}

export function setup() {
  const taskIds = [];
  const sessionIds = [];

  for (let index = 0; index < seedTaskCount; index += 1) {
    const taskId = createTask('v5-load-seed');
    if (taskId) {
      taskIds.push(taskId);
    }
  }

  for (let index = 0; index < Math.min(seedChatCount, taskIds.length); index += 1) {
    const response = http.post(
      `${API_BASE}/chat/send`,
      JSON.stringify({
        taskId: taskIds[index],
        message: `Seed remote chat history ${index}`,
        agent: 'veritas',
        mode: 'ask',
        includeContext: false,
      }),
      {
        headers: defaultHeaders,
        tags: { name: 'POST /chat/send' },
      }
    );
    const body = parseJson(response);
    const sessionId = body?.sessionId || body?.data?.sessionId;
    if (response.status === 200 && sessionId) {
      sessionIds.push(sessionId);
    }
  }

  return { taskIds, sessionIds };
}

export function httpMix(data) {
  const taskId = pick(data.taskIds);
  const sessionId = pick(data.sessionIds);
  const roll = Math.random();

  if (roll < 0.18) {
    const response = http.get(`${API_BASE}/tasks`, {
      headers: defaultHeaders,
      tags: { name: 'GET /tasks' },
    });
    record(response, boardDuration, 'board list returns 200');
  } else if (roll < 0.34 && taskId) {
    const response = http.get(`${API_BASE}/tasks/${taskId}`, {
      headers: defaultHeaders,
      tags: { name: 'GET /tasks/:id' },
    });
    record(response, detailDuration, 'task detail returns 200');
  } else if (roll < 0.5) {
    const response = http.post(
      `${API_BASE}/search`,
      JSON.stringify({
        query: 'v5-load-seed',
        limit: 20,
        backend: 'keyword',
        collections: ['tasks-active', 'workflows', 'workflow-runs'],
      }),
      {
        headers: defaultHeaders,
        tags: { name: 'POST /search' },
      }
    );
    record(response, searchDuration, 'search returns 200');
  } else if (roll < 0.64) {
    const response = http.get(`${API_BASE}/metrics/all?period=7d`, {
      headers: defaultHeaders,
      tags: { name: 'GET /metrics/all' },
    });
    record(response, dashboardDuration, 'dashboard metrics returns 200');
  } else if (roll < 0.76) {
    const response = http.get(`${API_BASE}/workflows/runs`, {
      headers: defaultHeaders,
      tags: { name: 'GET /workflows/runs' },
    });
    record(response, workflowRunsDuration, 'workflow runs returns 200');
  } else if (roll < 0.88 && sessionId) {
    const response = http.get(`${API_BASE}/chat/sessions/${sessionId}/history`, {
      headers: defaultHeaders,
      tags: { name: 'GET /chat/sessions/:id/history' },
    });
    record(response, chatHistoryDuration, 'chat history returns 200');
  } else {
    const createdTaskId = createTask('v5-load-write');
    if (!createdTaskId) {
      errors.add(1);
      sleep(0.2);
      return;
    }

    const updateResponse = http.patch(
      `${API_BASE}/tasks/${createdTaskId}`,
      JSON.stringify({
        priority: 'high',
        description: 'Updated during v5 remote mix load test',
      }),
      {
        headers: defaultHeaders,
        tags: { name: 'PATCH /tasks/:id' },
      }
    );
    record(updateResponse, writeDuration, 'task update returns 200');

    const deleteResponse = http.del(`${API_BASE}/tasks/${createdTaskId}`, null, {
      headers: defaultHeaders,
      tags: { name: 'DELETE /tasks/:id' },
    });
    record(deleteResponse, writeDuration, 'task delete returns 200 or 204', [200, 204]);
  }

  sleep(0.2);
}

export function wsClients(data) {
  const taskId = pick(data.taskIds);
  const sessionId = pick(data.sessionIds);
  const url = `${WS_URL}?api_key=${encodeURIComponent(API_KEY)}`;

  const response = ws.connect(url, {}, (socket) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({ type: 'subscribe:tasks' }));
      socket.send(JSON.stringify({ type: 'workflow:subscribe' }));
      if (taskId) {
        socket.send(JSON.stringify({ type: 'subscribe', taskId }));
      }
      if (sessionId) {
        socket.send(JSON.stringify({ type: 'chat:subscribe', sessionId }));
      }
    });

    socket.on('message', (message) => {
      wsMessages.add(1);
      try {
        JSON.parse(message);
      } catch {
        // WebSocket control frames are acceptable for this load profile.
      }
    });

    socket.on('error', () => {
      wsErrors.add(1);
    });

    socket.setInterval(() => {
      socket.send(JSON.stringify({ type: 'subscribe:tasks' }));
    }, 10_000);

    socket.setTimeout(() => {
      socket.close();
    }, wsHoldMs);
  });

  const connected = check(response, {
    'v5 WS connected (101)': (r) => r && r.status === 101,
  });
  wsErrors.add(!connected);
}
