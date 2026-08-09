import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { openDatabase } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { seedDatabase } from './db/seed.js';
import { createLogger } from './lib/logger.js';

/**
 * Process entry point: migrate, optionally seed, listen, and shut down cleanly.
 *
 * Migrating on boot rather than in a separate deploy step is a deliberate simplification for a
 * single-writer SQLite application — there is exactly one process that can hold the write lock,
 * so there is no migration race to lose.
 */

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.LOG_LEVEL);

  const db = openDatabase(config.DATABASE_PATH);
  const schemaVersion = runMigrations(db);
  logger.info('database ready', { path: config.DATABASE_PATH, schemaVersion });

  if (config.SEED_ON_BOOT) {
    const seeded = seedDatabase(db);
    logger.info(
      seeded.seeded ? 'seeded demo data' : 'existing data found, skipping seed',
      { alerts: seeded.alerts },
    );
  }

  const { app } = createApp({ db, config, logger });

  const server = app.listen(config.PORT, config.HOST, () => {
    logger.info('api listening', {
      url: `http://${config.HOST}:${config.PORT}`,
      environment: config.NODE_ENV,
      aiEnabled: config.AI_ENABLED,
      model: config.OLLAMA_MODEL,
    });
  });

  const shutdown = (signal: string): void => {
    logger.info('shutting down', { signal });
    server.close(() => {
      // Closing the database last checkpoints the WAL, so the next boot does not have to
      // replay it and the file left on the volume is complete.
      db.close();
      process.exit(0);
    });
    // Never hang a container restart on a connection that will not drain.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error: unknown) => {
  process.stderr.write(
    `Failed to start: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
