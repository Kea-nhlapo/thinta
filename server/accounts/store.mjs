// Where SA Educate keeps accounts, learner profiles and sign-in sessions.
// With DATABASE_URL it is Postgres, so accounts work from any device and survive redeploys. Without it, memory
// only, for development and tests. Both have the same async interface. Like server/thinta/store.mjs.

const SCHEMA = `
create table if not exists sae_users (
  email text primary key,
  name text not null,
  role text not null check (role in ('learner', 'teacher')),
  password_hash text not null,
  profile jsonb,
  created_at timestamptz not null default now()
);
create table if not exists sae_sessions (
  token_hash text primary key,
  email text not null references sae_users(email) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sae_sessions_email on sae_sessions(email);`;

const UNIQUE_VIOLATION = '23505';
const userOf = row => row && { email: row.email, name: row.name, role: row.role, passwordHash: row.password_hash, profile: row.profile || null };

function postgresStore(databaseUrl, Pool) {
  // Railway's private network needs no TLS; a public URL with sslmode=require does.
  const pool = new Pool({ connectionString: databaseUrl, max: 5, ...(/sslmode=require/.test(databaseUrl) ? { ssl: { rejectUnauthorized: false } } : {}) });
  let ready = null;
  const db = async (sql, params) => { ready ||= pool.query(SCHEMA).catch(error => { ready = null; throw error; }); await ready; return pool.query(sql, params); };
  return {
    kind: 'postgres',
    async getUser(email) { return userOf((await db('select * from sae_users where email = $1', [email])).rows[0]); },
    // False when the email is taken. The primary key decides, so two sign-ups at once cannot both win.
    async createUser(user) {
      try {
        await db('insert into sae_users (email, name, role, password_hash, profile) values ($1, $2, $3, $4, $5)',
          [user.email, user.name, user.role, user.passwordHash, user.profile]);
        return true;
      } catch (error) {
        if (error.code === UNIQUE_VIOLATION) return false;
        throw error;
      }
    },
    async saveProfile(email, profile) { await db('update sae_users set profile = $2 where email = $1', [email, profile]); },
    async listLearners() { return (await db("select * from sae_users where role = 'learner' order by created_at")).rows.map(userOf); },
    async createSession(tokenHash, email, expiresAt) {
      await db('insert into sae_sessions (token_hash, email, expires_at) values ($1, $2, $3)', [tokenHash, email, expiresAt]);
      // Housekeeping on the way: expired sessions are never used again.
      await db('delete from sae_sessions where expires_at < now()');
    },
    async sessionUser(tokenHash) {
      return userOf((await db('select u.* from sae_sessions s join sae_users u on u.email = s.email where s.token_hash = $1 and s.expires_at > now()', [tokenHash])).rows[0]);
    },
    async deleteSession(tokenHash) { await db('delete from sae_sessions where token_hash = $1', [tokenHash]); },
    close: () => pool.end(),
  };
}

function memoryStore() {
  const users = new Map();
  const sessions = new Map();
  return {
    kind: 'memory',
    async getUser(email) { return users.has(email) ? { ...users.get(email) } : null; },
    async createUser(user) { if (users.has(user.email)) return false; users.set(user.email, { ...user }); return true; },
    async saveProfile(email, profile) { if (users.has(email)) users.get(email).profile = profile; },
    async listLearners() { return [...users.values()].filter(u => u.role === 'learner').map(u => ({ ...u })); },
    async createSession(tokenHash, email, expiresAt) { sessions.set(tokenHash, { email, expiresAt }); },
    async sessionUser(tokenHash) {
      const session = sessions.get(tokenHash);
      return session && session.expiresAt > new Date() ? this.getUser(session.email) : null;
    },
    async deleteSession(tokenHash) { sessions.delete(tokenHash); },
    close: async () => {},
  };
}

// Pool can be swapped for a stand-in (tests use pg-mem, an in-memory Postgres) to exercise the SQL above.
export async function createAccountStore({ databaseUrl = process.env.DATABASE_URL, Pool } = {}) {
  if (!databaseUrl) return memoryStore();
  return postgresStore(databaseUrl, Pool || (await import('pg')).default.Pool);
}
