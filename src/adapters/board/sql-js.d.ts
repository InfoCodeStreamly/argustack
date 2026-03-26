declare module 'sql.js' {
  const initSqlJs: () => Promise<{
    Database: new () => {
      run(sql: string, params?: unknown[]): void;
      exec(sql: string): { columns: string[]; values: unknown[][] }[];
      close(): void;
    };
  }>;
  export default initSqlJs;
}
