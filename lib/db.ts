import { neon, NeonQueryFunction } from '@neondatabase/serverless';

let _sql: NeonQueryFunction<false, false> | null = null;

function getDb(): NeonQueryFunction<false, false> {
  if (!_sql) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    _sql = neon(process.env.DATABASE_URL);
  }
  return _sql;
}

// Proxy that lazily initializes the connection
const sql = new Proxy({} as NeonQueryFunction<false, false>, {
  apply(_target, _thisArg, args) {
    const db = getDb();
    return (db as unknown as (...a: unknown[]) => unknown)(...args);
  },
  get(_target, prop) {
    const db = getDb();
    return (db as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export default sql;
