/**
 * Keep the network listener behind successful service initialization.
 * A rejected initializer must never expose a partially initialized server.
 */
export async function startAfterInitialization(
  initialize: () => Promise<void>,
  start: () => void
): Promise<void> {
  await initialize();
  start();
}
