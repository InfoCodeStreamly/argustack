import pg from 'pg';

const { Pool } = pg;

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Create a PostgreSQL connection pool.
 */
export function createPool(config: DbConfig): pg.Pool {
  return new Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    max: 5,
  });
}
