import { z } from 'zod';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { pharosTestnet, DEFAULT_PAYMENT_TOKEN, getTokenDecimals } from '../chains.js';
import {
  signAuthorization,
  verifyAuthorization,
  authorizationHash,
  ledger,
  type PaymentAuthorization,
} from '../tools/voucher.js';
import {
  buildReceipt,
  saveReceipt,
  signReceipt,
  verifyReceipt,
  loadReceipt,
  type Receipt,
} from '../tools/receipt.js';

const ERC20_TRANSFER_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

function rpcOf(input: Record<string, any>): string {
  return input.rpc_url || process.env.PHAROS_RPC_URL || pharosTestnet.rpcUrls.default.http[0];
}

const authShape = z.object({
  payer: z.string(),
  payee: z.string(),
  token: z.string(),
  maxAmount: z.string().describe('Max total spend in token base units (string)'),
  deadline: z.string().describe('Unix seconds deadline (string)'),
  nonce: z.string(),
  serviceId: z.string(),
});

function toAuth(a: z.infer<typeof authShape>): PaymentAuthorization {
  return {
    payer: a.payer as Address,
    payee: a.payee as Address,
    token: a.token as Address,
    maxAmount: BigInt(a.maxAmount),
    deadline: BigInt(a.deadline),
    nonce: BigInt(a.nonce),
    serviceId: a.serviceId,
  };
}

/**
 * QUOTE — a service-providing agent advertises a price for a metered unit of a
 * named service and tells the caller how to authorize payment for it.
 */
export const agentPayQuoteAction = {
  name: 'AGENT_PAY_QUOTE',
  similes: ['quote service price', 'price a skill call', 'how much to call this agent'],
  description: 'Returns a metered price quote for a named service and the total a payer should authorize for N calls.',
  schema: z.object({
    service_id: z.string().describe('Service identifier, e.g. "pharos-yield-scout/scan"'),
    price_per_call: z.string().describe('Price per call in token units (e.g. "0.05")'),
    estimated_calls: z.number().optional().describe('Calls to pre-authorize (default 1)'),
    token_address: z.string().optional(),
    rpc_url: z.string().optional(),
  }),
  handler: async (_agent: any, input: Record<string, any>) => {
    const token = (input.token_address || DEFAULT_PAYMENT_TOKEN) as Address;
    const client = createPublicClient({ chain: pharosTestnet, transport: http(rpcOf(input)) });
    const decimals = await getTokenDecimals(client, token);
    const calls = input.estimated_calls ?? 1;
    const perCall = parseUnits(input.price_per_call, decimals);
    const total = perCall * BigInt(calls);
    return {
      status: 'success',
      data: {
        serviceId: input.service_id,
        token,
        decimals,
        pricePerCallBaseUnits: perCall.toString(),
        suggestedMaxAmountBaseUnits: total.toString(),
        suggestedMaxAmountHuman: formatUnits(total, decimals),
      },
      message: `Authorize up to ${formatUnits(total, decimals)} for ${calls} call(s) of ${input.service_id}.`,
    };
  },
};

/**
 * AUTHORIZE — the paying agent signs an EIP-712 spend voucher capped at
 * maxAmount. The signed voucher is portable: hand it to the payee agent.
 */
export const agentPayAuthorizeAction = {
  name: 'AGENT_PAY_AUTHORIZE',
  similes: ['authorize agent payment', 'sign spend voucher', 'pre-approve service spend'],
  description: 'Signs an EIP-712 PaymentAuthorization voucher capping how much a payee agent may draw for a service.',
  schema: z.object({
    payee: z.string().describe('Service-providing agent address'),
    max_amount: z.string().describe('Spend cap in token units (e.g. "1.0")'),
    service_id: z.string(),
    token_address: z.string().optional(),
    ttl_seconds: z.number().optional().describe('Voucher lifetime in seconds (default 3600)'),
    nonce: z.string().optional().describe('Unique nonce; defaults to current ms timestamp'),
    private_key: z.string().optional(),
    rpc_url: z.string().optional(),
  }),
  handler: async (agent: any, input: Record<string, any>) => {
    const key = (input.private_key || agent?.privateKey || process.env.WALLET_PRIVATE_KEY) as Hex | undefined;
    if (!key) return { status: 'error', message: 'Payer private key missing.' };

    const token = (input.token_address || DEFAULT_PAYMENT_TOKEN) as Address;
    const client = createPublicClient({ chain: pharosTestnet, transport: http(rpcOf(input)) });
    const decimals = await getTokenDecimals(client, token);
    const payer = privateKeyToAccount(key).address;

    const auth: PaymentAuthorization = {
      payer,
      payee: input.payee as Address,
      token,
      maxAmount: parseUnits(input.max_amount, decimals),
      deadline: BigInt(Math.floor(Date.now() / 1000) + (input.ttl_seconds ?? 3600)),
      nonce: BigInt(input.nonce ?? Date.now()),
      serviceId: input.service_id,
    };

    const { signature, hash } = await signAuthorization(auth, key);
    return {
      status: 'success',
      data: {
        authorization: {
          payer: auth.payer,
          payee: auth.payee,
          token: auth.token,
          maxAmount: auth.maxAmount.toString(),
          deadline: auth.deadline.toString(),
          nonce: auth.nonce.toString(),
          serviceId: auth.serviceId,
        },
        signature,
        hash,
      },
      message: `Authorized up to ${input.max_amount} for ${input.service_id}.`,
    };
  },
};

