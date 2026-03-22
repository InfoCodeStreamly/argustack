import type { Knex } from 'knex';
import knex from 'knex';
import type { DbEngine } from '../../core/types/database.js';

const STATEMENT_TIMEOUT_MS = 30_000;
const POOL_IDLE_TIMEOUT_MS = 10_000;

export interface DbConnectionConfig {
  engine: DbEngine;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  name: string;
}

const ENGINE_TO_KNEX_CLIENT: Record<DbEngine, string> = {
  postgresql: 'pg',
  mysql: 'mysql2',
  mssql: 'tedious',
  sqlite: 'better-sqlite3',
  oracledb: 'oracledb',
};

function buildAfterCreate(engine: DbEngine) {
  return function afterCreate(
    conn: { query: (sql: string, cb: (err: unknown) => void) => void },
    done: (err: unknown, conn: unknown) => void,
  ): void {
    if (engine === 'postgresql') {
      conn.query('SET default_transaction_read_only = true', (err) => {
        if (err) {
          done(err, conn);
          return;
        }
        conn.query(`SET statement_timeout = '${String(STATEMENT_TIMEOUT_MS)}'`, (err2) => {
          done(err2, conn);
        });
      });
    } else if (engine === 'mysql') {
      conn.query('SET SESSION TRANSACTION READ ONLY', (err) => {
        if (err) {
          done(err, conn);
          return;
        }
        conn.query(`SET SESSION max_execution_time = ${String(STATEMENT_TIMEOUT_MS)}`, (err2) => {
          done(err2, conn);
        });
      });
    } else {
      done(null, conn);
    }
  };
}

export function createKnexClient(config: DbConnectionConfig): Knex {
  const client = ENGINE_TO_KNEX_CLIENT[config.engine];

  if (config.engine === 'sqlite') {
    return knex({
      client,
      connection: { filename: config.database, options: { readonly: true } },
      useNullAsDefault: true,
      pool: { min: 0, max: 1 },
    });
  }

  return knex({
    client,
    connection: {
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.host !== 'localhost' && config.host !== '127.0.0.1'
        ? { rejectUnauthorized: false }
        : false,
    },
    pool: {
      min: 0,
      max: 2,
      idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
      afterCreate: buildAfterCreate(config.engine),
    },
  });
}
