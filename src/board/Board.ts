import { Task } from './Task';
import { Business } from './Business';
import { Card } from './Card';
import { Diagnostics } from './Diagnostics';

export class Board {
  public active: Card[] = [];
  public backlog: Card[] = [];
  public archive: Card[] = [];
  public diagnostics: Diagnostics = new Diagnostics();

  constructor() {}

  public loadBoard(data: any): void {
    // Load cards into respective arrays
    this.active = data.active?.map((card: any) => new Card(card)) || [];
    this.backlog = data.backlog?.map((card: any) => new Card(card)) || [];
    this.archive = data.archive?.map((card: any) => new Card(card)) || [];

    // Validate for duplicate IDs
    this.validateDuplicateIds();
  }

  private validateDuplicateIds(): void {
    const taskIdMap = new Map<string, string>(); // taskId -> sourceFile
    const businessIdMap = new Map<string, string>(); // businessId -> sourceFile
    
    const allCards = [...this.active, ...this.backlog, ...this.archive];
    
    for (const card of allCards) {
      // Check for duplicate task IDs
      if (taskIdMap.has(card.task.id)) {
        this.diagnostics.addDuplicateTaskId(card.task.id, taskIdMap.get(card.task.id)!, card.sourceFile);
      } else {
        taskIdMap.set(card.task.id, card.sourceFile);
      }
      
      // Check for duplicate business IDs
      if (businessIdMap.has(card.business.id)) {
        this.diagnostics.addDuplicateBusinessId(card.business.id, businessIdMap.get(card.business.id)!, card.sourceFile);
      } else {
        businessIdMap.set(card.business.id, card.sourceFile);
      }
    }
  }
}