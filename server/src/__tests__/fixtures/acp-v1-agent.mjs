import process from 'node:process';
import readline from 'node:readline';

// Stable ACP v1 fixture aligned with @agentclientprotocol/sdk 1.3.0.
const mode = process.argv[2] ?? 'complete';
const buzzMode = mode.startsWith('buzz');
const lines = readline.createInterface({ input: process.stdin });
let activeSessionId;
let pendingPromptId;

function send(record) {
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

function result(id, value = {}) {
  send({ jsonrpc: '2.0', id, result: value });
}

lines.on('line', (line) => {
  const record = JSON.parse(line);
  if (record.method === 'initialize') {
    if (mode === 'malformed') {
      process.stdout.write('{invalid-json\n');
      process.exit(2);
    }
    result(record.id, {
      protocolVersion: 1,
      agentCapabilities: buzzMode
        ? {
            loadSession: false,
            promptCapabilities: { image: false, audio: false, embeddedContext: false },
            mcpCapabilities: { http: false, sse: false },
          }
        : mode === 'no-resume'
          ? { loadSession: false, sessionCapabilities: {} }
          : {
              loadSession: true,
              mcpCapabilities: { http: true, sse: true },
              sessionCapabilities: { resume: {}, fork: {}, close: {} },
            },
      ...(mode === 'no-info'
        ? {}
        : {
            agentInfo: buzzMode
              ? {
                  name: mode === 'buzz-wrong-name' ? 'buzz-acp' : 'buzz-agent',
                  version: mode === 'buzz-wrong-version' ? '0.2.0' : '0.1.0',
                }
              : { name: 'VK ACP fixture', version: '1.3.0' },
          }),
    });
    return;
  }
  if (record.method === 'session/new') {
    activeSessionId = 'session-new';
    result(record.id, { sessionId: activeSessionId });
    return;
  }
  if (record.method === 'session/resume' || record.method === 'session/load') {
    activeSessionId = record.params.sessionId;
    result(record.id);
    return;
  }
  if (record.method === 'session/fork') {
    activeSessionId = 'session-fork';
    result(record.id, { sessionId: activeSessionId });
    return;
  }
  if (record.method === 'session/close') {
    result(record.id);
    return;
  }
  if (record.method === 'session/prompt') {
    pendingPromptId = record.id;
    const updateSessionId = mode === 'wrong-session' ? 'wrong-session' : activeSessionId;
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: updateSessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'ACP fixture response.' },
        },
      },
    });
    if (mode === 'cancel') return;
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: updateSessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'tool-1',
          title: 'Read package.json',
          kind: 'read',
          status: 'pending',
          rawInput: { path: 'package.json' },
        },
      },
    });
    send({
      jsonrpc: '2.0',
      id: 'permission-1',
      method: 'session/request_permission',
      params: {
        sessionId: activeSessionId,
        toolCall: {
          toolCallId: 'tool-1',
          title: 'Read package.json',
          kind: 'read',
          rawInput: { path: 'package.json' },
        },
        options: [
          { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject', name: 'Reject once', kind: 'reject_once' },
        ],
      },
    });
    return;
  }
  if (record.method === 'session/cancel') {
    if (pendingPromptId !== undefined) result(pendingPromptId, { stopReason: 'cancelled' });
    pendingPromptId = undefined;
    return;
  }
  if (record.id === 'permission-1') {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: activeSessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'tool-1',
          title: 'Read package.json',
          kind: 'read',
          status: record.result?.outcome?.outcome === 'selected' ? 'completed' : 'failed',
        },
      },
    });
    result(pendingPromptId, { stopReason: 'end_turn' });
    pendingPromptId = undefined;
  }
});
