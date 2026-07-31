import dotenv from 'dotenv';
dotenv.config({ override: true });

/**
 * Returns the PostgreSQL connection URL from environment variable DATABASE_URL.
 * Fails loudly at startup if DATABASE_URL is missing or empty.
 */
export function getDatabaseUrl(_isAdmin = false): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || url.length === 0) {
    throw new Error('DATABASE_URL environment variable is required and cannot be empty.');
  }
  return url;
}




