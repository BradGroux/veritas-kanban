// Test-only ownership receipt: acknowledge the listener from the exact spawned API process.
import { Server } from 'node:net';
const listen = Server.prototype.listen;
Server.prototype.listen = function (...args) {
  this.once('listening', () => {
    const address = this.address();
    if (address && typeof address !== 'string' && address.port === Number(process.env.PORT))
      process.send?.({ type: 'demo-fixture-bound', pid: process.pid, port: address.port });
  });
  return Reflect.apply(listen, this, args);
};
await import('../server/dist/index.js');
