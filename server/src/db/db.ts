import pg from 'pg';

export interface SqlResult<T> {
  rows: T[];
  rowCount: number;
}

export interface SqlClient {
  query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<T>>;
}

export interface Db extends SqlClient {
  withTransaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

function wrapRowCount(result: pg.QueryResult): number {
  return result.rowCount ?? 0;
}

class PgClient implements SqlClient {
  constructor(private readonly client: pg.Pool | pg.PoolClient) {}

  async query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<T>> {
    const result = await this.client.query(text, values as unknown[] | undefined);
    return { rows: result.rows as T[], rowCount: wrapRowCount(result) };
  }
}

/** Production database connection (Supabase Postgres). */
export class PgDb implements Db {
  private readonly pool: pg.Pool;
  private readonly client: PgClient;

  constructor(connectionString: string, options: { ssl?: boolean } = {}) {
    this.pool = new pg.Pool({
      connectionString,
      ssl: options.ssl ? { rejectUnauthorized: true } : undefined,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'insta-automation',
    });
    this.client = new PgClient(this.pool);
  }

  query<T = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<SqlResult<T>> {
    return this.client.query<T>(text, values);
  }

  async withTransaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    const connection = await this.pool.connect();
    const tx = new PgClient(connection);
    try {
      await connection.query('begin');
      const result = await fn(tx);
      await connection.query('commit');
      return result;
    } catch (error) {
      try {
        await connection.query('rollback');
      } catch {
        // The connection may already be broken; the pool discards it below.
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
