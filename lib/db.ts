import { neon, NeonQueryFunction } from '@neondatabase/serverless';

let _sql: NeonQueryFunction<false, false> | null = null;

function getDb(): NeonQueryFunction<false, false> {
  if (!_sql) {
    _sql = neon(process.env.DATABASE_URL!);
  }
  return _sql;
}

const sql = ((...args: Parameters<NeonQueryFunction<false, false>>) =>
  getDb()(...args)) as NeonQueryFunction<false, false>;

export default sql;
