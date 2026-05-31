import { Command } from 'commander';
import { readConfig } from '../config';
import { Card, loadCards, saveCards } from '../card';
import { validateCard } from '../validation';
import { logger } from '../logger';

export function promoteCommand(program: Command) {
  program
    .command('promote <id>')
    .description('Promote a card to the next stage')
    .action(async (id: string) => {
      try {
        const config = readConfig();
        const cards = loadCards(config.paths.cards);
        
        // Find the card to promote
        const cardIndex = cards.findIndex(card => card.id === id);
        if (cardIndex === -1) {
          logger.error(`Card with ID ${id} not found`);
          process.exit(1);
        }
        
        const card = cards[cardIndex];
        
        // Validate card before promotion
        const validationError = validateCard(card);
        if (validationError) {
          logger.error(`Validation error: ${validationError}`);
          process.exit(1);
        }
        
        // Check for duplicate ID conflicts before promotion
        const targetPath = config.paths.nextStage;
        const targetCards = loadCards(targetPath);
        
        const duplicateCard = targetCards.find(targetCard => targetCard.id === card.id);
        if (duplicateCard) {
          const error = {
            message: 'Duplicate ID conflict detected',
            cardId: card.id,
            sourcePath: config.paths.cards,
            targetPath: targetPath,
            conflictingCard: duplicateCard
          };
          logger.error(`Promotion failed: ${error.message}`);
          logger.error(`Card ID: ${error.cardId}`);
          logger.error(`Source Path: ${error.sourcePath}`);
          logger.error(`Target Path: ${error.targetPath}`);
          process.exit(1);
        }
        
        // Perform promotion
        targetCards.push(card);
        saveCards(targetCards, targetPath);
        
        // Remove from current stage
        cards.splice(cardIndex, 1);
        saveCards(cards, config.paths.cards);
        
        logger.info(`Card ${id} promoted successfully`);
      } catch (error) {
        logger.error('Failed to promote card:', error);
        process.exit(1);
      }
    });
}
