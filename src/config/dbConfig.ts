import 'dotenv/config';

/**
 * Constructs the connection URL for the Cloud SQL PostgreSQL instance or fallbacks.
 * Uses SQL_ADMIN_USER when isAdmin is true (for migrations/schema push).
 */
export function getDatabaseUrl(isAdmin = false): string {
  if (process.env.SQL_HOST) {
    const user = isAdmin ? process.env.SQL_ADMIN_USER : process.env.SQL_USER;
    const password = isAdmin ? process.env.SQL_ADMIN_PASSWORD : process.env.SQL_PASSWORD;
    if (user && password) {
      const encUser = encodeURIComponent(user);
      const encPass = encodeURIComponent(password);
      const encDb = encodeURIComponent(process.env.SQL_DB_NAME || 'cloud_sql_development_database');
      const host = process.env.SQL_HOST;
      return `postgresql://${encUser}:${encPass}@localhost/${encDb}?host=${host}`;
    }
  }
  
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  return '';
}
