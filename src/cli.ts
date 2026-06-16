import dotenv from 'dotenv';
import minimist from 'minimist';
import { privateKeyToAccount } from 'viem/accounts';
import { type Hex } from 'viem';
import {
  agentPayAuthorizeAction,
  agentPayVerifyAction,
  agentPaySettleAction,
  agentPayQuoteAction,
} from './actions/payment-actions.js';

dotenv.config();

/**
 * Demonstrates the agent-to-agent payment lifecycle:
 *   quote -> authorize (sign voucher) -> verify -> (optionally) settle on-chain.
 *
 *   npm run dev -- --payee 0xPayee --service yield-scout/scan --price 0.05 --calls 3
 *   npm run dev -- --payee 0xPayee --service yield-scout/scan --amount 0.05 --settle
 */
async function main() {
  const args = minimist(process.argv.slice(2), {
    string: ['payee', 'service', 'price', 'amount', 'token'],
    boolean: ['settle'],
    default: { service: 'demo-service/call', price: '0.05', amount: '0.05', calls: 1 },
  });

  const key = process.env.WALLET_PRIVATE_KEY as Hex | undefined;
  if (!key) {
    console.error('Error: set WALLET_PRIVATE_KEY in .env (the paying agent wallet).');
    process.exit(1);
  }
  const payer = privateKeyToAccount(key).address;
  const payee = args.payee || payer; // self for a no-op demo if not provided
  const agent = { privateKey: key };

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('PHAROS AGENT PAY — A2A settlement');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Payer:   ${payer}`);
  console.log(`Payee:   ${payee}`);
  console.log(`Service: ${args.service}`);

  // 1. QUOTE
  const quote = await agentPayQuoteAction.handler(agent, {
    service_id: args.service,
    price_per_call: args.price,
    estimated_calls: Number(args.calls),
    token_address: args.token,
  });
  console.log('\n[1] QUOTE');
  console.log(`    price/call: ${args.price}  ->  authorize ~${(quote as any).data.suggestedMaxAmountHuman}`);

  // 2. AUTHORIZE
  const authRes = await agentPayAuthorizeAction.handler(agent, {
    payee,
    max_amount: (quote as any).data.suggestedMaxAmountHuman,
    service_id: args.service,
    token_address: args.token,
  });
  const { authorization, signature } = (authRes as any).data;
  console.log('\n[2] AUTHORIZE (signed EIP-712 voucher)');
  console.log(`    cap:   ${authorization.maxAmount} base units`);
  console.log(`    nonce: ${authorization.nonce}`);
  console.log(`    sig:   ${signature.slice(0, 22)}...`);

  // 3. VERIFY
  const verifyRes = await agentPayVerifyAction.handler(agent, { authorization, signature });
  console.log('\n[3] VERIFY');
  console.log(`    valid: ${(verifyRes as any).data.validSignature}   expired: ${(verifyRes as any).data.expired}`);
  console.log(`    remaining: ${(verifyRes as any).data.remainingBaseUnits} base units`);

  // 4. SETTLE (only with --settle and a funded wallet)
  if (args.settle) {
    if (payee.toLowerCase() === payer.toLowerCase()) {
      console.log('\n[4] SETTLE skipped — payee equals payer (pass --payee to settle for real).');
    } else {
      console.log('\n[4] SETTLE (broadcasting on-chain ERC-20 transfer)...');
      const settleRes = await agentPaySettleAction.handler(agent, {
        authorization,
        signature,
        amount: args.amount,
      });
      console.log(`    status: ${(settleRes as any).status}`);
      console.log(`    ${(settleRes as any).message}`);
    }
  } else {
    console.log('\n[4] SETTLE skipped (dry run). Re-run with --settle and a funded wallet to broadcast.');
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch((err) => {
  console.error('agent-pay failed:', err.message || err);
  process.exit(1);
});
