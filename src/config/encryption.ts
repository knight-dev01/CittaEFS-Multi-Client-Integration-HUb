import crypto from 'crypto';

// AES-256-GCM Encryption Utility for OAuth Tokens and API Credentials
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Recommended IV length for AES-GCM
const AUTH_TAG_LENGTH = 16;

// Secret key should be 32 bytes (256 bits). Uses process.env.ENCRYPTION_SECRET or fallback
function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_SECRET || 'cittaefs_compliance_hub_default_secret_32bytes!!';
  return crypto.scryptSync(secret, 'salt_citta_hub', 32);
}

export interface EncryptedData {
  ciphertext: string; // Hex string
  iv: string;         // Hex string
  authTag: string;    // Hex string
}

/**
 * Encrypts sensitive text (e.g. OAuth Refresh Tokens, Client API Secrets) using AES-256-GCM.
 */
export function encryptSecret(plainText: string): EncryptedData {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    authTag
  };
}

/**
 * Decrypts AES-256-GCM ciphertext using the secret key and auth tag verification.
 */
export function decryptSecret(encryptedData: EncryptedData): string {
  const key = getEncryptionKey();
  const iv = Buffer.from(encryptedData.iv, 'hex');
  const authTag = Buffer.from(encryptedData.authTag, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedData.ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Convenience helper to encrypt to a single formatted string: "iv:authTag:ciphertext"
 */
export function packEncryptedString(plainText: string): string {
  const { ciphertext, iv, authTag } = encryptSecret(plainText);
  return `${iv}:${authTag}:${ciphertext}`;
}

/**
 * Convenience helper to decrypt a packed string: "iv:authTag:ciphertext"
 */
export function unpackAndDecryptString(packed: string): string {
  const parts = packed.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid packed encrypted secret format');
  }
  const [iv, authTag, ciphertext] = parts;
  return decryptSecret({ iv, authTag, ciphertext });
}
