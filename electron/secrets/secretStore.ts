import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_API_KEY_LENGTH = 4_096;

export type SecretStoreErrorCode =
  | "INVALID_API_KEY"
  | "ENCRYPTION_UNAVAILABLE"
  | "ENCRYPTION_FAILED"
  | "STORAGE_READ_FAILED"
  | "STORAGE_WRITE_FAILED"
  | "STORAGE_DELETE_FAILED"
  | "CORRUPTED_SECRET"
  | "DECRYPTION_FAILED";

export class SecretStoreError extends Error {
  constructor(readonly code: SecretStoreErrorCode, options?: { cause?: unknown }) {
    super(`SecretStore operation failed: ${code}`, { cause: options?.cause });
    this.name = "SecretStoreError";
  }
}

export interface SecretCipher {
  encrypt(plaintext: string): Promise<Buffer>;
  decrypt(ciphertext: Buffer): Promise<string>;
}

export interface SecretStore {
  isConfigured(): Promise<boolean>;
  setApiKey(apiKey: string): Promise<void>;
  deleteApiKey(): Promise<void>;
  /** Main-process internal. Never expose this method through preload or IPC. */
  getApiKey(): Promise<string | null>;
}

interface EncryptedFileSecretStoreOptions {
  filePath: string;
  cipher: SecretCipher;
}

function normalizeApiKey(value: string, stored = false) {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > MAX_API_KEY_LENGTH) {
    throw new SecretStoreError(stored ? "CORRUPTED_SECRET" : "INVALID_API_KEY");
  }
  return normalized;
}

function isMissingFile(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export class EncryptedFileSecretStore implements SecretStore {
  private readonly filePath: string;
  private readonly cipher: SecretCipher;

  constructor(options: EncryptedFileSecretStoreOptions) {
    this.filePath = options.filePath;
    this.cipher = options.cipher;
  }

  async isConfigured() {
    return (await this.getApiKey()) !== null;
  }

  async setApiKey(apiKey: string) {
    const normalized = normalizeApiKey(apiKey);
    let encrypted: Buffer;
    try {
      encrypted = await this.cipher.encrypt(normalized);
    } catch (error) {
      if (error instanceof SecretStoreError) throw error;
      throw new SecretStoreError("ENCRYPTION_FAILED", { cause: error });
    }

    if (
      encrypted.length === 0 ||
      encrypted.equals(Buffer.from(normalized, "utf8"))
    ) {
      throw new SecretStoreError("ENCRYPTION_FAILED");
    }

    const directory = path.dirname(this.filePath);
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(temporaryPath, encrypted, { flag: "wx", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new SecretStoreError("STORAGE_WRITE_FAILED", { cause: error });
    }
  }

  async deleteApiKey() {
    try {
      await unlink(this.filePath);
    } catch (error) {
      if (isMissingFile(error)) return;
      throw new SecretStoreError("STORAGE_DELETE_FAILED", { cause: error });
    }
  }

  async getApiKey() {
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch (error) {
      if (isMissingFile(error)) return null;
      throw new SecretStoreError("STORAGE_READ_FAILED", { cause: error });
    }

    if (encrypted.length === 0) {
      throw new SecretStoreError("CORRUPTED_SECRET");
    }

    let decrypted: string;
    try {
      decrypted = await this.cipher.decrypt(encrypted);
    } catch (error) {
      if (error instanceof SecretStoreError) throw error;
      throw new SecretStoreError("DECRYPTION_FAILED", { cause: error });
    }

    return normalizeApiKey(decrypted, true);
  }
}
