// Where Thinta keeps finished packs (with the teacher's approval) and Fika keeps delivery plans.
// With DATABASE_URL it is Postgres, so packs, approvals and replans survive restarts and redeploys. Without it,
// memory plus a local JSON file, so development and tests need no database. Both have the same async interface.
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCHEMA = `
create table if not exists thinta_packs (
  id text primary key,
  job jsonb not null,
  equation text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists fika_dispatches (
  graph_job_id text primary key,
  dispatch jsonb not null,
  updated_at timestamptz not null default now()
);`;

// A pack as stored: never the photo, which can be megabytes and is not needed again.
const packOf = job => ({ ...job, input: { ...job.input, imageBase64: '' } });
const summaryOf = row => ({ id: row.id, equation: row.equation || '', approved: Boolean(row.approved_at), approvedBy: row.approved_by || null, approvedAt: row.approved_at ? new Date(row.approved_at).toISOString() : null, createdAt: new Date(row.created_at).toISOString() });

function postgresStore(databaseUrl, Pool) {
  // Railway's private network needs no TLS; a public URL with sslmode=require does.
  const pool = new Pool({ connectionString: databaseUrl, max: 5, ...(/sslmode=require/.test(databaseUrl) ? { ssl: { rejectUnauthorized: false } } : {}) });
  let ready = null;
  const db = async (sql, params) => { ready ||= pool.query(SCHEMA).catch(error => { ready = null; throw error; }); await ready; return pool.query(sql, params); };
  return {
    kind: 'postgres',
    async savePack(job) {
      const pack = packOf(job);
      await db(`insert into thinta_packs (id, job, equation, approved_by, approved_at) values ($1, $2, $3, $4, $5)
        on conflict (id) do update set job = excluded.job, equation = excluded.equation, updated_at = now()`,
        [pack.id, pack, pack.proof?.equation || pack.input?.equationHint || '', pack.approval?.by || null, pack.approval?.approved ? pack.approval.at : null]);
      return pack;
    },
    async getPack(id) { return (await db('select job from thinta_packs where id = $1', [id])).rows[0]?.job || null; },
    async listPacks(limit = 10) { return (await db('select id, equation, approved_by, approved_at, created_at from thinta_packs order by created_at desc limit $1', [limit])).rows.map(summaryOf); },
    // The approval is kept both on the row (for listing) and inside the job (so a reopened pack shows it).
    async approvePack(id, approval) {
      const { rowCount } = await db(`update thinta_packs set approved_by = $2, approved_at = $3, job = jsonb_set(job, '{approval}', $4::jsonb), updated_at = now() where id = $1`,
        [id, approval.by, approval.at, JSON.stringify(approval)]);
      return rowCount > 0;
    },
    async saveDispatch(dispatch) {
      await db(`insert into fika_dispatches (graph_job_id, dispatch) values ($1, $2)
        on conflict (graph_job_id) do update set dispatch = excluded.dispatch, updated_at = now()`, [dispatch.graphJobId, dispatch]);
      return dispatch;
    },
    async getDispatch(graphJobId) { return (await db('select dispatch from fika_dispatches where graph_job_id = $1', [graphJobId])).rows[0]?.dispatch || null; },
    close: () => pool.end(),
  };
}

function fileStore(file) {
  const load = () => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return {}; } };
  const data = file ? load() : {};
  const packs = new Map(Object.entries(data.packs || {}));
  const dispatches = new Map(Object.entries(data.dispatches || {}));
  const save = () => { if (file) try { writeFileSync(file, JSON.stringify({ packs: Object.fromEntries(packs), dispatches: Object.fromEntries(dispatches) })); } catch { /* read-only disk */ } };
  return {
    kind: file ? 'file' : 'memory',
    async savePack(job) { const pack = packOf(job); packs.set(pack.id, { pack, createdAt: packs.get(pack.id)?.createdAt || new Date().toISOString() }); save(); return pack; },
    async getPack(id) { return packs.get(id)?.pack || null; },
    async listPacks(limit = 10) {
      return [...packs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
        .map(({ pack, createdAt }) => summaryOf({ id: pack.id, equation: pack.proof?.equation || pack.input?.equationHint, approved_by: pack.approval?.by, approved_at: pack.approval?.approved ? pack.approval.at : null, created_at: createdAt }));
    },
    async approvePack(id, approval) { const row = packs.get(id); if (!row) return false; row.pack = { ...row.pack, approval }; save(); return true; },
    async saveDispatch(dispatch) { dispatches.set(dispatch.graphJobId, dispatch); save(); return dispatch; },
    async getDispatch(graphJobId) { return dispatches.get(graphJobId) || null; },
    close: async () => {},
  };
}

// file: null keeps everything in memory only (tests).
export async function createStore({ databaseUrl = process.env.DATABASE_URL, file = join(tmpdir(), 'thinta-store.json') } = {}) {
  if (!databaseUrl) return fileStore(file);
  const { default: pg } = await import('pg');
  return postgresStore(databaseUrl, pg.Pool);
}

// One shared store per server process, made on first use.
let shared = null;
export const defaultStore = () => (shared ||= createStore());
