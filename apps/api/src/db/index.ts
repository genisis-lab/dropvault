import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// D1 bindings only exist at request time on Workers, so build the client per request.
export function getDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof getDb>;
export { schema };