/** VERIFY — read-only check that a voucher is well-formed, unexpired, and signed by the payer. */
export const agentPayVerifyAction = {
  name: 'AGENT_PAY_VERIFY',
  similes: ['verify payment voucher', 'check spend authorization', 'validate agent payment'],
  description: 'Verifies a PaymentAuthorization signature and reports its remaining spendable balance and expiry.',
  schema: z.object({
    authorization: authShape,
    signature: z.string(),
  }),
  handler: async (_agent: any, input: Record<string, any>) => {
    const auth = toAuth(input.authorization);
    const validSig = await verifyAuthorization(auth, input.signature as Hex);
    const now = BigInt(Math.floor(Date.now() / 1000));
    const expired = now > auth.deadline;
    return {
      status: validSig && !expired ? 'success' : 'error',
      data: {
        validSignature: validSig,
        expired,
        hash: authorizationHash(auth),
        remainingBaseUnits: ledger.remaining(auth).toString(),
      },
      message: !validSig
        ? 'Signature does not match payer.'
        : expired
          ? 'Authorization has expired.'
          : 'Authorization is valid.',
    };
  },
};

/**
 * SETTLE — draw a metered amount against a verified voucher and move it
 * on-chain. Runs in the payer's runtime: the settling wallet must be the
 * authorization's payer, so the transfer is the payer paying the payee for
 * actual usage. The SpendLedger enforces the cap across repeated draws.
 */
export const agentPaySettleAction = {
  name: 'AGENT_PAY_SETTLE',
  similes: ['settle agent payment', 'pay for service call', 'draw down voucher', 'release metered payment'],
  description: 'Validates a voucher, draws a metered amount within its cap, and executes the on-chain ERC-20 payment to the payee.',
  schema: z.object({
    authorization: authShape,
    signature: z.string(),
    amount: z.string().describe('Amount to settle for this draw, in token units (e.g. "0.05")'),
    save_receipt: z.boolean().optional().describe('Write a JSON receipt to RECEIPTS_DIR (default true)'),
    private_key: z.string().optional(),
    rpc_url: z.string().optional(),
  }),
  handler: async (agent: any, input: Record<string, any>) => {
    const key = (input.private_key || agent?.privateKey || process.env.WALLET_PRIVATE_KEY) as Hex | undefined;
    if (!key) return { status: 'error', message: 'Settling (payer) private key missing.' };

    const auth = toAuth(input.authorization);

    // 1. Signature + payer binding
    if (!(await verifyAuthorization(auth, input.signature as Hex))) {
      return { status: 'error', message: 'Invalid voucher signature — refusing to settle.' };
    }
    const account = privateKeyToAccount(key);
    if (account.address.toLowerCase() !== auth.payer.toLowerCase()) {
      return {
        status: 'error',
        message: `Settling wallet ${account.address} is not the authorization payer ${auth.payer}.`,
      };
    }

    // 2. Deadline
    if (BigInt(Math.floor(Date.now() / 1000)) > auth.deadline) {
      return { status: 'blocked', message: 'Authorization expired — settlement refused.' };
    }

    // 3. Cap enforcement via ledger
    const client = createPublicClient({ chain: pharosTestnet, transport: http(rpcOf(input)) });
    const decimals = await getTokenDecimals(client, auth.token);
    const drawAmount = parseUnits(input.amount, decimals);
    let drawResult: { spent: bigint; remaining: bigint };
    try {
      drawResult = ledger.draw(auth, drawAmount);
    } catch (err: any) {
      return { status: 'blocked', message: `Cap exceeded: ${err.message || err}` };
    }

    // 4. On-chain ERC-20 transfer payer -> payee
    try {
      const walletClient = createWalletClient({ account, chain: pharosTestnet, transport: http(rpcOf(input)) });
      const hash = await walletClient.writeContract({
        address: auth.token,
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [auth.payee, drawAmount],
      });

      // Produce a durable, serializable receipt for this settlement.
      const receipt = buildReceipt({ auth, amount: drawAmount, amountHuman: input.amount, txHash: hash });
      let receiptPath: string | undefined;
      if (input.save_receipt !== false) {
        try {
          receiptPath = saveReceipt(receipt);
        } catch {
          // Persisting is best-effort; the receipt is still returned in-band.
        }
      }

      return {
        status: 'success',
        txHash: hash,
        data: {
          serviceId: auth.serviceId,
          settledBaseUnits: drawAmount.toString(),
          settledHuman: input.amount,
          totalSpentBaseUnits: drawResult.spent.toString(),
          remainingBaseUnits: drawResult.remaining.toString(),
          receipt,
          receiptPath,
        },
        message: `Settled ${input.amount} to ${auth.payee} for ${auth.serviceId}. Tx: ${hash}`,
      };
    } catch (err: any) {
      // Roll the ledger back so a failed on-chain send doesn't burn the cap.
      ledger.draw(auth, -drawAmount);
      return { status: 'error', message: `On-chain settlement failed: ${err.message || err}` };
    }
  },
};

