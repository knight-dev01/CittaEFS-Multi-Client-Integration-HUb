import crypto from 'crypto';

// AES-256-GCM Encryption Utility for OAuth Tokens and API Credentials
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Recommended IV length for AES-GCM
const AUTH_TAG_LENGTH = 16;

// Secret key should be 32 bytes (256 bits). Supports ENCRYPTION_KEY (hex 32 bytes) and ENCRYPTION_SECRET (passphrase)
let _cachedEphemeralKey: Buffer | null = null;
function getEncryptionKey(): Buffer {
  const rawKey = process.env.ENCRYPTION_KEY?.trim() || process.env.ENCRYPTION_SECRET?.trim();
  if (!rawKey) {
    if (process.env.NODE_ENV === "production") {
      if (!_cachedEphemeralKey) {
        const gen = crypto.randomBytes(32);
        console.warn(`[Security] ENCRYPTION_KEY not set — generated ephemeral 32-byte key ${gen.toString('hex').slice(0,8)}... for this boot. Set ENCRYPTION_KEY in Render/Vercel env to persist across restarts (existing encrypted data will be re-encrypted on next write).`);
        _cachedEphemeralKey = gen;
      }
      return _cachedEphemeralKey;
    }
    console.warn("[Security Warning] ENCRYPTION_KEY/ENCRYPTION_SECRET not set — using insecure dev value. Set ENCRYPTION_KEY for production.");
    return crypto.scryptSync("cittaefs_compliance_hub_default_secret_32bytes!!_dev_only", "salt_citta_hub", 32);
  }
  // If 64 hex chars (32 bytes), use directly; otherwise derive via scrypt
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }
  return crypto.scryptSync(rawKey, "salt_citta_hub", 32);
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
