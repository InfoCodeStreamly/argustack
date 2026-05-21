import neo4j, { type Driver, type Session } from 'neo4j-driver';

export interface Neo4jConfig {
  uri: string;
  user: string;
  password: string;
  database?: string;
}

export function createDriver(config: Neo4jConfig): Driver {
  return neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password), {
    maxConnectionPoolSize: 50,
    connectionAcquisitionTimeout: 30_000,
  });
}

export function openSession(driver: Driver, database?: string): Session {
  return database ? driver.session({ database }) : driver.session();
}

export async function verifyConnectivity(driver: Driver): Promise<void> {
  await driver.verifyConnectivity();
}
