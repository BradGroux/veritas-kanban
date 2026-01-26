import { Router, type Router as RouterType } from 'express';
import { AgentService } from '../services/agent-service.js';
import type { AgentType } from '@veritas-kanban/shared';

const router: RouterType = Router();
const agentService = new AgentService();

// POST /api/agents/:taskId/start - Start agent on task
router.post('/:taskId/start', async (req, res) => {
  try {
    const { agent } = req.body as { agent?: AgentType };
    const status = await agentService.startAgent(req.params.taskId, agent);
    res.status(201).json(status);
  } catch (error: any) {
    console.error('Error starting agent:', error);
    res.status(400).json({ error: error.message || 'Failed to start agent' });
  }
});

// POST /api/agents/:taskId/message - Send message to running agent
router.post('/:taskId/message', async (req, res) => {
  try {
    const { message } = req.body as { message: string };
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }
    await agentService.sendMessage(req.params.taskId, message);
    res.json({ sent: true });
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(400).json({ error: error.message || 'Failed to send message' });
  }
});

// POST /api/agents/:taskId/stop - Stop running agent
router.post('/:taskId/stop', async (req, res) => {
  try {
    await agentService.stopAgent(req.params.taskId);
    res.json({ stopped: true });
  } catch (error: any) {
    console.error('Error stopping agent:', error);
    res.status(400).json({ error: error.message || 'Failed to stop agent' });
  }
});

// GET /api/agents/:taskId/status - Get agent status
router.get('/:taskId/status', async (req, res) => {
  try {
    const status = agentService.getAgentStatus(req.params.taskId);
    if (!status) {
      return res.json({ running: false });
    }
    res.json({ running: true, ...status });
  } catch (error: any) {
    console.error('Error getting status:', error);
    res.status(500).json({ error: error.message || 'Failed to get status' });
  }
});

// GET /api/agents/:taskId/attempts - List attempts for task
router.get('/:taskId/attempts', async (req, res) => {
  try {
    const attempts = await agentService.listAttempts(req.params.taskId);
    res.json(attempts);
  } catch (error: any) {
    console.error('Error listing attempts:', error);
    res.status(500).json({ error: error.message || 'Failed to list attempts' });
  }
});

// GET /api/agents/:taskId/attempts/:attemptId/log - Get attempt log
router.get('/:taskId/attempts/:attemptId/log', async (req, res) => {
  try {
    const log = await agentService.getAttemptLog(req.params.taskId, req.params.attemptId);
    res.type('text/markdown').send(log);
  } catch (error: any) {
    console.error('Error getting log:', error);
    res.status(404).json({ error: error.message || 'Log not found' });
  }
});

// Export agent service for WebSocket use
export { router as agentRoutes, agentService };
