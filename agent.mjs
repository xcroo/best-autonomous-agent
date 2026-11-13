#!/usr/bin/env node
/**
 * h2r.agent — a fully-autonomous AIProve agent.
 *
 * Loop (no human in the loop):
 *   1. Read https://aiprove.fun/skill.md (the one file the arena publishes).
 *   2. Authenticate with its own EVM keypair: GET challenge -> EIP-191
 *      personal_sign -> POST verify -> Bearer session token (memory only).
 *   3. List open bounties.
 *   4. For every yes/no forecast bounty it can decide on its own
 *      (btc-tomorrow, forecast-eth-24h, forecast-btc-7d), build a prediction
 *      from 24h momentum (CoinGecko public API, no key) and submit it.
 *   5. Verify via GET /api/me/submissions and log the whole run.
 *
 * POSTs go through curl (child_process) because plain Node fetch POSTs to
 * this API have proven unreliable in this environment; GETs use fetch.
 *
 * Identity: AGENT_PRIVATE_KEY env var (never committed, never logged).
 *   --dry-run : auth + list + build predictions, but skip enter/submit.
 *
 * Usage:
 *   AGENT_PRIVATE_KEY=0x... node agent.mjs            # full live loop
 *   AGENT_PRIVATE_KEY=0x... node agent.mjs --dry-run  # verify without submitting
 */
import { Wallet } from 'ethers';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';

const API = 'https://aiprove.fun';
const DRY = process.argv.includes('--dry-run');
const HANDLE = 'h2r.agent';
// Yes/no direction bounties whose submission schema is documented in skill.md
// ({prediction: {answer: 'yes'|'no', confidence: 0..1}}). All other bounties
// (code, art, price-point forecasts with undocumented payloads) are skipped
// with a logged reason rather than guessed at.
const YES_NO = {
  'btc-tomorrow': 'bitcoin',
  'forecast-eth-24h': 'ethereum',
  'forecast-btc-7d': 'bitcoin',
};

const log = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function curlJson(method, path, token, body) {
  const args = ['-s', '-X', method, `${API}${path}`,
    '-H', 'content-type: application/json'];
  if (token) args.push('-H', `Authorization: Bearer ${token}`);
  if (body !== undefined) args.push('-d', JSON.stringify(body));
  const out = execFileSync('curl', args, { encoding: 'utf8', timeout: 30000 });
  return JSON.parse(out);
}

async function getJson(path) {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  return res.json();
}

async function momentum() {
  // 24h % change for BTC/ETH from CoinGecko's free public endpoint (no key).
  // curl first: it proved reliable in this environment where Node fetch timed out.
  const url = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true';
  try {
    const out = execFileSync('curl', ['-s', '-m', '20', url], { encoding: 'utf8', timeout: 25000 });
    const j = JSON.parse(out);
    return {
      bitcoin: j.bitcoin?.usd_24h_change ?? null,
      ethereum: j.ethereum?.usd_24h_change ?? null,
    };
  } catch (e) {
    log(`momentum via curl failed (${e.message}); falling back to 0.5/neutral`);
    return { bitcoin: null, ethereum: null };
  }
}

function decide(changePct) {
  // Modest confidence: Brier scoring punishes confident-wrong more than
  // hedged calls. 0.55 floor, 0.70 cap.
  if (changePct === null || changePct === undefined) return { answer: 'no', confidence: 0.5 };
  const conf = Math.min(0.70, Math.max(0.55, 0.5 + Math.abs(changePct) * 0.02));
  return { answer: changePct > 0 ? 'yes' : 'no', confidence: +conf.toFixed(2) };
}

async function main() {
  const key = process.env.AGENT_PRIVATE_KEY;
  if (!key) { console.error('AGENT_PRIVATE_KEY is not set'); process.exit(1); }
  const wallet = new Wallet(key.trim());
  log(`agent ${wallet.address} handle=${HANDLE} dryRun=${DRY}`);

  // 1. Read skill.md
  const skill = await (await fetch(`${API}/skill.md`)).text();
  const hash = createHash('sha256').update(skill).digest('hex').slice(0, 16);
  log(`skill.md read: ${skill.length} bytes, sha256=${hash}...`);

  // 2. Authenticate (challenge -> sign -> session)
  const { challenge } = await getJson(`/api/auth/challenge?address=${wallet.address}`);
  const signature = await wallet.signMessage(challenge);
  const sess = curlJson('POST', '/api/auth/verify', null,
    { address: wallet.address, signature });
  if (!sess.token) throw new Error(`auth failed: ${JSON.stringify(sess)}`);
  const token = sess.token;
  log(`authenticated, session expires ${new Date(sess.expiresAt).toISOString()}`);

  // 3. List open bounties
  const { bounties } = await getJson('/api/bounties?status=open');
  log(`${bounties.length} bounties open`);

  // 4. Build predictions from momentum, submit each supported bounty
  const mom = await momentum();
  log(`24h momentum: BTC ${mom.bitcoin?.toFixed(2) ?? 'n/a'}%  ETH ${mom.ethereum?.toFixed(2) ?? 'n/a'}%`);
  let submitted = 0, skipped = 0;
  for (const b of bounties) {
    const coin = YES_NO[b.slug];
    if (!coin) { log(`skip ${b.slug} (not a yes/no forecast this agent can decide)`); skipped++; continue; }
    const pred = decide(mom[coin]);
    log(`${b.slug}: predict ${JSON.stringify(pred)}`);
    if (DRY) { log(`dry-run: would enter+submit ${b.slug}`); continue; }
    curlJson('POST', `/api/bounties/${b.slug}/enter`, token, { handle: HANDLE });
    const r = curlJson('POST', `/api/bounties/${b.slug}/submit`, token,
      { prediction: pred, handle: HANDLE });
    log(`${b.slug}: submit -> ${JSON.stringify(r).slice(0, 200)}`);
    submitted++;
    await sleep(1000);
  }

  // 5. Verify
  log(`done: submitted=${submitted} skipped=${skipped} dryRun=${DRY}`);
  const subs = curlJson('GET', '/api/me/submissions', token);
  const count = Array.isArray(subs) ? subs.length : (subs.submissions?.length ?? '?');
  log(`verified: ${count} submissions on record for this agent`);
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
