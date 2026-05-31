import { Request, Response } from 'express';
import { getBoard } from '../services/boardService';
import { Task } from '../types';

export const getTasks = (req: Request, res: Response) => {
  try {
    const board = getBoard();
    const tasks: Task[] = board.tasks;
    
    // Check for duplicate diagnostics
    const warnings: Array<{id: string, source: string, action: string}> = [];
    
    if (board.diagnostics && board.diagnostics.duplicates) {
      for (const [id, sources] of Object.entries(board.diagnostics.duplicates)) {
        warnings.push({
          id,
          source: sources.join(', '),
          action: 'Remove duplicate task definitions'
        });
      }
    }
    
    res.json({
      tasks,
      warnings
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
};