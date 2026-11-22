// Where SA Educate keeps accounts, learner profiles, sign-in sessions and the material teachers assign.
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
create index if not exists sae_sessions_email on sae_sessions(email);
create table if not exists sae_assignments (
  learner_email text not null references sae_users(email) on delete cascade,
  item_id text not null,
  kind text not null check (kind in ('pack', 'lesson')),
  title text not null,
  content jsonb not null,
  teacher_email text not null references sae_users(email) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (learner_email, item_id)
);`;

const UNIQUE_VIOLATION = '23505';
const assignmentOf = row => row && {
  itemId: row.item_id, kind: row.kind, title: row.title, learnerEmail: row.learner_email, teacherEmail: row.teacher_email,
  assignedAt: new Date(row.assigned_at).toISOString(), ...(row.content !== undefined ? { content: row.content } : {}),
};
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
    // Assigning the same item to a learner again replaces it with the latest version.
    async assign({ itemId, kind, title, content, teacherEmail }, learnerEmails) {
      for (const email of learnerEmails) {
        await db(`insert into sae_assignments (learner_email, item_id, kind, title, content, teacher_email) values ($1, $2, $3, $4, $5, $6)
          on conflict (learner_email, item_id) do update set kind = excluded.kind, title = excluded.title, content = excluded.content,
            teacher_email = excluded.teacher_email, assigned_at = now()`, [email, itemId, kind, title, content, teacherEmail]);
      }
    },
    async learnerAssignments(email) {
      return (await db('select * from sae_assignments where learner_email = $1 order by assigned_at desc', [email])).rows.map(assignmentOf);
    },
    async teacherAssignments(email) {
      return (await db('select learner_email, item_id, kind, title, teacher_email, assigned_at from sae_assignments where teacher_email = $1 order by assigned_at desc', [email])).rows.map(assignmentOf);
    },
    close: () => pool.end(),
  };
}

function memoryStore() {
  const users = new Map();
  const sessions = new Map();
  const assignments = new Map(); // `${learner}|${item}` -> assignment
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
    async assign({ itemId, kind, title, content, teacherEmail }, learnerEmails) {
      for (const learnerEmail of learnerEmails) {
        assignments.set(`${learnerEmail}|${itemId}`, { itemId, kind, title, content, teacherEmail, learnerEmail, assignedAt: new Date().toISOString() });
      }
    },
    async learnerAssignments(email) {
      return [...assignments.values()].filter(a => a.learnerEmail === email).sort((a, b) => b.assignedAt.localeCompare(a.assignedAt)).map(a => ({ ...a }));
    },
    async teacherAssignments(email) {
      return [...assignments.values()].filter(a => a.teacherEmail === email).sort((a, b) => b.assignedAt.localeCompare(a.assignedAt)).map(({ content, ...a }) => a);
    },
    close: async () => {},
  };
}

// Pool can be swapped for a stand-in (tests use pg-mem, an in-memory Postgres) to exercise the SQL above.
export async function createAccountStore({ databaseUrl = process.env.DATABASE_URL, Pool } = {}) {
  if (!databaseUrl) return memoryStore();
  return postgresStore(databaseUrl, Pool || (await import('pg')).default.Pool);
}
