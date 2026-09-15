import path from "node:path";
import {
  EncryptedFileSecretStore,
  SecretStoreError,
  type SecretCipher,
} from "./secretStore";

export const DEEPSEEK_SECRET_FILENAME = "deepseek-api-key.enc";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  isAsyncEncryptionAvailable(): Promise<boolean>;
  encryptString(plaintext: string): Buffer;
  decryptString(ciphertext: Buffer): string;
  encryptStringAsync(plaintext: string): Promise<Buffer>;
  decryptStringAsync(
    ciphertext: Buffer,
  ): Promise<{ result: string; shouldReEncrypt: boolean }>;
}

export class SafeStorageCipher implements SecretCipher {
  constructor(private readonly safeStorage: SafeStorageLike) {}

  private async canUseAsyncEncryption() {
    try {
      return await this.safeStorage.isAsyncEncryptionAvailable();
    } catch {
      return false;
    }
  }

  private canUseSynchronousEncryption() {
    try {
      return this.safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  async encrypt(plaintext: string) {
    if (await this.canUseAsyncEncryption()) {
      return this.safeStorage.encryptStringAsync(plaintext);
    }
    if (this.canUseSynchronousEncryption()) {
      return this.safeStorage.encryptString(plaintext);
    }
    throw new SecretStoreError("ENCRYPTION_UNAVAILABLE");
  }

  async decrypt(ciphertext: Buffer) {
    if (await this.canUseAsyncEncryption()) {
      return (await this.safeStorage.decryptStringAsync(ciphertext)).result;
    }
    if (this.canUseSynchronousEncryption()) {
      return this.safeStorage.decryptString(ciphertext);
    }
    throw new SecretStoreError("ENCRYPTION_UNAVAILABLE");
  }
}

export function createDeepSeekSecretStore(
  userDataPath: string,
  safeStorage: SafeStorageLike,
) {
  return new EncryptedFileSecretStore({
    filePath: path.join(userDataPath, DEEPSEEK_SECRET_FILENAME),
    cipher: new SafeStorageCipher(safeStorage),
  });
}
