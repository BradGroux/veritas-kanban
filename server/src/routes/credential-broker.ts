import { Router } from 'express';
import type { CredentialDefinitionInput } from '@veritas-kanban/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { authorize } from '../middleware/auth.js';
import { validate, type ValidatedRequest } from '../middleware/validate.js';
import {
  credentialDefinitionInputSchema,
  credentialDefinitionParamsSchema,
} from '../schemas/credential-broker-schemas.js';
import { getCredentialBrokerService } from '../services/credential-broker-service.js';

const router = Router();
const credentialBroker = getCredentialBrokerService();

router.use(authorize('admin'));

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await credentialBroker.listDefinitions());
  })
);

router.get(
  '/:id',
  validate({ params: credentialDefinitionParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<{ id: string }>, res) => {
    const { id } = req.validated.params as { id: string };
    const definition = await credentialBroker.getDefinition(id);
    if (!definition) {
      res.status(404).json({ error: 'Credential definition not found' });
      return;
    }
    res.json(definition);
  })
);

router.post(
  '/',
  validate({ body: credentialDefinitionInputSchema }),
  asyncHandler(async (req: ValidatedRequest<unknown, unknown, CredentialDefinitionInput>, res) => {
    const definition = await credentialBroker.createDefinition(
      req.validated.body as CredentialDefinitionInput
    );
    res.status(201).json(definition);
  })
);

router.put(
  '/:id',
  validate({
    params: credentialDefinitionParamsSchema,
    body: credentialDefinitionInputSchema,
  }),
  asyncHandler(
    async (req: ValidatedRequest<{ id: string }, unknown, CredentialDefinitionInput>, res) => {
      const { id } = req.validated.params as { id: string };
      res.json(
        await credentialBroker.updateDefinition(id, req.validated.body as CredentialDefinitionInput)
      );
    }
  )
);

router.delete(
  '/:id',
  validate({ params: credentialDefinitionParamsSchema }),
  asyncHandler(async (req: ValidatedRequest<{ id: string }>, res) => {
    const { id } = req.validated.params as { id: string };
    await credentialBroker.deleteDefinition(id);
    res.json({ deleted: id });
  })
);

export default router;
