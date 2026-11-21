import { drizzle } from "drizzle-orm/d1";
import type { D1Database } from "./types.ts";

export const getDb = (database: D1Database) => drizzle(database as never);
