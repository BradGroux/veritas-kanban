import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { taskRoutes } from './routes/tasks.js';
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
import { settingsRoutes } from './routes/settings.js';
import { getTelemetryService } from './services/telemetry-service.js';
import { initBroadcast } from './services/broadcast-service.js';
import type { AgentOutput } from './services/agent-service.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/tasks', taskRoutes);
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

// Initialize telemetry service (runs retention cleanup)
getTelemetryService().init().catch((err) => {
  console.error('Failed to initialize telemetry service:', err);
});

// Create HTTP server
const server = createServer(app);

// WebSocket server for real-time updates
const wss = new WebSocketServer({ server, path: '/ws' });

// Initialize broadcast service for task change notifications
initBroadcast(wss);

// Track subscriptions: taskId -> Set of WebSocket clients
const agentSubscriptions = new Map<string, Set<WebSocket>>();

wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
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

// Start server
server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════╗
║           Veritas Kanban Server               ║
╠═══════════════════════════════════════════════╣
║  API:        http://localhost:${PORT}            ║
║  WebSocket:  ws://localhost:${PORT}/ws           ║
║  Health:     http://localhost:${PORT}/health     ║
╚═══════════════════════════════════════════════╝
  `);
});
