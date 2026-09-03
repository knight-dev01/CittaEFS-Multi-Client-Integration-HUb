import { PrismaClient } from '@prisma/client';
import { getDatabaseUrl } from '../config/dbConfig';

let singleton: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (singleton) return singleton;
  singleton = new PrismaClient({ datasources: { db: { url: getDatabaseUrl(false) } } });
  return singleton;
}

export const prisma = getPrisma();
