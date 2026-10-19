// End-to-end check of POST /api/admin/auth-enforcement/sync (server.ts) against a REAL database
// and PostgREST, with the Supabase Auth service SIMULATED by a local stub (token lookup + Auth
// Admin API). It proves the route's authorization, targeting, failure and convergence behaviour
// and that the service-role credential is only ever sent from the server. It does NOT prove how a
// real hosted Auth service behaves. Needs: dist/server.cjs (npm run build), PostgREST on :3999,
// psql env (PGHOST/PGPORT/PGUSER) and DBNAME. Port 3000 must be free (the server port is fixed).
import http from 'node:http';
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';

const DB = process.env.DBNAME, POSTGREST = process.env.POSTGREST_URL || 'http://127.0.0.1:3999';
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long';
const SERVER_BUNDLE = new URL('../../../dist/server.cjs', import.meta.url).pathname;
if (!fs.existsSync(SERVER_BUNDLE)) { console.log('SKIPPED: dist/server.cjs not built (run npm run build)'); process.exit(0); }

const ADMIN = '11111111-aaaa-4000-8000-000000000003', OTHER = '11111111-aaaa-4000-8000-000000000002';
const SUSP = '11111111-aaaa-4000-8000-000000000004', FAILER = '22222222-aaaa-4000-8000-000000000001', PREV = '22222222-aaaa-4000-8000-000000000002';
const OPBAN = '33333333-aaaa-4000-8000-000000000001', SUSPOP = '33333333-aaaa-4000-8000-000000000002', OWNCH = '33333333-aaaa-4000-8000-000000000003';
const SERVICE_KEY = 'stub-service-role-key';
const TOKENS = { 'admin-token': ADMIN, 'user-token': OTHER };

