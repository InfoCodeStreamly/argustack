/**
 * Unit tests for setupDbFromFlags and setupDbInteractive.
 *
 * The knex, @inquirer/prompts, ora, and chalk modules are mocked at the
 * module boundary. parseConnectionString and tryConnect are exercised
 * indirectly through the exported functions. autoDetectEngine is exercised
 * via setupDbManual, which is reachable when the password prompt returns empty.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPasswordFn = vi.fn();
const mockInputFn = vi.fn();

vi.mock('@inquirer/prompts', () => ({
  password: mockPasswordFn,
  input: mockInputFn,
}));

const mockSpinner = {
  start: vi.fn().mockReturnThis(),
  succeed: vi.fn().mockReturnThis(),
  fail: vi.fn().mockReturnThis(),
};

vi.mock('ora', () => ({
  default: vi.fn(() => mockSpinner),
}));

vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    dim: (s: string) => s,
    red: (s: string) => s,
    green: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

const mockDbRaw = vi.fn();
const mockDbDestroy = vi.fn();
const mockKnexInstance = {
  raw: mockDbRaw,
  destroy: mockDbDestroy,
};
const mockKnexFn = vi.fn(() => mockKnexInstance);

vi.mock('knex', () => ({
  default: mockKnexFn,
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let setupDbFromFlags: typeof import('../../../../src/cli/init/setup-db.js').setupDbFromFlags;
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
let setupDbInteractive: typeof import('../../../../src/cli/init/setup-db.js').setupDbInteractive;

beforeEach(async () => {
  vi.clearAllMocks();
  mockDbRaw.mockResolvedValue(undefined);
  mockDbDestroy.mockResolvedValue(undefined);
  const module = await import('../../../../src/cli/init/setup-db.js');
  setupDbFromFlags = module.setupDbFromFlags;
  setupDbInteractive = module.setupDbInteractive;
});

// ─── setupDbFromFlags ──────────────────────────────────────────────────────

describe('setupDbFromFlags', () => {
  it('throws when targetDbHost is missing', () => {
    expect(() => setupDbFromFlags({ targetDbUser: 'user', targetDbName: 'db' }))
      .toThrow('Database requires: --target-db-host, --target-db-user, --target-db-name');
  });

  it('throws when targetDbUser is missing', () => {
    expect(() => setupDbFromFlags({ targetDbHost: 'localhost', targetDbName: 'db' }))
      .toThrow('Database requires: --target-db-host, --target-db-user, --target-db-name');
  });

  it('throws when targetDbName is missing', () => {
    expect(() => setupDbFromFlags({ targetDbHost: 'localhost', targetDbUser: 'user' }))
      .toThrow('Database requires: --target-db-host, --target-db-user, --target-db-name');
  });

  it('defaults engine to postgresql when not specified', () => {
    const result = setupDbFromFlags({
      targetDbHost: 'localhost',
      targetDbUser: 'user',
      targetDbName: 'mydb',
    });
    expect(result?.targetDbEngine).toBe('postgresql');
  });

  it('defaults port to 5432 when not specified', () => {
    const result = setupDbFromFlags({
      targetDbHost: 'localhost',
      targetDbUser: 'user',
      targetDbName: 'mydb',
    });
    expect(result?.targetDbPort).toBe(5432);
  });

  it('defaults password to empty string when not specified', () => {
    const result = setupDbFromFlags({
      targetDbHost: 'localhost',
      targetDbUser: 'user',
      targetDbName: 'mydb',
    });
    expect(result?.targetDbPassword).toBe('');
  });

  it('uses provided engine, port, and password', () => {
    const result = setupDbFromFlags({
      targetDbHost: 'prod.db.com',
      targetDbUser: 'readonly',
      targetDbName: 'appdb',
      targetDbEngine: 'mysql',
      targetDbPort: '3306',
      targetDbPassword: 'secret',
    });

    expect(result?.targetDbEngine).toBe('mysql');
    expect(result?.targetDbPort).toBe(3306);
    expect(result?.targetDbPassword).toBe('secret');
  });

  it('returns DbSetupResult with all provided fields', () => {
    const result = setupDbFromFlags({
      targetDbHost: 'db.example.com',
      targetDbUser: 'admin',
      targetDbName: 'production',
      targetDbEngine: 'postgresql',
      targetDbPort: '5432',
      targetDbPassword: 'p@ss',
    });

    expect(result).toMatchObject({
      targetDbEngine: 'postgresql',
      targetDbHost: 'db.example.com',
      targetDbPort: 5432,
      targetDbUser: 'admin',
      targetDbPassword: 'p@ss',
      targetDbName: 'production',
    });
  });
});

// ─── setupDbInteractive: parseConnectionString path ───────────────────────

describe('setupDbInteractive (connection string path)', () => {
  it('parses postgresql connection string and connects successfully', async () => {
    mockPasswordFn.mockResolvedValueOnce('postgresql://admin:secret@db.example.com:5432/mydb');
    mockDbRaw.mockResolvedValue(undefined);

    const result = await setupDbInteractive();

    expect(result).not.toBeNull();
    expect(result?.targetDbEngine).toBe('postgresql');
    expect(result?.targetDbHost).toBe('db.example.com');
    expect(result?.targetDbPort).toBe(5432);
    expect(result?.targetDbUser).toBe('admin');
    expect(result?.targetDbPassword).toBe('secret');
    expect(result?.targetDbName).toBe('mydb');
  });

  it('parses mysql connection string correctly', async () => {
    mockPasswordFn.mockResolvedValueOnce('mysql://root:pass@127.0.0.1:3306/appdb');
    mockDbRaw.mockResolvedValue(undefined);

    const result = await setupDbInteractive();

    expect(result?.targetDbEngine).toBe('mysql');
    expect(result?.targetDbPort).toBe(3306);
    expect(result?.targetDbName).toBe('appdb');
  });

  it('uses SSL when host is not localhost', async () => {
    mockPasswordFn.mockResolvedValueOnce('postgresql://user:pass@remote.db.com:5432/db');
    mockDbRaw.mockResolvedValue(undefined);

    await setupDbInteractive();

    const [knexConfig] = mockKnexFn.mock.calls[0] as [{
      connection: { ssl: { rejectUnauthorized: boolean } | false };
    }];
    expect(knexConfig.connection.ssl).toMatchObject({ rejectUnauthorized: false });
  });

  it('disables SSL when host is localhost', async () => {
    mockPasswordFn.mockResolvedValueOnce('postgresql://user:pass@localhost:5432/db');
    mockDbRaw.mockResolvedValue(undefined);

    await setupDbInteractive();

    const [knexConfig] = mockKnexFn.mock.calls[0] as [{
      connection: { ssl: boolean };
    }];
    expect(knexConfig.connection.ssl).toBe(false);
  });

  it('falls through to manual entry when connection string fails to parse', async () => {
    mockPasswordFn
      .mockResolvedValueOnce('not-a-valid-connection-string')
      .mockResolvedValueOnce('mypass');
    mockInputFn
      .mockResolvedValueOnce('localhost')
      .mockResolvedValueOnce('5432')
      .mockResolvedValueOnce('user')
      .mockResolvedValueOnce('mydb');
    mockDbRaw.mockResolvedValue(undefined);

    const result = await setupDbInteractive();

    expect(mockInputFn).toHaveBeenCalled();
    expect(result).not.toBeNull();
  });

  it('falls through to manual entry when connection to parsed string fails', async () => {
    mockPasswordFn
      .mockResolvedValueOnce('postgresql://user:wrong@host:5432/db')
      .mockResolvedValueOnce('newpass');
    mockDbRaw
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce(undefined);
    mockInputFn
      .mockResolvedValueOnce('localhost')
      .mockResolvedValueOnce('5432')
      .mockResolvedValueOnce('user')
      .mockResolvedValueOnce('db');

    const result = await setupDbInteractive();

    expect(mockSpinner.fail).toHaveBeenCalledWith('Connection failed');
    expect(result).not.toBeNull();
  });

  it('falls through to manual entry when password prompt is empty', async () => {
    mockPasswordFn
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('pass');
    mockInputFn
      .mockResolvedValueOnce('localhost')
      .mockResolvedValueOnce('5432')
      .mockResolvedValueOnce('user')
      .mockResolvedValueOnce('mydb');
    mockDbRaw.mockResolvedValue(undefined);

    const result = await setupDbInteractive();

    expect(mockInputFn).toHaveBeenCalled();
    expect(result).not.toBeNull();
  });
});

// ─── setupDbInteractive: manual entry path ────────────────────────────────

describe('setupDbInteractive (manual entry path)', () => {
  it('returns null when all engine auto-detect attempts fail', async () => {
    mockPasswordFn
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('badpass');
    mockInputFn
      .mockResolvedValueOnce('unreachable.host')
      .mockResolvedValueOnce('5432')
      .mockResolvedValueOnce('user')
      .mockResolvedValueOnce('db');
    mockDbRaw.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await setupDbInteractive();

    expect(result).toBeNull();
    expect(mockSpinner.fail).toHaveBeenCalledWith('Could not connect to any supported database');
  });

  it('uses port-based engine detection for port 3306', async () => {
    mockPasswordFn
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('pass');
    mockInputFn
      .mockResolvedValueOnce('localhost')
      .mockResolvedValueOnce('3306')
      .mockResolvedValueOnce('root')
      .mockResolvedValueOnce('appdb');
    mockDbRaw.mockResolvedValue(undefined);

    const result = await setupDbInteractive();

    expect(result?.targetDbEngine).toBe('mysql');
  });

  it('uses port-based engine detection for port 5432', async () => {
    mockPasswordFn
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce('pass');
    mockInputFn
      .mockResolvedValueOnce('localhost')
      .mockResolvedValueOnce('5432')
      .mockResolvedValueOnce('pguser')
      .mockResolvedValueOnce('pgdb');
    mockDbRaw.mockResolvedValue(undefined);

    const result = await setupDbInteractive();

    expect(result?.targetDbEngine).toBe('postgresql');
  });
});
