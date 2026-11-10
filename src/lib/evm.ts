// The EVM side of CCTP V2 for routes that touch Sui, signed by the user's own EVM wallet.
// Same two contracts on every EVM chain: TokenMessengerV2.depositForBurn and
// MessageTransmitterV2.receiveMessage. EVM to EVM routes go through Bridge Kit instead (kit.ts).
import { createPublicClient, createWalletClient, custom, defineChain, http, numberToHex, pad, parseAbi, zeroHash, type Hex } from 'viem';
import type { Chain } from './chains';
import type { Eip1193 } from './wallets';

const erc20 = parseAbi([
	'function balanceOf(address) view returns (uint256)',
	'function allowance(address, address) view returns (uint256)',
	'function approve(address, uint256) returns (bool)',
]);
const tokenMessenger = parseAbi([
	'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
]);
const transmitter = parseAbi([
	'function receiveMessage(bytes message, bytes attestation) returns (bool)',
	'function usedNonces(bytes32) view returns (uint256)',
]);

const viemChain = (c: Chain) =>
	defineChain({ id: c.chainId!, name: c.name, nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 }, rpcUrls: { default: { http: c.rpc ? [c.rpc] : [] } } });
const reader = (c: Chain) => createPublicClient({ chain: viemChain(c), transport: http(c.rpc) });

export const evmTo32 = (addr: string) => pad(addr as Hex, { size: 32 });

/** Ask the wallet to switch to `c`, adding the network if it does not know it yet. */
export async function switchTo(p: Eip1193, c: Chain) {
	const want = numberToHex(c.chainId!);
	if ((await p.request({ method: 'eth_chainId' })) === want) return;
	try {
		await p.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: want }] });
	} catch (e) {
		if ((e as { code?: number }).code !== 4902) throw e;
		await p.request({ method: 'wallet_addEthereumChain', params: [{ chainId: want, chainName: c.name, nativeCurrency: { name: c.nativeSymbol, symbol: c.nativeSymbol, decimals: 18 }, rpcUrls: [c.rpc] }] });
	}
}

/**
 * Approve if needed, then depositForBurn. The burn hash is reported the moment the wallet returns
 * it, before the receipt, so a retry can settle this burn instead of sending a second one.
 */
export async function evmBurn(o: {
	provider: Eip1193; owner: string; chain: Chain; amount: bigint; destDomain: number; recipient32: Hex;
	maxFee: bigint; finality: number; onApproved?: (tx?: string) => void; onBurnSent?: (tx: string) => void;
}) {
	await switchTo(o.provider, o.chain);
	const account = o.owner as Hex;
	const chain = viemChain(o.chain);
	const pub = reader(o.chain);
	const wal = createWalletClient({ chain, account, transport: custom(o.provider) });
	const usdc = o.chain.usdc as Hex;
	const messenger = o.chain.tokenMessenger as Hex;
	const allowance = await pub.readContract({ address: usdc, abi: erc20, functionName: 'allowance', args: [account, messenger] });
	let approveTx: string | undefined;
	if (allowance < o.amount) {
		approveTx = await wal.writeContract({ address: usdc, abi: erc20, functionName: 'approve', args: [messenger, o.amount] });
		const r = await pub.waitForTransactionReceipt({ hash: approveTx as Hex });
		if (r.status !== 'success') throw new Error('The approval reverted. Nothing was burned.');
	}
	o.onApproved?.(approveTx);
	const hash = await wal.writeContract({
		address: messenger, abi: tokenMessenger, functionName: 'depositForBurn',
		args: [o.amount, o.destDomain, o.recipient32, usdc, zeroHash, o.maxFee, o.finality],
	});
	o.onBurnSent?.(hash);
	const r = await pub.waitForTransactionReceipt({ hash, timeout: 600_000 });
	if (r.status !== 'success') throw new Error('The burn reverted, so nothing left your wallet.');
	return hash as string;
}

/** Wait for a burn we recorded but never saw confirm (the tab closed). */
export async function settleEvmBurn(c: Chain, hash: string) {
	const r = await reader(c).waitForTransactionReceipt({ hash: hash as Hex, timeout: 600_000 });
	return r.status === 'success';
}

/** True if this CCTP V2 message was already received on `c`, by anyone. Null if unknown. */
export async function evmMessageUsed(c: Chain, message: string): Promise<boolean | null> {
	if (!c.rpc || !c.messageTransmitter || message.length < 2 + 88) return null;
	// V2 header: version (4) . source domain (4) . destination domain (4) . nonce (32) ...
	const nonce = `0x${message.slice(2 + 24, 2 + 88)}` as Hex;
	try {
		return (await reader(c).readContract({ address: c.messageTransmitter as Hex, abi: transmitter, functionName: 'usedNonces', args: [nonce] })) > 0n;
	} catch {
		return null;
	}
}

/** The user claims on EVM: receiveMessage, paid with the user's gas. */
export async function evmMint(o: { provider: Eip1193; owner: string; chain: Chain; message: Hex; attestation: Hex; onSent?: (tx: string) => void }) {
	await switchTo(o.provider, o.chain);
	const account = o.owner as Hex;
	const wal = createWalletClient({ chain: viemChain(o.chain), account, transport: custom(o.provider) });
	const hash = await wal.writeContract({ address: o.chain.messageTransmitter as Hex, abi: transmitter, functionName: 'receiveMessage', args: [o.message, o.attestation] });
	o.onSent?.(hash);
	const r = await reader(o.chain).waitForTransactionReceipt({ hash, timeout: 600_000 });
	if (r.status !== 'success') throw new Error('The mint reverted. It may already have been claimed: check again.');
	return hash as string;
}

/** USDC and gas on an EVM chain, base units. A failed read is unknown (null), never zero. */
export async function evmBalances(c: Chain, owner: string) {
	const pub = reader(c);
	const [usdc, gas] = await Promise.all([
		pub.readContract({ address: c.usdc as Hex, abi: erc20, functionName: 'balanceOf', args: [owner as Hex] }).catch(() => null),
		pub.getBalance({ address: owner as Hex }).catch(() => null),
	]);
	return { usdc, gas };
}
