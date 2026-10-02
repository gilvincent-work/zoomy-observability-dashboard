#!/usr/bin/env node
// Diagnose why Ask Coop's read-only path (CHAT_READ_MODE=ro_role) is rejected by a HOSTED Supabase project.
// RUN BY A PERSON, for one project at a time (staging first). It mints the same short-lived token the app mints
// (role coop_chat_ro, signed HS256 with the legacy JWT secret) and does ONE read-only GET of the view coop_chat_orders
// in three header variants, printing only the HTTP status and Supabase's own error text. It never prints a secret.
//
//   CHECK_URL=https://<project>.supabase.co CHAT_RO_JWT_SECRET='<legacy jwt secret>' CHECK_APIKEY='<anon or publishable key>' \
//     node scripts/check-ro-token.mjs
//
// Reads ONLY these three environment variables (never a .env file). CHECK_URL must be the project you mean to test.
import {createHmac} from 'node:crypto';

const url = (process.env.CHECK_URL || '').replace(/\/+$/, '');
const secret = process.env.CHAT_RO_JWT_SECRET || '';
const apikey = process.env.CHECK_APIKEY || '';
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error('CHECK_URL must look like https://<project-ref>.supabase.co');
  process.exit(2);
}
if (secret.length < 32) {
  console.error('CHAT_RO_JWT_SECRET is missing or shorter than 32 characters');
  process.exit(2);
}
console.log(`project host: ${new URL(url).host}   secret length: ${secret.length}   apikey given: ${apikey ? 'yes' : 'no'}`);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const iat = Math.floor(Date.now() / 1000);
const head = b64({alg: 'HS256', typ: 'JWT'});
const body = b64({role: 'coop_chat_ro', iss: 'supabase', iat, exp: iat + 300, sub: 'ask-coop'});
const token = `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;

const target = `${url}/rest/v1/coop_chat_orders?select=id&limit=1`;
const variants = [
  ['A: bearer = minted token, apikey = minted token (the app default)', {Authorization: `Bearer ${token}`, apikey: token}],
  ...(apikey ? [['B: bearer = minted token, apikey = the project anon/publishable key (CHAT_RO_APIKEY)', {Authorization: `Bearer ${token}`, apikey}]] : []),
  ...(apikey ? [['C: apikey only (no bearer), to prove the key itself is valid', {apikey}]] : []),
];
for (const [label, headers] of variants) {
  try {
    const res = await fetch(target, {headers});
    const text = (await res.text()).replace(/eyJ[A-Za-z0-9_.-]+/g, '[token]').slice(0, 220);
    console.log(`\n${label}\n  HTTP ${res.status}  ${text}`);
  } catch (e) {
    console.log(`\n${label}\n  request failed: ${e.message}`);
  }
}
console.log('\nReading it: HTTP 200 with rows or [] = that variant works. 401 "Invalid API key" = the gateway rejects that apikey. 401 "JWSError"/"JWT" = the secret does not verify (wrong project, or the legacy secret is revoked). 403/42501 = the role cannot read the view (SQL not applied or grants missing).');
