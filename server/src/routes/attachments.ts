import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import multer from 'multer';
import contentDisposition from 'content-disposition';
import { TaskService } from '../services/task-service.js';
import { getAttachmentService } from '../services/attachment-service.js';
import { getTextExtractionService } from '../services/text-extraction-service.js';
import type { Attachment } from '@veritas-kanban/shared';

const router: RouterType = Router();
const taskService = new TaskService();
const attachmentService = getAttachmentService();
const textExtractionService = getTextExtractionService();

// Configure multer for in-memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: attachmentService.getLimits().maxFileSize,
  },
});

/**
 * POST /api/tasks/:id/attachments
 * Upload one or more files
 */
router.post('/:id/attachments', upload.array('files', 20), async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    // Get current task
    const task = await taskService.getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const currentAttachments = task.attachments || [];
    const newAttachments: Attachment[] = [];
    const rejectedFiles: { filename: string; error: string }[] = [];

    // Process each file
    for (const file of files) {
      try {
        // Save attachment (includes magic-byte MIME validation)
        const attachment = await attachmentService.saveAttachment(
          taskId,
          file,
          [...currentAttachments, ...newAttachments]
        );

        // Extract text using the validated MIME type
        const filepath = attachmentService.getAttachmentPath(taskId, attachment.filename);
        const extractedText = await textExtractionService.extractText(filepath, attachment.mimeType);

        // Save extracted text if available
        if (extractedText) {
          await attachmentService.saveExtractedText(taskId, attachment.id, extractedText);
        }

        newAttachments.push(attachment);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Rejected file "${file.originalname}":`, message);
        rejectedFiles.push({ filename: file.originalname, error: message });
        // Continue with other files
      }
    }

    // If ALL files were rejected, return 400
    if (newAttachments.length === 0 && rejectedFiles.length > 0) {
      return res.status(400).json({
        error: 'All files were rejected',
        rejected: rejectedFiles,
      });
    }

    // Update task with new attachments
    const updatedTask = await taskService.updateTask(taskId, {
      attachments: [...currentAttachments, ...newAttachments],
    });

    res.json({
      success: true,
      attachments: newAttachments,
      task: updatedTask,
      // Include rejected files info if some were rejected
      ...(rejectedFiles.length > 0 && { rejected: rejectedFiles }),
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Failed to upload attachments' });
  }
});

/**
 * GET /api/tasks/:id/attachments
 * List all attachments for a task
 */
router.get('/:id/attachments', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;

    const task = await taskService.getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    res.json(task.attachments || []);
  } catch (error) {
    console.error('List attachments error:', error);
    res.status(500).json({ error: 'Failed to list attachments' });
  }
});

/**
 * GET /api/tasks/:id/attachments/:attId
 * Get single attachment metadata
 */
router.get('/:id/attachments/:attId', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const attId = req.params.attId as string;

    const task = await taskService.getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const attachment = (task.attachments || []).find((a: Attachment) => a.id === attId);
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    res.json(attachment);
  } catch (error) {
    console.error('Get attachment error:', error);
    res.status(500).json({ error: 'Failed to get attachment' });
  }
});

/**
 * GET /api/tasks/:id/attachments/:attId/download
 * Download attachment file
 */
router.get('/:id/attachments/:attId/download', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const attId = req.params.attId as string;

    const task = await taskService.getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const attachment = (task.attachments || []).find((a: Attachment) => a.id === attId);
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const filepath = attachmentService.getAttachmentPath(taskId, attachment.filename);
    
    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(attachment.originalName, { type: 'attachment' }));
    res.sendFile(filepath);
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Failed to download attachment' });
  }
});

/**
 * GET /api/tasks/:id/attachments/:attId/text
 * Get extracted text for an attachment
 */
router.get('/:id/attachments/:attId/text', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const attId = req.params.attId as string;

    const task = await taskService.getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const attachment = (task.attachments || []).find((a: Attachment) => a.id === attId);
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    const text = await attachmentService.getExtractedText(taskId, attId);
    
    res.json({
      attachmentId: attId,
      text,
      hasText: text !== null,
    });
  } catch (error) {
    console.error('Get text error:', error);
    res.status(500).json({ error: 'Failed to get extracted text' });
  }
});

/**
 * DELETE /api/tasks/:id/attachments/:attId
 * Delete an attachment
 */
router.delete('/:id/attachments/:attId', async (req: Request, res: Response) => {
  try {
    const taskId = req.params.id as string;
    const attId = req.params.attId as string;

    const task = await taskService.getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const attachment = (task.attachments || []).find((a: Attachment) => a.id === attId);
    if (!attachment) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    // Delete file and extracted text
    await attachmentService.deleteAttachment(taskId, attachment);

    // Update task to remove attachment from metadata
    const updatedAttachments = (task.attachments || []).filter((a: Attachment) => a.id !== attId);
    await taskService.updateTask(taskId, {
      attachments: updatedAttachments,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Delete attachment error:', error);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

export default router;
