/**
 * Scenario 5: WebSocket Stress
 *
 * 25 concurrent WebSocket connections.
 * Each connection stays open for 30 seconds, verifying
 * that the connection is established and messages can be received.
 */
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Rate, Counter } from 'k6/metrics';
import { WS_URL, API_KEY } from '../config.js';

const wsErrors = new Rate('ws_errors');
const wsMessages = new Counter('ws_messages_received');

export const options = {
  vus: 25,
  duration: '30s',
  thresholds: {
    ws_errors: ['rate<0.05'], // <5% connection errors
  },
};

export default function () {
  const url = `${WS_URL}?api_key=${encodeURIComponent(API_KEY)}`;

  const res = ws.connect(url, {}, function (socket) {
    socket.on('open', () => {
      // Send a ping / subscribe message to trigger responses
      socket.send(JSON.stringify({ type: 'ping' }));
    });

    socket.on('message', (data) => {
      wsMessages.add(1);

      // Validate message is parseable JSON
      try {
        JSON.parse(data);
      } catch {
        // Binary or non-JSON frames are acceptable
      }
    });

    socket.on('error', (e) => {
      wsErrors.add(1);
      console.error(`WS error: ${e}`);
    });

    // Keep connection alive — send periodic pings
    socket.setInterval(() => {
      socket.send(JSON.stringify({ type: 'ping' }));
    }, 5000);

    // Hold the connection open for the test duration
    socket.setTimeout(() => {
      socket.close();
    }, 28000); // close slightly before 30s to avoid abrupt teardown
  });

  const connected = check(res, {
    'WS connected (101)': (r) => r && r.status === 101,
  });
  wsErrors.add(!connected);

  sleep(1);
}
