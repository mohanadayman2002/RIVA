import { config, assertWhatsAppConfig } from './config.js';
import { createServer } from './server.js';
import { flushNow, describeBackend } from './store.js';

const app = createServer();

const server = app.listen(config.port, () => {
  console.log(`\n  ${config.brand.name} — WhatsApp presentation bot`);
  console.log(`  listening on http://localhost:${config.port}`);
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

async function shutdown(signal) {
  console.log(`\n[${signal}] shutting down…`);
  server.close();
  try {
    await flushNow();
  } catch (err) {
    console.error('[shutdown] flush failed:', err);
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
