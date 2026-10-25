import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type AuthUser = { id: string; username: string; createdAt: string };
type StoredUser = AuthUser & { passwordSalt: string; passwordHash: string };
type StoredSession = { userId: string; expiresAt: string; lastUsedAt: string };
export type AuthStore = {
  hasUsers(): Promise<boolean>;
  register(username: string, password: string): Promise<AuthUser>;
  login(username: string, password: string): Promise<AuthUser | null>;
  createSession(userId: string): Promise<string>;
  getSession(token: string): Promise<AuthUser | null>;
  removeSession(token: string): Promise<void>;
};

const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1_000;
const sessionRefreshMs = 24 * 60 * 60 * 1_000;

function asUsers(value: unknown): StoredUser[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const user = entry as Partial<StoredUser>;
    if (
      typeof user.id !== 'string' ||
      typeof user.username !== 'string' ||
      typeof user.createdAt !== 'string' ||
      typeof user.passwordSalt !== 'string' ||
      typeof user.passwordHash !== 'string'
    )
      return [];
    return [user as StoredUser];
  });
}

function asSessions(value: unknown): Record<string, StoredSession> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([hash, entry]) => {
      if (!entry || typeof entry !== 'object') return [];
      const session = entry as Partial<StoredSession>;
      return typeof session.userId === 'string' &&
        typeof session.expiresAt === 'string' &&
        typeof session.lastUsedAt === 'string'
        ? [[hash, session as StoredSession]]
        : [];
    }),
  );
}

function publicUser(user: StoredUser): AuthUser {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

function digest(value: string): string {
  return crypto.createHash('sha256').update(value).digest('base64url');
}

function passwordHash(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('base64');
}

function validateUsername(value: string): string {
  const username = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{2,79}$/.test(username)) {
    throw new Error('Use 3–80 letters, numbers, dots, underscores, or hyphens for the username.');
  }
  return username;
}

function validatePassword(value: string): string {
  if (value.length < 12 || value.length > 1_000) {
    throw new Error('Use a password between 12 and 1,000 characters.');
  }
  return value;
}

export function createAuthStore(dataDirectory: string): AuthStore {
  const usersPath = path.join(dataDirectory, 'users.json');
  const sessionsPath = path.join(dataDirectory, 'sessions.json');
  let writeQueue = Promise.resolve();

  async function readJson(filePath: string): Promise<unknown> {
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async function writeJson(filePath: string, value: unknown): Promise<void> {
    await fs.mkdir(dataDirectory, { recursive: true, mode: 0o700 });
    const temporary = `${filePath}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temporary, filePath);
    await fs.chmod(filePath, 0o600);
  }

  async function update<T>(work: () => Promise<T>): Promise<T> {
    const operation = writeQueue.then(work);
    writeQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  async function users(): Promise<StoredUser[]> {
    return asUsers(await readJson(usersPath));
  }

  return {
    async hasUsers() {
      return (await users()).length > 0;
    },
    async register(username, password) {
      const normalizedUsername = validateUsername(username);
      const validPassword = validatePassword(password);
      return update(async () => {
        const existing = await users();
        if (existing.length) throw new Error('An account already exists. Sign in instead.');
        const salt = crypto.randomBytes(16).toString('base64');
        const user: StoredUser = {
          id: crypto.randomUUID(),
          username: normalizedUsername,
          createdAt: new Date().toISOString(),
          passwordSalt: salt,
          passwordHash: passwordHash(validPassword, salt),
        };
        await writeJson(usersPath, [user]);
        return publicUser(user);
      });
    },
    async login(username, password) {
      const user = (await users()).find(
        (candidate) => candidate.username.toLowerCase() === username.trim().toLowerCase(),
      );
      if (
        !user ||
        !crypto.timingSafeEqual(
          Buffer.from(user.passwordHash),
          Buffer.from(passwordHash(password, user.passwordSalt)),
        )
      )
        return null;
      return publicUser(user);
    },
    async createSession(userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      await update(async () => {
        const sessions = asSessions(await readJson(sessionsPath));
        const now = new Date();
        sessions[digest(token)] = {
          userId,
          expiresAt: new Date(now.getTime() + sessionLifetimeMs).toISOString(),
          lastUsedAt: now.toISOString(),
        };
        await writeJson(sessionsPath, sessions);
      });
      return token;
    },
    async getSession(token) {
      return update(async () => {
        const sessions = asSessions(await readJson(sessionsPath));
        const hash = digest(token);
        const session = sessions[hash];
        const now = Date.now();
        if (!session || Date.parse(session.expiresAt) <= now) {
          if (session) {
            const remainingSessions = Object.fromEntries(
              Object.entries(sessions).filter(([key]) => key !== hash),
            );
            await writeJson(sessionsPath, remainingSessions);
          }
          return null;
        }
        const user = (await users()).find((candidate) => candidate.id === session.userId);
        if (!user) return null;
        if (now - Date.parse(session.lastUsedAt) >= sessionRefreshMs) {
          session.lastUsedAt = new Date(now).toISOString();
          session.expiresAt = new Date(now + sessionLifetimeMs).toISOString();
          await writeJson(sessionsPath, sessions);
        }
        return publicUser(user);
      });
    },
    async removeSession(token) {
      await update(async () => {
        const sessions = asSessions(await readJson(sessionsPath));
        const tokenHash = digest(token);
        const remainingSessions = Object.fromEntries(
          Object.entries(sessions).filter(([key]) => key !== tokenHash),
        );
        await writeJson(sessionsPath, remainingSessions);
      });
    },
  };
}
