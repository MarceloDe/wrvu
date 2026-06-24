// Neon serverless + Drizzle client. The Vercel Neon integration injects
// DATABASE_URL (and POSTGRES_URL) automatically when you connect the database
// to the project. We prefer DATABASE_URL and fall back to POSTGRES_URL.

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!connectionString) {
  // Surfaced clearly at runtime if the Neon integration isn't connected yet.
  console.warn("[db] DATABASE_URL / POSTGRES_URL is not set — connect the Neon integration in Vercel.");
}

const sql = neon(connectionString);
export const db = drizzle(sql, { schema });

export * from "./schema";
