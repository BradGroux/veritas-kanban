import { Command } from 'commander';
import { readBoard, writeBoard } from '../utils/board';
import { Board, Task } from '../types';

export const createCommand = new Command()
  .name('create')
  .description('Create new tasks or businesses')
  .option('-t, --task <task>', 'Create a new task')
  .option('-b, --business <business>', 'Create a new business')
  .action((options) => {
    const board = readBoard();
    
    if (options.task) {
      const newTask: Task = {
        id: options.task.split(':')[0],
        description: options.task.split(':')[1] || '',
        status: 'todo',
        businessId: options.task.split(':')[2] || ''
      };
      
      // Validate no duplicate task IDs
      if (board.tasks.some(task => task.id === newTask.id)) {
        console.error(`Error: Task with ID '${newTask.id}' already exists`);
        process.exit(1);
      }
      
      // Validate business ID exists if specified
      if (newTask.businessId && !board.businesses.some(business => business.id === newTask.businessId)) {
        console.error(`Error: Business with ID '${newTask.businessId}' does not exist`);
        process.exit(1);
      }
      
      board.tasks.push(newTask);
    }
    
    if (options.business) {
      const businessId = options.business;
      
      // Validate no duplicate business IDs
      if (board.businesses.some(business => business.id === businessId)) {
        console.error(`Error: Business with ID '${businessId}' already exists`);
        process.exit(1);
      }
      
      board.businesses.push({ id: businessId });
    }
    
    writeBoard(board);
    console.log('Created successfully');
  });