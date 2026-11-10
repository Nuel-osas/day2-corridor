// The EVM side of CCTP V2 that Corridor touches. Same ABI on every EVM chain.
import { parseAbi } from 'viem';

export const erc20 = parseAbi([
	'function approve(address spender, uint256 amount) returns (bool)',
	'function allowance(address owner, address spender) view returns (uint256)',
	'function balanceOf(address owner) view returns (uint256)',
]);

export const tokenMessengerV2 = parseAbi([
	'function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)',
]);

/** Circle's fast-transfer fee into Sui was 1 bp in live testnet mints; allow up to 5 bp. */
export const fastMaxFee = (amount: bigint) => {
	const f = (amount * 5n) / 10_000n;
	return f > 0n ? f : 1n;
};
