# Pharos Agent Pay

> Agent-to-agent metered payments on Pharos — the settlement rail for the agent economy.

One agent pays another **per service call** without deploying a contract per integration. The payer signs a capped EIP-712 spend voucher; the payee draws it down as it delivers work; each draw settles on-chain as an ERC-20 transfer.

```
QUOTE ──▶ AUTHORIZE ──▶ VERIFY ──▶ SETTLE (on-chain)
 price     sign cap      check sig    draw ≤ cap, ERC-20 transfer
```

## Why
Pharos is built for the AI-agent economy: agents that transact and interact on-chain. Every Skill an agent exposes should be *sellable*. `pharos-agent-pay` is the shared primitive that makes that possible — price a Skill per call and get paid through one rail, instead of wiring custom payments into each service.

## Actions (MCP / agent-kit)
- `AGENT_PAY_QUOTE` — advertise a per-call price; compute the total to pre-authorize.
- `AGENT_PAY_AUTHORIZE` — sign an EIP-712 `PaymentAuthorization` capped at `maxAmount`.
- `AGENT_PAY_VERIFY` — verify a voucher's signature, expiry, and remaining balance.
- `AGENT_PAY_SETTLE` — draw a metered amount within the cap and execute the ERC-20 payment.

## Guarantees
- Settlement refused unless the signature resolves to `payer`.
- Cumulative draws can never exceed the voucher cap (in-memory `SpendLedger`).
- Settlement after `deadline` is refused.
- Failed on-chain transfer rolls the ledger back — the cap is never burned on a revert.

## Quickstart
```bash
npm install
cp .env.example .env        # WALLET_PRIVATE_KEY (payer), PHAROS_RPC_URL
npm run build

# Dry run (no broadcast): quote -> authorize -> verify
npm run dev -- --payee 0xPayee --service yield-scout/scan --price 0.05 --calls 3

# Real on-chain settlement
npm run dev -- --payee 0xPayee --service yield-scout/scan --amount 0.05 --settle

# MCP server
npm run mcp
```

## Network
Pharos Atlantic testnet — chain id `688689`, RPC `https://atlantic.dplabs-internal.com`, explorer `https://atlantic.pharosscan.xyz`. Default settlement token: testnet USDC (`0x72df…BCcCED`, 6 decimals).

## Design notes
- This release settles **payer-side**: the settling wallet is the voucher's `payer`, moving its own funds to the payee for actual usage. A pull-based variant (payer approves an escrow operator, payee calls `transferFrom`) is the natural next iteration and the path to a fully on-chain escrow contract.
- The `SpendLedger` is in-memory; production should bind it to on-chain allowance/nonce state and a persistent store.

See [SKILL.md](./SKILL.md) for the full action reference and Phase 2 composition story.

MIT.
