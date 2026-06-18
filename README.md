# Pharos Agent Pay

> Agent-to-agent metered payments on Pharos — the settlement rail for the agent economy.

One agent pays another **per service call** without deploying a contract per integration. The payer signs a capped EIP-712 spend voucher; the payee draws it down as it delivers work; each draw settles on-chain as an ERC-20 transfer.

```
QUOTE ─▶ AUTHORIZE ─▶ VERIFY ─▶ SETTLE ─▶ RECEIPT ─▶ COUNTER-SIGN ─▶ VERIFY RECEIPT
 price    sign cap     check sig  draw ≤    saved      payee EIP-712    non-repudiable
                                  cap +     to disk    acknowledges     proof of payment
                                  ERC-20
```

## Why
Pharos is built for the AI-agent economy: agents that transact and interact on-chain. Every Skill an agent exposes should be *sellable*. `pharos-agent-pay` is the shared primitive that makes that possible — price a Skill per call and get paid through one rail, instead of wiring custom payments into each service.

## Actions (MCP / agent-kit)
- `AGENT_PAY_QUOTE` — advertise a per-call price; compute the total to pre-authorize.
- `AGENT_PAY_AUTHORIZE` — sign an EIP-712 `PaymentAuthorization` capped at `maxAmount`.
- `AGENT_PAY_VERIFY` — verify a voucher's signature, expiry, and remaining balance.
- `AGENT_PAY_SETTLE` — draw a metered amount within the cap, execute the ERC-20 payment, and emit + save a receipt.
- `AGENT_PAY_SIGN_RECEIPT` — payee counter-signs a receipt (EIP-712) for non-repudiable proof.
- `AGENT_PAY_VERIFY_RECEIPT` — verify a receipt's counter-signature, inline or from a saved file.

## Receipts
Every settlement returns a `Receipt` (`payer, payee, token, amount, serviceId, authorizationHash, nonce, txHash, chainId, settledAt, explorerUrl`) and writes it to `RECEIPTS_DIR/<txHash>.json` (default `./receipts`; opt out with `save_receipt: false`). The payee can counter-sign it so both parties hold portable, verifiable proof the payment happened — checkable offline via `AGENT_PAY_VERIFY_RECEIPT`.

## Guarantees
- Settlement refused unless the signature resolves to `payer`.
- Cumulative draws can never exceed the voucher cap (in-memory `SpendLedger`).
- Settlement after `deadline` is refused.
- Failed on-chain transfer rolls the ledger back — the cap is never burned on a revert.
- Receipts are tamper-evident: any field change invalidates the payee counter-signature.

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

## Environment
| Var | Required | Purpose |
|---|---|---|
| `PHAROS_RPC_URL` | no (defaults to testnet) | Pharos RPC endpoint |
| `WALLET_PRIVATE_KEY` | yes | Payer key (authorize/settle); payee key (counter-sign receipts) |
| `PAYMENT_TOKEN_ADDRESS` | no (defaults to USDC) | Default settlement ERC-20 |
| `RECEIPTS_DIR` | no (default `./receipts`) | Where settlement receipts are written |

## Network
Pharos Atlantic testnet — chain id `688689`, RPC `https://atlantic.dplabs-internal.com`, explorer `https://atlantic.pharosscan.xyz`. Default settlement token: testnet USDC (`0x72df…BCcCED`, 6 decimals).

## Design notes
- This release settles **payer-side**: the settling wallet is the voucher's `payer`, moving its own funds to the payee for actual usage. A pull-based variant (payer approves an escrow operator, payee calls `transferFrom`) is the natural next iteration and the path to a fully on-chain escrow contract.
- The `SpendLedger` is in-memory; production should bind it to on-chain allowance/nonce state and a persistent store.

See [SKILL.md](./SKILL.md) for the full action reference and Phase 2 composition story.

MIT.
