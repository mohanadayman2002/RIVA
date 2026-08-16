import { config, assertWhatsAppConfig } from './config.js';
import { createServer } from './server.js';
import { flushNow, describeBackend } from './store.js';

const app = createServer();

// Hosts inject PORT and probe the container from outside, so bind every
// interface rather than just loopback — a container listening on 127.0.0.1
// fails its health check and gets SIGTERMed.
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`\n  ${config.brand.name} — WhatsApp presentation bot`);
  console.log(`  listening on 0.0.0.0:${config.port} (PORT env: ${process.env.PORT ?? 'unset, defaulted'})`);
  console.log(`  public base url: ${config.baseUrl}`);
  console.log(`  webhook:         ${config.baseUrl}/webhook`);
  console.log(`  storage:         ${describeBackend()}`);
  if (config.simulator) console.log(`  test chat:       http://localhost:${config.port}/sim`);

  const missing = assertWhatsAppConfig();
  if (missing.length) {
    console.warn(`\n  ⚠ WhatsApp sending disabled — missing env: ${missing.join(', ')}`);
    console.warn('    The server still runs; outgoing messages are logged instead of sent.\n');
  } else {
    console.log('');
  }
});

let shuttingDown = false;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[${signal}] shutting down…`);

  server.close();
  try {
    await flushNow();
  } catch (err) {
    console.error('[shutdown] flush failed:', err);
  }
  process.exit(0);
}

process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
