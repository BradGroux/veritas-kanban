import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { taskRoutes } from './routes/tasks.js';
import { taskCommentRoutes } from './routes/task-comments.js';
import { taskSubtaskRoutes } from './routes/task-subtasks.js';
import { taskTimeRoutes } from './routes/task-time.js';
import { taskArchiveRoutes } from './routes/task-archive.js';
import { configRoutes } from './routes/config.js';
import { agentRoutes, agentService } from './routes/agents.js';
import { diffRoutes } from './routes/diff.js';
import { automationRoutes } from './routes/automation.js';
import { summaryRoutes } from './routes/summary.js';
import { notificationRoutes } from './routes/notifications.js';
import templateRoutes from './routes/templates.js';
import taskTypeRoutes from './routes/task-types.js';
import projectRoutes from './routes/projects.js';
import sprintRoutes from './routes/sprints.js';
import activityRoutes from './routes/activity.js';
import githubRoutes from './routes/github.js';
import previewRoutes from './routes/preview.js';
import conflictRoutes from './routes/conflicts.js';
import telemetryRoutes from './routes/telemetry.js';
import metricsRoutes from './routes/metrics.js';
import tracesRoutes from './routes/traces.js';
import attachmentRoutes from './routes/attachments.js';
import { settingsRoutes, syncSettingsToServices } from './routes/settings.js';
import { agentStatusRoutes, initAgentStatus } from './routes/agent-status.js';
import { getTelemetryService } from './services/telemetry-service.js';
import { ConfigService } from './services/config-service.js';
import { initBroadcast } from './services/broadcast-service.js';
import { runStartupMigrations } from './services/migration-service.js';
import { errorHandler } from './middleware/error-handler.js';
import { authenticate, authenticateWebSocket, getAuthStatus, type AuthenticatedWebSocket } from './middleware/auth.js';
import type { AgentOutput } from './services/clawdbot-agent-service.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check (unauthenticated)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Auth status endpoint (unauthenticated - for diagnostics)
app.get('/api/auth/status', (_req, res) => {
  res.json(getAuthStatus());
});

// Apply authentication to all API routes
app.use('/api', authenticate);

// API Routes - Task routes (split for maintainability)
// Archive and time routes must be mounted before main taskRoutes to handle /archived, /time/summary before /:id
app.use('/api/tasks', taskArchiveRoutes);
app.use('/api/tasks', taskTimeRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/tasks', taskCommentRoutes);
app.use('/api/tasks', taskSubtaskRoutes);
app.use('/api/tasks', attachmentRoutes);
app.use('/api/config', configRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/diff', diffRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/summary', summaryRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/task-types', taskTypeRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/sprints', sprintRoutes);
app.use('/api/activity', activityRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/preview', previewRoutes);
app.use('/api/conflicts', conflictRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/metrics', metricsRoutes);
app.use('/api/traces', tracesRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/agent/status', agentStatusRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize services on startup
(async () => {
  try {
    // Run data migrations first (idempotent)
    await runStartupMigrations();
    
    // Initialize telemetry service and sync with feature settings
    const configService = new ConfigService();
    const featureSettings = await configService.getFeatureSettings();
    syncSettingsToServices(featureSettings);
    await getTelemetryService().init();
  } catch (err) {
    console.error('Failed to initialize services:', err);
  }
})();

// Create HTTP server
const server = createServer(app);

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server, path: '/ws' });

// Initialize broadcast service for task change notifications
initBroadcast(wss);

// Initialize agent status service for WebSocket broadcasts
initAgentStatus(wss);

// Track subscriptions: taskId -> Set of WebSocket clients
const agentSubscriptions = new Map<string, Set<WebSocket>>();

wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
  // Authenticate WebSocket connection
  const authResult = authenticateWebSocket(req);
  
  if (!authResult.authenticated) {
    console.log('WebSocket connection rejected: ' + authResult.error);
    ws.close(4001, authResult.error || 'Authentication required');
    return;
  }
  
  // Attach auth info to WebSocket for later use
  ws.auth = {
    role: authResult.role!,
    keyName: authResult.keyName,
    isLocalhost: authResult.isLocalhost,
  };
  
  console.log(`WebSocket client connected (role: ${authResult.role}, localhost: ${authResult.isLocalhost})`);
  
  let subscribedTaskId: string | null = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      // Handle subscription to agent output
      if (message.type === 'subscribe' && message.taskId) {
        // Unsubscribe from previous task
        if (subscribedTaskId) {
          const subs = agentSubscriptions.get(subscribedTaskId);
          if (subs) {
            subs.delete(ws);
            if (subs.size === 0) {
              agentSubscriptions.delete(subscribedTaskId);
            }
          }
        }

        // Subscribe to new task
        const newTaskId: string = message.taskId;
        subscribedTaskId = newTaskId;
        if (!agentSubscriptions.has(newTaskId)) {
          agentSubscriptions.set(newTaskId, new Set());
        }
        agentSubscriptions.get(newTaskId)!.add(ws);

        // Set up listener for agent output
        const emitter = agentService.getAgentEmitter(newTaskId);
        if (emitter) {
          const currentTaskId = newTaskId;
          
          const outputHandler = (output: AgentOutput) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'agent:output',
                taskId: currentTaskId,
                outputType: output.type,
                content: output.content,
                timestamp: output.timestamp,
              }));
            }
          };

          const completeHandler = (result: { code: number; signal: string | null; status: string }) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'agent:complete',
                taskId: currentTaskId,
                ...result,
              }));
            }
          };

          const errorHandler = (error: Error) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: 'agent:error',
                taskId: currentTaskId,
                error: error.message,
              }));
            }
          };

          emitter.on('output', outputHandler);
          emitter.on('complete', completeHandler);
          emitter.on('error', errorHandler);

          // Clean up listeners when WebSocket closes
          ws.on('close', () => {
            emitter.off('output', outputHandler);
            emitter.off('complete', completeHandler);
            emitter.off('error', errorHandler);
          });
        }

        // Send confirmation
        ws.send(JSON.stringify({
          type: 'subscribed',
          taskId: subscribedTaskId,
          running: !!emitter,
        }));
      }
    } catch (error) {
      console.error('WebSocket message error:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    
    // Clean up subscriptions
    if (subscribedTaskId) {
      const subs = agentSubscriptions.get(subscribedTaskId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) {
          agentSubscriptions.delete(subscribedTaskId);
        }
      }
    }
  });
});

// Export for use in other modules
export { wss };

// Graceful shutdown handler
function gracefulShutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  
  // Close WebSocket connections
  console.log('Closing WebSocket connections...');
  wss.clients.forEach((client) => {
    client.close(1000, 'Server shutting down');
  });
  
  // Close HTTP server
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  
  // Force exit after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10000);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start server
server.listen(PORT, () => {
  const authStatus = getAuthStatus();
  const authLine = authStatus.enabled 
    ? `Auth: ON (${authStatus.configuredKeys} keys${authStatus.localhostBypass ? ', localhost bypass' : ''})`
    : 'Auth: OFF (dev mode)';
  
  console.log(`
╔═══════════════════════════════════════════════╗
║           Veritas Kanban Server               ║
╠═══════════════════════════════════════════════╣
║  API:        http://localhost:${PORT}            ║
║  WebSocket:  ws://localhost:${PORT}/ws           ║
║  Health:     http://localhost:${PORT}/health     ║
║  ${authLine.padEnd(42)}║
╚═══════════════════════════════════════════════╝
  `);
});