const receiptShape = z.object({
  payer: z.string(),
  payee: z.string(),
  token: z.string(),
  amount: z.string(),
  amountHuman: z.string(),
  serviceId: z.string(),
  authorizationHash: z.string(),
  nonce: z.string(),
  txHash: z.string(),
  chainId: z.number(),
  settledAt: z.string(),
  explorerUrl: z.string(),
});

/**
 * SIGN_RECEIPT — the payee counter-signs a settlement receipt, acknowledging
 * the payment. Runs in the payee's runtime. Produces a non-repudiable proof and
 * re-saves the receipt with the signature attached.
 */
export const agentPaySignReceiptAction = {
  name: 'AGENT_PAY_SIGN_RECEIPT',
  similes: ['acknowledge payment', 'counter-sign receipt', 'confirm payment received'],
  description: "Payee counter-signs a settlement receipt (EIP-712), making it non-repudiable, and saves it with the signature.",
  schema: z.object({
    receipt: receiptShape,
    save_receipt: z.boolean().optional().describe('Re-save the receipt with the signature (default true)'),
    private_key: z.string().optional().describe("Payee private key; defaults to the agent/env key"),
  }),
  handler: async (agent: any, input: Record<string, any>) => {
    const key = (input.private_key || agent?.privateKey || process.env.WALLET_PRIVATE_KEY) as Hex | undefined;
    if (!key) return { status: 'error', message: 'Payee private key missing.' };

    const receipt = input.receipt as Receipt;
    const signer = privateKeyToAccount(key).address;
    if (signer.toLowerCase() !== receipt.payee.toLowerCase()) {
      return { status: 'error', message: `Signing wallet ${signer} is not the receipt payee ${receipt.payee}.` };
    }

    const { signature } = await signReceipt(receipt, key);
    let receiptPath: string | undefined;
    if (input.save_receipt !== false) {
      try {
        receiptPath = saveReceipt(receipt, signature);
      } catch {
        // best-effort persistence
      }
    }
    return {
      status: 'success',
      data: { payeeSignature: signature, receiptPath },
      message: `Receipt for ${receipt.serviceId} counter-signed by payee.`,
    };
  },
};

/**
 * VERIFY_RECEIPT — verify a receipt's payee counter-signature, from an inline
 * receipt+signature or a saved receipt file on disk.
 */
export const agentPayVerifyReceiptAction = {
  name: 'AGENT_PAY_VERIFY_RECEIPT',
  similes: ['verify payment receipt', 'check receipt signature', 'validate proof of payment'],
  description: 'Verifies a receipt is counter-signed by its payee. Accepts an inline receipt+signature or a saved receipt path.',
  schema: z.object({
    receipt: receiptShape.optional(),
    signature: z.string().optional(),
    path: z.string().optional().describe('Path to a saved receipt JSON (alternative to inline receipt)'),
  }),
  handler: async (_agent: any, input: Record<string, any>) => {
    let receipt = input.receipt as Receipt | undefined;
    let signature = input.signature as Hex | undefined;

    if (input.path) {
      try {
        const saved = loadReceipt(input.path);
        receipt = saved.receipt;
        signature = saved.payeeSignature;
      } catch (err: any) {
        return { status: 'error', message: `Could not load receipt: ${err.message || err}` };
      }
    }

    if (!receipt) return { status: 'error', message: 'No receipt provided.' };
    if (!signature) {
      return {
        status: 'error',
        data: { countersigned: false },
        message: 'Receipt has no payee counter-signature.',
      };
    }

    const valid = await verifyReceipt(receipt, signature);
    return {
      status: valid ? 'success' : 'error',
      data: {
        countersigned: valid,
        payee: receipt.payee,
        txHash: receipt.txHash,
        explorerUrl: receipt.explorerUrl,
      },
      message: valid
        ? `Valid receipt: ${receipt.amountHuman} to ${receipt.payee} for ${receipt.serviceId}.`
        : 'Receipt counter-signature does not match payee.',
    };
  },
};

export const ACTIONS = {
  AGENT_PAY_QUOTE: agentPayQuoteAction,
  AGENT_PAY_AUTHORIZE: agentPayAuthorizeAction,
  AGENT_PAY_VERIFY: agentPayVerifyAction,
  AGENT_PAY_SETTLE: agentPaySettleAction,
  AGENT_PAY_SIGN_RECEIPT: agentPaySignReceiptAction,
  AGENT_PAY_VERIFY_RECEIPT: agentPayVerifyReceiptAction,
};
