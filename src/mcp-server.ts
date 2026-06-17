import { PharosAgentKit, startMcpServer } from 'pharos-agent-kit';
import { ACTIONS } from './actions/payment-actions.js';
import dotenv from 'dotenv';

dotenv.config();

const privateKey = process.env.WALLET_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001';
const rpcUrl = process.env.PHAROS_RPC_URL || 'https://atlantic.dplabs-internal.com';

const agent = new PharosAgentKit(privateKey, rpcUrl);
// Expose the key to custom action handlers (same pattern as the other Pharos skills).
(agent as any).privateKey = privateKey;

const actions = {
  AGENT_PAY_QUOTE: ACTIONS.AGENT_PAY_QUOTE as any,
  AGENT_PAY_AUTHORIZE: ACTIONS.AGENT_PAY_AUTHORIZE as any,
  AGENT_PAY_VERIFY: ACTIONS.AGENT_PAY_VERIFY as any,
  AGENT_PAY_SETTLE: ACTIONS.AGENT_PAY_SETTLE as any,
  AGENT_PAY_SIGN_RECEIPT: ACTIONS.AGENT_PAY_SIGN_RECEIPT as any,
  AGENT_PAY_VERIFY_RECEIPT: ACTIONS.AGENT_PAY_VERIFY_RECEIPT as any,
};

async function main() {
  console.error('Starting Pharos Agent Pay MCP Server...');
  await startMcpServer(actions, agent, {
    name: 'pharos-agent-pay',
    version: '1.0.0',
  });
}

main().catch((err) => {
  console.error('Failed to start MCP server:', err);
  process.exit(1);
});
