import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { pharosTestnet } from '../chains.js';
import { PAY_DOMAIN, type PaymentAuthorization, authorizationHash } from './voucher.js';

/**
 * A Receipt is the durable, serializable proof that a metered payment settled
 * on-chain. All numeric fields are strings so it round-trips cleanly through
 * JSON. It can be saved to disk and later re-verified — either against the
 * chain (via txHash) or against the payee's EIP-712 counter-signature, which
 * makes it non-repudiable: both parties can prove the payment occurred.
 */
export interface Receipt {
  payer: Address;
  payee: Address;
  token: Address;
  /** Settled amount for this draw, in token base units. */
  amount: string;
  /** Same amount rendered with the token's decimals. */
  amountHuman: string;
  serviceId: string;
  /** EIP-712 hash of the authorization this draw was made against. */
  authorizationHash: Hex;
  nonce: string;
  /** On-chain settlement transaction hash. */
  txHash: Hex;
  chainId: number;
  /** Unix seconds when the receipt was produced. */
  settledAt: string;
  /** Block explorer link for the settlement tx. */
  explorerUrl: string;
}

export const RECEIPT_TYPES = {
  PaymentReceipt: [
    { name: 'payer', type: 'address' },
    { name: 'payee', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'serviceId', type: 'string' },
    { name: 'authorizationHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'txHash', type: 'bytes32' },
    { name: 'settledAt', type: 'uint256' },
  ],
} as const;

function explorerTxUrl(txHash: Hex): string {
  const base = pharosTestnet.blockExplorers?.default.url ?? '';
  return base ? `${base}/tx/${txHash}` : txHash;
}

/** Assemble a Receipt from a settled authorization draw. */
export function buildReceipt(params: {
  auth: PaymentAuthorization;
  amount: bigint;
  amountHuman: string;
  txHash: Hex;
}): Receipt {
  const { auth, amount, amountHuman, txHash } = params;
  return {
    payer: auth.payer,
    payee: auth.payee,
    token: auth.token,
    amount: amount.toString(),
    amountHuman,
    serviceId: auth.serviceId,
    authorizationHash: authorizationHash(auth),
    nonce: auth.nonce.toString(),
    txHash,
    chainId: pharosTestnet.id,
    settledAt: Math.floor(Date.now() / 1000).toString(),
    explorerUrl: explorerTxUrl(txHash),
  };
}

/** Convert a serialized Receipt into the typed message used for EIP-712. */
function toTypedMessage(r: Receipt) {
  return {
    payer: r.payer,
    payee: r.payee,
    token: r.token,
    amount: BigInt(r.amount),
    serviceId: r.serviceId,
    authorizationHash: r.authorizationHash,
    nonce: BigInt(r.nonce),
    txHash: r.txHash,
    settledAt: BigInt(r.settledAt),
  };
}

/**
 * Payee counter-signs a receipt (acknowledging payment was received). Produces
 * a non-repudiable proof: the payee cannot later deny having been paid.
 */
export async function signReceipt(
  receipt: Receipt,
  payeePrivateKey: Hex
): Promise<{ signature: Hex; signer: Address }> {
  const account = privateKeyToAccount(payeePrivateKey);
  const signature = await account.signTypedData({
    domain: PAY_DOMAIN,
    types: RECEIPT_TYPES,
    primaryType: 'PaymentReceipt',
    message: toTypedMessage(receipt),
  });
  return { signature, signer: account.address };
}

/** Verify a receipt's counter-signature resolves to the receipt's payee. */
export async function verifyReceipt(receipt: Receipt, signature: Hex): Promise<boolean> {
  try {
    return await verifyTypedData({
      address: receipt.payee,
      domain: PAY_DOMAIN,
      types: RECEIPT_TYPES,
      primaryType: 'PaymentReceipt',
      message: toTypedMessage(receipt),
      signature,
    });
  } catch {
    return false;
  }
}

/** On-disk envelope: the receipt plus an optional payee counter-signature. */
export interface SavedReceipt {
  receipt: Receipt;
  payeeSignature?: Hex;
}

export function receiptsDir(): string {
  return resolve(process.env.RECEIPTS_DIR ?? join(process.cwd(), 'receipts'));
}

/**
 * Persist a receipt as JSON at `<RECEIPTS_DIR>/<txHash>.json`. Returns the
 * absolute path written.
 */
export function saveReceipt(receipt: Receipt, payeeSignature?: Hex): string {
  const dir = receiptsDir();
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${receipt.txHash}.json`);
  const envelope: SavedReceipt = payeeSignature ? { receipt, payeeSignature } : { receipt };
  writeFileSync(path, JSON.stringify(envelope, null, 2));
  return path;
}

export function loadReceipt(path: string): SavedReceipt {
  return JSON.parse(readFileSync(path, 'utf8')) as SavedReceipt;
}
