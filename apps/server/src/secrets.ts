import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { dataDir, secretsPath } from '@ascend/db';

/**
 * Local credential store (spec §2 "encrypted local secrets", §63 "store secrets
 * securely where practical").
 *
 * What this protects against
 * -------------------------
 * Casual disclosure: the values are not sitting in plaintext in a file that
 * might be read over someone's shoulder, copied into a backup, or picked up by a
 * misconfigured sync client. The file is `0600` and the values are AES-256-GCM
 * encrypted with authenticated tags, so silent tampering is detected.
 *
 * What it does NOT protect against
 * --------------------------------
 * By default the key lives beside the data in `~/.ascend/secret.key`, also
 * `0600`. Any process already running as this user can read both and therefore
 * decrypt everything. That is obfuscation at rest, not real confidentiality.
 * Setting `ASCEND_PASSPHRASE` switches to a scrypt-derived key that is never
 * written to disk, which is genuinely stronger — at the cost of having to
 * provide the passphrase whenever the server starts.
 *
 * The Codeforces session cookie stored here grants full access to the user's
 * Codeforces account for as long as it is valid. The onboarding UI says so.
 */

export const SECRET_NAMES = [
  /** Codeforces session cookie — needed for Gym data and submission source (§6B, §21). */
  'codeforces_session',
  'anthropic_api_key',
  'openai_api_key',
] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

export function isSecretName(value: string): value is SecretName {
  return (SECRET_NAMES as readonly string[]).includes(value);
}

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const SCRYPT_PARAMS = { N: 16_384, r: 8, p: 1 } as const;

type KeySource = 'passphrase' | 'keyfile';

interface StoredSecret {
  iv: string;
  tag: string;
  data: string;
  updatedAt: number;
}

interface SecretsFile {
  version: 1;
  keySource: KeySource;
  /** Salt for passphrase derivation; unused for keyfile mode but always present. */
  salt: string;
  entries: Partial<Record<SecretName, StoredSecret>>;
}

export class SecretsUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretsUnavailableError';
  }
}

function keyFilePath(): string {
  return join(dataDir(), 'secret.key');
}

function currentKeySource(): KeySource {
  const passphrase = process.env['ASCEND_PASSPHRASE'];
  return passphrase !== undefined && passphrase !== '' ? 'passphrase' : 'keyfile';
}

function ensureDataDir(): void {
  mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
}

function loadOrCreateKeyFile(): Buffer {
  const path = keyFilePath();
  if (existsSync(path)) {
    const key = readFileSync(path);
    if (key.length !== KEY_LENGTH) {
      throw new SecretsUnavailableError(
        `Key file ${path} is ${key.length} bytes, expected ${KEY_LENGTH}. Delete it to reset stored secrets.`,
      );
    }
    return key;
  }

  ensureDataDir();
  const key = randomBytes(KEY_LENGTH);
  writeFileSync(path, key, { mode: 0o600 });
  chmodSync(path, 0o600);
  return key;
}

function deriveKey(file: SecretsFile): Buffer {
  if (file.keySource === 'passphrase') {
    const passphrase = process.env['ASCEND_PASSPHRASE'];
    if (passphrase === undefined || passphrase === '') {
      throw new SecretsUnavailableError(
        'Stored secrets were encrypted with a passphrase. Set ASCEND_PASSPHRASE to unlock them.',
      );
    }
    return scryptSync(passphrase, Buffer.from(file.salt, 'base64'), KEY_LENGTH, SCRYPT_PARAMS);
  }
  return loadOrCreateKeyFile();
}

function emptyFile(): SecretsFile {
  return {
    version: 1,
    keySource: currentKeySource(),
    salt: randomBytes(16).toString('base64'),
    entries: {},
  };
}

function readFile(): SecretsFile {
  const path = secretsPath();
  if (!existsSync(path)) return emptyFile();

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new SecretsUnavailableError(
      `${path} is not valid JSON. Delete it to reset stored secrets.`,
    );
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as SecretsFile).version !== 1 ||
    typeof (parsed as SecretsFile).salt !== 'string'
  ) {
    throw new SecretsUnavailableError(
      `${path} is not a recognised Ascend secrets file. Delete it to reset stored secrets.`,
    );
  }

  const file = parsed as SecretsFile;
  file.entries ??= {};
  file.keySource ??= 'keyfile';
  return file;
}

function writeSecretsFile(file: SecretsFile): void {
  ensureDataDir();
  const path = secretsPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

/**
 * Guards against a silent switch between key sources, which would otherwise
 * surface as an unintelligible "unsupported state or unable to authenticate data".
 */
function assertKeySourceMatches(file: SecretsFile): void {
  const expected = currentKeySource();
  if (file.keySource === expected) return;

  if (file.keySource === 'passphrase') {
    throw new SecretsUnavailableError(
      'Stored secrets require ASCEND_PASSPHRASE, which is not set. Set it, or delete ~/.ascend/secrets.json to start over.',
    );
  }
  throw new SecretsUnavailableError(
    'Stored secrets were encrypted without a passphrase, but ASCEND_PASSPHRASE is now set. Unset it, or delete ~/.ascend/secrets.json to re-enter your credentials under the passphrase.',
  );
}

export function setSecret(name: SecretName, value: string): void {
  const file = readFile();

  // An empty store can adopt whichever key source is configured right now.
  if (Object.keys(file.entries).length === 0) file.keySource = currentKeySource();
  assertKeySourceMatches(file);

  const key = deriveKey(file);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);

  file.entries[name] = {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
    updatedAt: Math.floor(Date.now() / 1000),
  };

  writeSecretsFile(file);
}

export function getSecret(name: SecretName): string | null {
  const file = readFile();
  const entry = file.entries[name];
  if (!entry) return null;

  assertKeySourceMatches(file);
  const key = deriveKey(file);

  try {
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(entry.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(entry.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(entry.data, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new SecretsUnavailableError(
      `Could not decrypt "${name}". The key file or passphrase does not match the stored data.`,
    );
  }
}

export function hasSecret(name: SecretName): boolean {
  return readFile().entries[name] !== undefined;
}

export function deleteSecret(name: SecretName): void {
  const file = readFile();
  if (file.entries[name] === undefined) return;
  delete file.entries[name];
  writeSecretsFile(file);
}

export interface SecretStatus {
  name: SecretName;
  present: boolean;
  updatedAt: number | null;
}

/**
 * Presence and age only — this is what the API exposes. Secret *values* are
 * never returned over HTTP, not even to the local UI that stored them.
 */
export function describeSecrets(): { keySource: KeySource; secrets: SecretStatus[] } {
  const file = readFile();
  return {
    keySource: file.keySource,
    secrets: SECRET_NAMES.map((name) => {
      const entry = file.entries[name];
      return { name, present: entry !== undefined, updatedAt: entry?.updatedAt ?? null };
    }),
  };
}

/** Removes the whole store, used by "forget my credentials". */
export function clearAllSecrets(): void {
  const path = secretsPath();
  if (existsSync(path)) unlinkSync(path);
}

/** Constant-time comparison, for any future local auth token. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Redacts a secret for logs. Never log the value itself. */
export function redact(value: string): string {
  if (value.length <= 8) return '********';
  return `${value.slice(0, 3)}…${value.slice(-2)} (${value.length} chars)`;
}
