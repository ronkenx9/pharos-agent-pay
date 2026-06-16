---
name: pharos-agent-pay
version: 1.0.0
description: Agent-to-agent metered payments on Pharos. Payers sign EIP-712 spend vouchers; payees draw them down per service call, settled on-chain in ERC-20.
authors:
  - roninxx
tags:
  - pharos
  - payments
  - x402
  - settlement
  - metered
  - agent
frameworks:
  - claude-code
  - codex
  - mcp
---

# Pharos Agent Pay

The settlement primitive for the Pharos agent economy. It lets one agent **pay another agent per service call** without a bespoke contract for every integration: the payer signs a capped EIP-712 spend voucher, the payee draws it down incrementally as it delivers work, and each draw settles on-chain as an ERC-20 transfer.

This is the keystone Skill that makes every other Skill *monetizable* — a yield scout, an identity auditor, a firewall can each be sold per call and paid through the same rail.

## Trigger Phrases
- "Quote the price to call [service]"
- "Authorize [amount] for agent [address] to run [service]"
- "Pay agent [address] for this service call"
- "Settle [amount] to [payee] for [service]"
- "Verify this payment voucher"

## Actions

| Action | Purpose |
|---|---|
| `AGENT_PAY_QUOTE` | A payee advertises a per-call price and the total to pre-authorize for N calls. |
| `AGENT_PAY_AUTHORIZE` | The payer signs an EIP-712 `PaymentAuthorization` voucher capped at `maxAmount`. |
| `AGENT_PAY_VERIFY` | Read-only: confirm a voucher's signature, expiry, and remaining balance. |
| `AGENT_PAY_SETTLE` | Draw a metered amount within the cap and execute the on-chain ERC-20 payment. |

## The voucher (EIP-712 `PaymentAuthorization`)
`payer, payee, token, maxAmount, deadline, nonce, serviceId` — signed under domain `PharosAgentPay v1` on chain `688689` (Pharos Atlantic testnet).

## Invariants
- **Signature-bound:** settlement is refused unless the voucher's signature resolves to `payer`.
- **Payer-settled:** the settling wallet must equal `payer`; this skill moves the payer's own funds to the payee for actual usage. (Pull-based `transferFrom`/escrow is a documented future extension.)
- **Capped:** a `SpendLedger` tracks cumulative draws per voucher; a draw that would exceed `maxAmount` is blocked.
- **Time-bound:** settlement after `deadline` is refused.
- **Atomic accounting:** if the on-chain transfer reverts, the ledger draw is rolled back so the cap isn't burned.

## How to run

```bash
cd pharos-agent-pay
npm install
cp .env.example .env   # set WALLET_PRIVATE_KEY (payer) + PHAROS_RPC_URL

# Dry run: quote -> authorize -> verify (no broadcast)
npm run dev -- --payee 0xPayeeAddress --service yield-scout/scan --price 0.05 --calls 3

# Real settlement (funded payer wallet, ERC-20 transfer broadcast)
npm run dev -- --payee 0xPayeeAddress --service yield-scout/scan --amount 0.05 --settle

# Run as an MCP server (Claude Code / Codex / any MCP client)
npm run mcp
```

## Composition (Phase 2)
`pharos-agent-pay` is the payment rail under the other Pharos Skills:
1. `pharos-yield-scout` finds idle capital → charges per scan via `AGENT_PAY_SETTLE`.
2. `pharos-identity-auditor` gates *who* may be paid (reputation check before authorize).
3. `pharos-warden-firewall` can wrap the settlement transfer under a signed policy.
4. `pharos-swarm-coordinator` lets a multisig treasury be the payer.

Together they form a marketplace where agents discover, trust, pay, and transact with each other on Pharos.
