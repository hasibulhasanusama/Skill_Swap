
if (process.env.VERCEL_ENV !== "production") {
  console.log("Production migration skipped outside Vercel Production.");
} else {
  const url = process.env.DATABASE_URL;

  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    throw new Error("Valid Production DATABASE_URL is missing.");
  }

  const {default: pg} = await import("pg");
  const {migrateDatabase} = await import("../server/migrations.js");
  const pool = new pg.Pool({
    connectionString: url,
    connectionTimeoutMillis: 15000
  });

  try {
    const applied = await migrateDatabase(pool);

    console.log(
      applied.length
        ? "Production migrations applied: " + applied.join(", ")
        : "Production database is already up to date."
    );

    const result = await pool.query(
      "SELECT to_regclass('public.arena_materials') AS materials," +
      "to_regclass('public.arena_rooms') AS rooms," +
      "to_regclass('public.exchange_offers') AS offers," +
      "to_regclass('public.learning_session_clocks') AS clocks"
    );

    if (Object.values(result.rows[0]).some(value => !value)) {
      throw new Error("Required production tables are still missing.");
    }

    console.log("Production feature tables verified.");
  } finally {
    await pool.end();
  }
}
