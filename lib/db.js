import pg from "pg";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

pool.on("error", (err) => {
  // A background/idle client errored — log it, don't crash the whole server
  // over one bad connection in the pool.
  console.error("Unexpected Postgres pool error:", err);
});

/** Run a query against the pool. Params are parameterized ($1, $2, ...) to prevent SQL injection. */
export function query(text, params) {
  return pool.query(text, params);
}
