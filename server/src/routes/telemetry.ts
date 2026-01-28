import { Router, type Router as RouterType } from 'express';
import { getTelemetryService } from '../services/telemetry-service.js';
import { broadcastTelemetryEvent } from '../services/broadcast-service.js';
import { getFailureAlertService } from '../services/failure-alert-service.js';
import { getTaskService } from '../services/task-service.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import type { TelemetryQueryOptions, AnyTelemetryEvent } from '@veritas-kanban/shared';
import {
  TelemetryEventsQuerySchema,
  TelemetryTaskParamsSchema,
  TelemetryCountQuerySchema,
  TelemetryEventIngestionSchema,
  TelemetryBulkQuerySchema,
  TelemetryExportQuerySchema,
  type TelemetryEventsQuery,
  type TelemetryTaskParams,
  type TelemetryCountQuery,
  type TelemetryEventIngestion,
  type TelemetryBulkQuery,
  type TelemetryExportQuery,
} from '../schemas/telemetry-schemas.js';

const router: RouterType = Router();

// ============ POST Endpoint - Event Ingestion ============

/**
 * POST /api/telemetry/events
 * Ingest telemetry events from external sources (Veritas, Clawdbot, etc.)
 * 
 * Accepts: run.started, run.completed, run.error, run.tokens events
 * 
 * Request body:
 *   - type: Event type (required)
 *   - taskId: Task ID this event relates to (required)
 *   - agent: Agent name/type (required)
 *   - ...type-specific fields
 * 
 * Response: The created event with generated id and timestamp
 */
router.post(
  '/events',
  validate({ body: TelemetryEventIngestionSchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, unknown, TelemetryEventIngestion>, res) => {
    const telemetry = getTelemetryService();
    const eventInput = req.validated.body!;
    
    // Emit the event (adds id and timestamp)
    const event = await telemetry.emit(eventInput);
    
    // Broadcast to WebSocket clients
    broadcastTelemetryEvent(event as AnyTelemetryEvent);
    
    // Check for failure events and send alerts (non-blocking)
    const failureAlertService = getFailureAlertService();
    if (failureAlertService.isFailureEvent(eventInput)) {
      // Look up task title asynchronously (don't block response)
      (async () => {
        try {
          let taskTitle: string | undefined;
          try {
            const taskService = getTaskService();
            const task = await taskService.getTask(eventInput.taskId);
            taskTitle = task?.title;
          } catch {
            // Task not found is fine, we'll use taskId
          }
          
          await failureAlertService.processEvent(eventInput, taskTitle);
        } catch (err) {
          // Graceful failure: log but don't crash
          console.error('[Telemetry] Failure alert error:', err);
        }
      })();
    }
    
    res.status(201).json(event);
  })
);

// ============ GET Endpoints ============

/**
 * GET /api/telemetry/events
 * Query telemetry events with optional filters
 */
router.get(
  '/events',
  validate({ query: TelemetryEventsQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, TelemetryEventsQuery>, res) => {
    const telemetry = getTelemetryService();
    const { type, since, until, taskId, project, limit } = req.validated.query!;
    
    const options: TelemetryQueryOptions = {};
    
    if (type && type.length > 0) {
      options.type = type.length === 1 ? type[0] : type;
    }
    if (since) options.since = since;
    if (until) options.until = until;
    if (taskId) options.taskId = taskId;
    if (project) options.project = project;
    if (limit) options.limit = limit;
    
    const events = await telemetry.getEvents(options);
    res.json(events);
  })
);

/**
 * GET /api/telemetry/events/task/:taskId
 * Get all events for a specific task
 */
router.get(
  '/events/task/:taskId',
  validate({ params: TelemetryTaskParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<TelemetryTaskParams>, res) => {
    const telemetry = getTelemetryService();
    const { taskId } = req.validated.params!;
    const events = await telemetry.getTaskEvents(taskId);
    res.json(events);
  })
);

/**
 * POST /api/telemetry/events/bulk
 * Get events for multiple tasks in one request (batch query)
 * 
 * Returns: { [taskId]: events[] }
 */
router.post(
  '/events/bulk',
  validate({ body: TelemetryBulkQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, unknown, TelemetryBulkQuery>, res) => {
    const telemetry = getTelemetryService();
    const { taskIds } = req.validated.body!;
    
    const eventsMap = await telemetry.getBulkTaskEvents(taskIds);
    
    // Convert Map to plain object for JSON response
    const result: Record<string, AnyTelemetryEvent[]> = {};
    for (const [taskId, events] of eventsMap) {
      result[taskId] = events;
    }
    
    res.json(result);
  })
);

/**
 * GET /api/telemetry/status
 * Get telemetry service status and configuration
 */
router.get('/status', asyncHandler(async (_req, res) => {
  const telemetry = getTelemetryService();
  const config = telemetry.getConfig();
  
  res.json({
    enabled: config.enabled,
    retention: config.retention,
    traces: config.traces,
  });
}));

/**
 * GET /api/telemetry/count
 * Count events by type within a time period
 */
router.get(
  '/count',
  validate({ query: TelemetryCountQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, TelemetryCountQuery>, res) => {
    const telemetry = getTelemetryService();
    const { type, since, until } = req.validated.query!;
    
    const count = await telemetry.countEvents(
      type.length === 1 ? type[0] : type,
      since,
      until
    );
    
    res.json({ count });
  })
);

/**
 * GET /api/telemetry/export
 * Export telemetry events as CSV or JSON file download
 * 
 * Query params:
 *   - format: 'csv' | 'json' (default: 'json')
 *   - taskId: Filter by specific task
 *   - project: Filter by project name
 *   - from: Start date (ISO timestamp)
 *   - to: End date (ISO timestamp)
 * 
 * Response: File download with appropriate Content-Disposition header
 */
router.get(
  '/export',
  validate({ query: TelemetryExportQuerySchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, TelemetryExportQuery>, res) => {
    const telemetry = getTelemetryService();
    const { format, taskId, project, from, to } = req.validated.query!;
    
    // Build query options
    const options: TelemetryQueryOptions = {};
    if (taskId) options.taskId = taskId;
    if (project) options.project = project;
    if (from) options.since = from;
    if (to) options.until = to;
    
    // Generate filename with scope and date info
    const scopeParts: string[] = ['telemetry'];
    if (taskId) scopeParts.push(`task-${taskId}`);
    else if (project) scopeParts.push(`project-${project.replace(/[^a-zA-Z0-9-_]/g, '_')}`);
    else scopeParts.push('full');
    
    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `${scopeParts.join('-')}-${dateStr}.${format}`;
    
    if (format === 'csv') {
      const csvData = await telemetry.exportAsCsv(options);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(csvData);
    } else {
      const jsonData = await telemetry.exportAsJson(options);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(jsonData);
    }
  })
);

export default router;
