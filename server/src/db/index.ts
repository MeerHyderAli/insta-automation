import type { AppConfig } from '../config/env.js';
import { PgDb } from './db.js';
import { PgStore } from './pgStore.js';
import type { Store } from './store.js';

export function createStore(config: AppConfig): { store: Store; close: () => Promise<void> } {
  if (!config.database.url) {
    throw new Error('DATABASE_URL is required to start the API.');
  }
  const db = new PgDb(config.database.url, { ssl: config.database.ssl });
  return {
    store: new PgStore(db),
    close: async () => {
      await db.close();
    },
  };
}
