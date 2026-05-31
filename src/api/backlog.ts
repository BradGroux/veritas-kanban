import { Request, Response } from 'express';
import { BacklogItem, BacklogWarning } from '../types/backlog';
import { getBacklogItems } from '../services/backlogService';

export const getBacklog = async (req: Request, res: Response): Promise<void> => {
  try {
    const items: BacklogItem[] = await getBacklogItems();
    
    // Check for duplicate IDs and generate warnings
    const idCounts = new Map<string, number>();
    const warnings: BacklogWarning[] = [];
    
    items.forEach(item => {
      const count = idCounts.get(item.id) || 0;
      idCounts.set(item.id, count + 1);
    });
    
    idCounts.forEach((count, id) => {
      if (count > 1) {
        warnings.push({
          type: 'DUPLICATE_ID',
          itemId: id,
          message: `Item with ID ${id} appears ${count} times in backlog`
        });
      }
    });
    
    res.json({
      items,
      warnings
    });
  } catch (error) {
    console.error('Error fetching backlog:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};