const b64 = (b) => Buffer.from(b).toString('base64url');
const jwt = (claims) => { const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64(JSON.stringify(claims));
  return `${h}.${p}.` + crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url'); };
const sql = (q) => execFileSync('psql', ['-X', '-t', '-A', '-d', DB, '-c', q], { encoding: 'utf8' }).trim();

// ---- seed (inside the disposable DB only) ----
sql(`insert into auth.users (id,email,raw_user_meta_data,email_confirmed_at) values
  ('${SUSP}','susp@acme.test','{}',now()),('${FAILER}','failer@acme.test','{}',now()),('${PREV}','prev@acme.test','{}',now()) on conflict do nothing`);
sql(`insert into public.users (id,email,full_name,primary_role,system_role,account_status) values
  ('${FAILER}','failer@acme.test','Failer','employer','user','active'),('${PREV}','prev@acme.test','Prev','employer','user','active')
  on conflict do nothing`);
sql(`insert into auth.users (id,email,raw_user_meta_data,email_confirmed_at) values ('${OTHER}','other@acme.test','{}',now()) on conflict do nothing`);
sql(`update auth.users set banned_until = null where id in ('${SUSP}','${FAILER}')`);
sql(`update public.users set account_status='suspended' where id in ('${FAILER}')`);   // SUSP is already suspended by the seed
sql(`update auth.users set banned_until = null where id in ('${SUSP}','${FAILER}')`);   // simulate "database suspended, Auth ban missing"
// PREV: LibRise banned it earlier, the account is active again -> should be unbanned
sql(`insert into public.account_auth_enforcement (user_id,status,detail) values ('${PREV}','applied','ok') on conflict (user_id) do update set status='applied'`);
sql(`update auth.users set banned_until = '2200-01-01T00:00:00Z' where id = '${PREV}'`);
sql(`update public.account_auth_enforcement set imposed_banned_until = '2200-01-01T00:00:00Z' where user_id = '${PREV}'`);
// ownership scenarios (F-30)
sql(`insert into auth.users (id,email,raw_user_meta_data,email_confirmed_at) values ('${OPBAN}','opban@acme.test','{}',now()),('${SUSPOP}','suspop@acme.test','{}',now()),('${OWNCH}','ownch@acme.test','{}',now()) on conflict do nothing`);
sql(`update public.users set account_status='active' where id in ('${OPBAN}','${OWNCH}')`);
sql(`update auth.users set banned_until = '2200-06-01T00:00:00Z' where id in ('${OPBAN}','${SUSPOP}')`);                    // operator bans
sql(`insert into public.account_auth_enforcement (user_id,status,detail) values ('${OPBAN}','failed','old failed attempt'),('${SUSPOP}','failed','old failed attempt') on conflict (user_id) do update set status='failed', imposed_banned_until=null`);
sql(`update public.users set account_status='suspended' where id = '${SUSPOP}'`);
sql(`update auth.users set banned_until = '2200-06-01T00:00:00Z' where id = '${SUSPOP}'`);   // (the status change above must not have replaced it)
sql(`insert into public.account_auth_enforcement (user_id,status,detail,imposed_banned_until) values ('${OWNCH}','applied','ok','2200-02-02T00:00:00Z') on conflict (user_id) do update set status='applied', imposed_banned_until='2200-02-02T00:00:00Z'`);
sql(`update auth.users set banned_until = '2200-09-09T00:00:00Z' where id = '${OWNCH}'`);   // LibRise banned it, an operator then changed the ban
// lingering session rows on SUSP: must not matter
sql(`insert into auth.sessions (id,user_id) values (extensions.uuid_generate_v4(),'${SUSP}')`);

// ---- stub Supabase (Auth + Admin API + a pass-through to the real PostgREST) ----
const log = []; let failBanFor = new Set([FAILER]);
const body = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
const stub = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'); const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (url.pathname === '/auth/v1/user') {
    const id = TOKENS[auth]; return id ? send(200, { id, aud: 'authenticated', role: 'authenticated', email: id + '@x.test', app_metadata: {}, user_metadata: {} }) : send(401, { message: 'invalid token' });
  }
  const m = url.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]+)$/);
  if (m) {
    if (auth !== SERVICE_KEY) return send(401, { message: 'admin api needs the service key' });
    const id = m[1];
    if (req.method === 'PUT') {
      const b = JSON.parse((await body(req)) || '{}'); log.push(`admin:PUT:${id}:${b.ban_duration}`);
      if (b.ban_duration !== 'none' && failBanFor.has(id)) return send(500, { message: 'simulated upstream failure' });
      sql(`update auth.users set banned_until = ${b.ban_duration === 'none' ? 'null' : "now() + interval '876000 hours'"} where id = '${id}'`);
    }
    const bu = sql(`select coalesce(banned_until::text,'') from auth.users where id='${id}'`);
    return send(200, { id, banned_until: !bu ? null : bu === 'infinity' ? '9999-12-31T00:00:00Z' : new Date(bu.replace(' ', 'T').replace(/\+00$/, 'Z')).toISOString() });
  }
  if (url.pathname.startsWith('/rest/v1/')) {
    const real = auth === SERVICE_KEY ? jwt({ role: 'service_role' }) : TOKENS[auth] ? jwt({ role: 'authenticated', sub: TOKENS[auth], aud: 'authenticated' }) : null;
    if (!real) return send(401, { message: 'bad token' });
    if (auth === SERVICE_KEY) log.push(`rest:${req.method}:${url.pathname.split('/').pop()}`);
    const r = await fetch(POSTGREST + url.pathname.replace('/rest/v1', '') + url.search, { method: req.method, headers: { 'content-type': 'application/json', authorization: `Bearer ${real}` }, body: ['GET', 'HEAD'].includes(req.method) ? undefined : await body(req) });
    res.writeHead(r.status, { 'content-type': 'application/json' }); return res.end(await r.text());
  }
  send(404, { message: 'stub: ' + url.pathname });
});
await new Promise((r) => stub.listen(4100, '127.0.0.1', r));

const startServer = async (env) => {
  const child = spawn('node', [SERVER_BUNDLE], { env: { ...process.env, NODE_ENV: 'production', VITE_SUPABASE_URL: 'http://127.0.0.1:4100', SUPABASE_URL: 'http://127.0.0.1:4100', VITE_SUPABASE_ANON_KEY: 'stub-anon', SUPABASE_ANON_KEY: 'stub-anon', ...env }, stdio: process.env.ROUTE_CHECK_DEBUG ? 'inherit' : 'ignore' });
  let exited = false; child.on('exit', () => { exited = true; });
  for (let i = 0; i < 60; i++) {                       // wait until the server answers (up to ~15 s)
    if (exited) throw new Error('the Express server exited during startup (set ROUTE_CHECK_DEBUG=1 to see its output; is port 3000 free?)');
    try { await fetch('http://127.0.0.1:3000/api/ai/health'); return child; } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  child.kill(); throw new Error('the Express server did not start listening on port 3000 within 15 s');
};
const post = (token, payload = {}) => fetch('http://127.0.0.1:3000/api/admin/auth-enforcement/sync', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(payload) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => ({})) }));

