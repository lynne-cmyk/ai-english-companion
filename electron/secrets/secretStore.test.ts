import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  EncryptedFileSecretStore,
  SecretStoreError,
  type SecretCipher,
} from "./secretStore";
import {
  DEEPSEEK_SECRET_FILENAME,
  SafeStorageCipher,
  createDeepSeekSecretStore,
  type SafeStorageLike,
} from "./safeStorageCipher";

class TestCipher implements SecretCipher {
  encryptions: string[] = [];

  async encrypt(plaintext: string) {
    this.encryptions.push(plaintext);
    return Buffer.from(`cipher:${Buffer.from(plaintext).toString("base64")}`);
  }

  async decrypt(ciphertext: Buffer) {
    const value = ciphertext.toString("utf8");
    if (!value.startsWith("cipher:")) throw new Error("invalid ciphertext");
    return Buffer.from(value.slice(7), "base64").toString("utf8");
  }
}

async function temporaryStore(t: test.TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-companion-secret-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "user-data", DEEPSEEK_SECRET_FILENAME);
  const cipher = new TestCipher();
  return {
    directory,
    filePath,
    cipher,
    store: new EncryptedFileSecretStore({ filePath, cipher }),
  };
}

test("missing, save, internal read, replace, and delete lifecycle stays encrypted", async (t) => {
  const { filePath, cipher, store } = await temporaryStore(t);
  const firstKey = "test-secret-first";
  const replacementKey = "test-secret-replacement";

  assert.equal(await store.isConfigured(), false);
  await store.setApiKey(`  ${firstKey}  `);
  assert.deepEqual(cipher.encryptions, [firstKey]);
  const firstStoredValue = await readFile(filePath);
  assert.equal(firstStoredValue.includes(Buffer.from(firstKey)), false);
  assert.equal(await store.isConfigured(), true);
  assert.equal(await store.getApiKey(), firstKey);

  await store.setApiKey(replacementKey);
  assert.equal(await store.getApiKey(), replacementKey);
  assert.equal((await readFile(filePath)).includes(Buffer.from(firstKey)), false);

  await store.deleteApiKey();
  assert.equal(await store.isConfigured(), false);
  await store.deleteApiKey();
});

test("factory keeps ciphertext under the supplied userData directory", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-companion-user-data-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const safeStorage = testSafeStorage();
  const store = createDeepSeekSecretStore(directory, safeStorage.value);

  await store.setApiKey("test-user-data-key");
  const expectedPath = path.join(directory, DEEPSEEK_SECRET_FILENAME);
  assert.equal((await readFile(expectedPath)).toString().startsWith("async:"), true);
});

test("invalid input and pass-through encryption fail without exposing the key", async (t) => {
  const { filePath, store } = await temporaryStore(t);
  for (const value of ["", "   ", "x".repeat(4_097)]) {
    await assert.rejects(store.setApiKey(value), (error: unknown) => {
      assert.ok(error instanceof SecretStoreError);
      assert.equal(error.code, "INVALID_API_KEY");
      if (value.trim() !== "") {
        assert.equal(String(error).includes(value.trim()), false);
      }
      return true;
    });
  }

  const plaintextKey = "test-pass-through-secret";
  const unsafeStore = new EncryptedFileSecretStore({
    filePath,
    cipher: {
      encrypt: async (value) => Buffer.from(value),
      decrypt: async (value) => value.toString(),
    },
  });
  await assert.rejects(unsafeStore.setApiKey(plaintextKey), (error: unknown) => {
    assert.ok(error instanceof SecretStoreError);
    assert.equal(error.code, "ENCRYPTION_FAILED");
    assert.equal(String(error).includes(plaintextKey), false);
    return true;
  });
});

test("corrupted ciphertext and invalid decrypted content fail closed", async (t) => {
  const { filePath, store } = await temporaryStore(t);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, "not-encrypted");
  await assert.rejects(store.isConfigured(), (error: unknown) => {
    assert.ok(error instanceof SecretStoreError);
    assert.equal(error.code, "DECRYPTION_FAILED");
    return true;
  });

  const invalidContentStore = new EncryptedFileSecretStore({
    filePath,
    cipher: {
      encrypt: async () => Buffer.from("encrypted"),
      decrypt: async () => "   ",
    },
  });
  await assert.rejects(invalidContentStore.getApiKey(), (error: unknown) => {
    assert.ok(error instanceof SecretStoreError);
    assert.equal(error.code, "CORRUPTED_SECRET");
    return true;
  });
});

function testSafeStorage(asyncAvailable = true, syncAvailable = true) {
  const calls: string[] = [];
  const value: SafeStorageLike = {
    isAsyncEncryptionAvailable: async () => asyncAvailable,
    isEncryptionAvailable: () => syncAvailable,
    encryptStringAsync: async (plaintext) => {
      calls.push("encrypt_async");
      return Buffer.from(`async:${plaintext}`);
    },
    decryptStringAsync: async (ciphertext) => {
      calls.push("decrypt_async");
      return {
        result: ciphertext.toString().slice("async:".length),
        shouldReEncrypt: false,
      };
    },
    encryptString: (plaintext) => {
      calls.push("encrypt_sync");
      return Buffer.from(`sync:${plaintext}`);
    },
    decryptString: (ciphertext) => {
      calls.push("decrypt_sync");
      return ciphertext.toString().slice("sync:".length);
    },
  };
  return { value, calls };
}

test("SafeStorageCipher prefers async APIs and narrowly falls back to sync", async () => {
  const asyncStorage = testSafeStorage();
  const asyncCipher = new SafeStorageCipher(asyncStorage.value);
  const asyncEncrypted = await asyncCipher.encrypt("secret");
  assert.equal(await asyncCipher.decrypt(asyncEncrypted), "secret");
  assert.deepEqual(asyncStorage.calls, ["encrypt_async", "decrypt_async"]);

  const syncStorage = testSafeStorage(false, true);
  const syncCipher = new SafeStorageCipher(syncStorage.value);
  const syncEncrypted = await syncCipher.encrypt("secret");
  assert.equal(await syncCipher.decrypt(syncEncrypted), "secret");
  assert.deepEqual(syncStorage.calls, ["encrypt_sync", "decrypt_sync"]);

  const unavailable = new SafeStorageCipher(testSafeStorage(false, false).value);
  await assert.rejects(unavailable.encrypt("secret"), (error: unknown) => {
    assert.ok(error instanceof SecretStoreError);
    assert.equal(error.code, "ENCRYPTION_UNAVAILABLE");
    return true;
  });
});
