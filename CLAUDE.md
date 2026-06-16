# PHAROS-AGENT-PAY

Agent-to-agent metered payments on Pharos: EIP-712 spend vouchers settled on-chain per service call.

## Status
No brain project file yet. If this becomes active work, create ~/brain/projects/PHAROS-AGENT-PAY.md.

## Run
- `npm run build` — tsc
- `npm run dev` — tsx src/cli.ts (quote → authorize → verify; add --settle to broadcast)
- `npm run mcp` — tsx src/mcp-server.ts
- `npm run start` — node dist/cli.js
- `npm run lint` — tsc --noEmit

## Rules
- Before marking anything shipped: run the pre-ship checklist in ~/brain/skills/ship-verification.md
- Deployed addresses and chain params belong in this file, not in chat.
