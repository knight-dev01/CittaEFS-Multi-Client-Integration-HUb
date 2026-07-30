import dotenv from 'dotenv';
dotenv.config({ override: true });

const FALLBACK_DB_URL = "postgresql://cittaefs_integration_hub_db_user:J3c5pG8jcXCWRQZiGbxTRR9YPbZnbx3b@dpg-d9lmdb710e5c73e00n20-a.frankfurt-postgres.render.com/cittaefs_integration_hub_db?sslmode=require";

/**
 * Returns the PostgreSQL connection URL from environment variable DATABASE_URL,
 * or fallback Render PostgreSQL database URL if missing/empty.
 */
export function getDatabaseUrl(_isAdmin = false): string {
  const url = process.env.DATABASE_URL?.trim();
  if (url && url.length > 0) {
    return url;
  }
  return FALLBACK_DB_URL;
}



