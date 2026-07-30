import dotenv from 'dotenv';
dotenv.config({ override: true });

/**
 * Returns the PostgreSQL connection URL from environment variable DATABASE_URL.
 */
export function getDatabaseUrl(_isAdmin = false): string {
  return process.env.DATABASE_URL || '';
}