const results = []; const check = (name, ok, detail = '') => { results.push(ok); console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : `  [${String(detail).slice(0, 160)}]`)); };
let server = await startServer({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
try {
  let r = await post(null); check('no credentials -> 401', r.status === 401, JSON.stringify(r));
  r = await post('user-token'); check('ordinary user token -> 403 (database refuses the drift report)', r.status === 403 && r.json.success === false, JSON.stringify(r));
  check('ordinary user caused no Auth Admin API call', !log.some((l) => l.startsWith('admin:')), log.join(','));
  r = await post('admin-token', { userId: OTHER }); check('admin targeting an account that is NOT in the database report -> nothing happens', r.status === 200 && r.json.results.length === 0 && !log.some((l) => l.includes(OTHER)), JSON.stringify(r));
  r = await post('admin-token');
  check('admin sync: failure for one account => 502, never a false success', r.status === 502 && r.json.success === false && r.json.failed === 1, JSON.stringify(r).slice(0, 200));
  const byId = Object.fromEntries((r.json.results || []).map((x) => [x.userId, x]));
  check('  ...the suspended account with lingering sessions got its ban and is ok', byId[SUSP]?.ok === true, JSON.stringify(byId[SUSP]));
  check('  ...the reinstated account was unbanned', byId[PREV]?.ok === true && byId[PREV]?.desired === 'unban', JSON.stringify(byId[PREV]));
  check('  ...the failing account is reported failed with detail', byId[FAILER]?.ok === false && /upstream/.test(byId[FAILER]?.detail || ''), JSON.stringify(byId[FAILER]));
  check('  ...database records: applied / cleared / failed', sql(`select status from public.account_auth_enforcement where user_id='${SUSP}'`) === 'applied' && sql(`select status from public.account_auth_enforcement where user_id='${PREV}'`) === 'cleared' && sql(`select status from public.account_auth_enforcement where user_id='${FAILER}'`) === 'failed');
  check('  ...the failure is audited', Number(sql(`select count(*) from public.audit_logs where action='user.auth_ban_failed' and resource_id='${FAILER}'`)) >= 1);
  check('  ...the suspension itself is untouched (database remains the authority)', sql(`select account_status from public.users where id='${FAILER}'`) === 'suspended');
  check('  ...lingering session rows were not required to be removed', Number(sql(`select count(*) from auth.sessions where user_id='${SUSP}'`)) >= 1);
  // ---- ownership (F-30) ----
  check('  ...an operator ban on an ACTIVE account (with an old failed record) was never touched', sql(`select banned_until::text from auth.users where id='${OPBAN}'`).startsWith('2200-06-01') && !log.some((l) => l.includes(OPBAN)), log.join(','));
  check('  ...the account whose ban was changed by an operator after LibRise recorded it was never touched', sql(`select banned_until::text from auth.users where id='${OWNCH}'`).startsWith('2200-09-09') && !log.some((l) => l.includes(OWNCH)));
  check('  ...a suspended account already covered by an operator ban: NOT overwritten (no admin call), recorded applied with no ownership', !log.some((l) => l.includes(SUSPOP)) && sql(`select status||'/'||coalesce(imposed_banned_until::text,'none') from public.account_auth_enforcement where user_id='${SUSPOP}'`) === 'applied/none');
  check('  ...a ban LibRise imposed is recorded with the value it wrote (to the millisecond: the JSON round trip drops microseconds)', sql(`select public.same_ban_instant(imposed_banned_until, (select banned_until from auth.users where id='${SUSP}'))::text from public.account_auth_enforcement where user_id='${SUSP}'`) === 'true');
  r = await post('admin-token'); check('second sync: only the failed account is retried (converged accounts are not re-listed despite lingering sessions)', r.json.results.length === 1 && r.json.results[0].userId === FAILER, JSON.stringify(r.json.results));
  failBanFor = new Set();
  r = await post('admin-token', { userId: FAILER }); check('retry after the upstream recovers => 200 and recorded applied', r.status === 200 && r.json.success === true && sql(`select status from public.account_auth_enforcement where user_id='${FAILER}'`) === 'applied', JSON.stringify(r));
  r = await post('admin-token'); check('final sync: nothing left to do', r.status === 200 && r.json.results.length === 0, JSON.stringify(r));
  check('every privileged Auth Admin API call carried the server-side key (the stub rejects any other credential)', log.filter((l) => l.startsWith('admin:')).length >= 3);
} finally { server.kill(); }
// no service key configured -> 503, never a success
server = await startServer({ SUPABASE_SERVICE_ROLE_KEY: '' });
try { const r = await post('admin-token'); check('service key not configured -> 503 (never success)', r.status === 503 && r.json.success === false, JSON.stringify(r)); } finally { server.kill(); }
stub.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
