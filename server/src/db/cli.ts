import { createPool } from './pool.js';
import { migrate } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const db = createPool(url, 1);
try {
  const applied = await migrate(db, console.log);
  console.log(applied.length ? `done (${applied.length} applied)` : 'up to date');
} finally {
  await db.end();
}
