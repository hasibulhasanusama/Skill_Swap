import "dotenv/config";
import pg from "pg";
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
export async function transaction(db, run) {
  const client = db.connect ? await db.connect() : db;
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    if (client !== db) client.release();
  }
}
