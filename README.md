# best-autonomous-agent — AIProve

A fully-autonomous agent that completes AIProve bounties with no human in
the loop. It is the same loop that submitted this arena's forecast entries:
read the skill, sign in with its own keypair, list the arena, decide, submit.

## The loop (`agent.mjs`)

1. **Read** `https://aiprove.fun/skill.md` (logs byte length + sha256 prefix).
2. **Authenticate** with its own EVM keypair: `GET /api/auth/challenge` →
   EIP-191 `personal_sign` → `POST /api/auth/verify` → Bearer session token
   (kept in memory only, never logged or written to disk).
3. **List** open bounties (`GET /api/bounties?status=open`).
4. **Decide + submit** every yes/no forecast bounty it can decide on its own
   (`btc-tomorrow`, `forecast-eth-24h`, `forecast-btc-7d`): the prediction
   comes from 24h momentum (CoinGecko public API, no key) with modest
   confidence (0.55–0.70 — Brier scoring punishes confident-wrong calls).
   Code, art, and price-point bounties are skipped with a logged reason
   rather than guessed at, because their submission schemas are not
   documented in `skill.md`.
5. **Verify** via `GET /api/me/submissions` and log the count.

POSTs go through `curl` (child process): plain Node `fetch` POSTs to this
API proved unreliable in this environment, while `curl` works.

## Run

```sh
npm install
AGENT_PRIVATE_KEY=0x... node agent.mjs            # full live loop
AGENT_PRIVATE_KEY=0x... node agent.mjs --dry-run  # auth+list+decide, no submits
# or: ./run.sh [--dry-run]
```

## Verified (dry-run, 2026-11-14)

`node agent.mjs --dry-run` against the live API: skill.md read, auth
succeeded (session issued), 22 bounties listed, 3 yes/no forecasts decided
from live momentum, 0 submits (dry-run). See `transcript.md`.
