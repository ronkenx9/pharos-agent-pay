import { defineChain, type Address, type PublicClient } from 'viem';

export const pharosTestnet = defineChain({
  id: 688689,
  name: 'Pharos Atlantic Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://atlantic.dplabs-internal.com'] },
    public: { http: ['https://atlantic.dplabs-internal.com'] },
  },
  blockExplorers: {
    default: {
      name: 'Pharos Scan',
      url: 'https://atlantic.pharosscan.xyz',
    },
  },
  testnet: true,
});

// Default settlement token: Pharos Atlantic testnet USDC (6 decimals).
export const DEFAULT_PAYMENT_TOKEN = '0x72df0bcd7276f2dFbAc900D1CE63c272C4BCcCED' as Address;

export const KNOWN_TOKENS = [
  { symbol: 'USDC', address: '0x72df0bcd7276f2dFbAc900D1CE63c272C4BCcCED' as const, decimals: 6 },
  { symbol: 'USDT', address: '0xD4071393f8716661958F766DF660033b3d35fD29' as const, decimals: 6 },
  { symbol: 'WETH', address: '0x4E28826d32F1C398DED160DC16Ac6873357d048f' as const, decimals: 18 },
];

const DECIMALS_ABI = [
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint8' }] },
] as const;

const decimalsCache = new Map<string, number>();

/**
 * Resolve an ERC-20's decimals via the live `decimals()` call, falling back to
 * the KNOWN_TOKENS table and finally 18. Cached per address.
 */
export async function getTokenDecimals(
  client: PublicClient,
  tokenAddress: Address
): Promise<number> {
  const key = tokenAddress.toLowerCase();
  const cached = decimalsCache.get(key);
  if (cached !== undefined) return cached;

  let decimals = KNOWN_TOKENS.find((t) => t.address.toLowerCase() === key)?.decimals;
  try {
    const onchain = await client.readContract({
      address: tokenAddress,
      abi: DECIMALS_ABI,
      functionName: 'decimals',
    });
    decimals = Number(onchain);
  } catch {
    // decimals() not exposed — use known table or default.
  }

  const resolved = decimals ?? 18;
  decimalsCache.set(key, resolved);
  return resolved;
}
