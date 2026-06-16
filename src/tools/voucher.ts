import {
  hashTypedData,
  verifyTypedData,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { pharosTestnet } from '../chains.js';

/**
 * A PaymentAuthorization is an off-chain, EIP-712 signed "spend voucher" from a
 * paying agent to a service-providing agent. It authorizes the payee (or a
 * relayer holding the payer's settlement key) to pull up to `maxAmount` of
 * `token`, drawn down incrementally across many metered service calls, until
 * `deadline`. The `nonce` makes each authorization unique and replayable-safe.
 *
 * This is the composable settlement primitive for the Pharos agent economy:
 * any agent that sells a Skill can price it per call and get paid without a
 * bespoke contract per integration.
 */
export interface PaymentAuthorization {
  payer: Address;
  payee: Address;
  token: Address;
  /** Max total spend across the lifetime of this authorization, in token base units. */
  maxAmount: bigint;
  /** Unix seconds after which the authorization can no longer be settled. */
  deadline: bigint;
  /** Unique per (payer, payee, service) authorization. */
  nonce: bigint;
  /** Free-form service identifier, e.g. "pharos-yield-scout/scan". */
  serviceId: string;
}

export const PAY_DOMAIN = {
  name: 'PharosAgentPay',
  version: '1',
  chainId: pharosTestnet.id,
  // Off-chain settlement boundary — vouchers are verified by signature, not a
  // verifying contract, so this is the zero address by design.
  verifyingContract: '0x0000000000000000000000000000000000000000' as Address,
} as const;

export const PAY_TYPES = {
  PaymentAuthorization: [
    { name: 'payer', type: 'address' },
    { name: 'payee', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'maxAmount', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'serviceId', type: 'string' },
  ],
} as const;

export function authorizationHash(auth: PaymentAuthorization): Hex {
  return hashTypedData({
    domain: PAY_DOMAIN,
    types: PAY_TYPES,
    primaryType: 'PaymentAuthorization',
    message: auth,
  });
}

/** Sign a PaymentAuthorization with the payer's key, producing a portable voucher. */
export async function signAuthorization(
  auth: PaymentAuthorization,
  payerPrivateKey: Hex
): Promise<{ signature: Hex; hash: Hex; signer: Address }> {
  const account = privateKeyToAccount(payerPrivateKey);
  const signature = await account.signTypedData({
    domain: PAY_DOMAIN,
    types: PAY_TYPES,
    primaryType: 'PaymentAuthorization',
    message: auth,
  });
  return { signature, hash: authorizationHash(auth), signer: account.address };
}

/** Verify a voucher's signature resolves to the declared payer. */
export async function verifyAuthorization(
  auth: PaymentAuthorization,
  signature: Hex
): Promise<boolean> {
  try {
    return await verifyTypedData({
      address: auth.payer,
      domain: PAY_DOMAIN,
      types: PAY_TYPES,
      primaryType: 'PaymentAuthorization',
      message: auth,
      signature,
    });
  } catch {
    return false;
  }
}

/**
 * Tracks how much of each authorization has already been settled, so repeated
 * metered draws against one voucher cannot exceed `maxAmount`. In-memory by
 * default; a production deployment should back this with the payer's on-chain
 * allowance and a persistent store. Keyed by authorization hash.
 */
export class SpendLedger {
  private spent = new Map<string, bigint>();

  spentOf(hash: Hex): bigint {
    return this.spent.get(hash.toLowerCase()) ?? 0n;
  }

  remaining(auth: PaymentAuthorization): bigint {
    const rem = auth.maxAmount - this.spentOf(authorizationHash(auth));
    return rem > 0n ? rem : 0n;
  }

  /** Reserve `amount` against the voucher; throws if it would exceed the cap. */
  draw(auth: PaymentAuthorization, amount: bigint): { spent: bigint; remaining: bigint } {
    const hash = authorizationHash(auth).toLowerCase();
    const current = this.spent.get(hash) ?? 0n;
    const next = current + amount;
    if (next > auth.maxAmount) {
      throw new Error(
        `Draw of ${amount} would exceed authorization cap (${current} already spent of ${auth.maxAmount})`
      );
    }
    this.spent.set(hash, next);
    return { spent: next, remaining: auth.maxAmount - next };
  }
}

/** Process-wide ledger shared across action handlers. */
export const ledger = new SpendLedger();
