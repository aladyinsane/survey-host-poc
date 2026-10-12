import { pool } from "./db";

// Fixed-window counter in Postgres: survives restarts and works across replicas. Used for
// sign-in, where limits protect respondents' inboxes and the code space. Returns true if allowed.
export async function hit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const { rows } = await pool().query(
    `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN rate_limits.window_start <= now() - make_interval(secs => $2)
                    THEN 1 ELSE rate_limits.count + 1 END,
       window_start = CASE WHEN rate_limits.window_start <= now() - make_interval(secs => $2)
                    THEN now() ELSE rate_limits.window_start END
     RETURNING count`,
    [key, windowSeconds],
  );
  return rows[0].count <= limit;
}
