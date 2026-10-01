import { Pool } from "pg";
import { env } from "./env";

const g = globalThis as unknown as { __pool?: Pool };

export function pool(): Pool {
  return (g.__pool ??= new Pool({ connectionString: env().DATABASE_URL, max: 10 }));
}
