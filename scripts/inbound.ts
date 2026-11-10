// Base Sepolia -> Sui. The Base wallet burns with a Fast Transfer; the relayer mints on Sui and
// pays the SUI, so the Sui recipient needs no gas at all.
//   pnpm inbound <amountUSDC=0.5> [suiRecipient=DEMO_SUI_KEY address]
import './_env.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { createWalletClient, http, zeroHash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { need } from './_env.js';
import { BASE_SEPOLIA, FINALITY, SUI } from '../shared/config.js';
import { fmtUsdc, parseUsdc } from '../shared/corridor.js';
import { erc20, fastMaxFee, tokenMessengerV2 } from '../shared/evm.js';
import { base } from '../api/_lib/server.js';
import { follow } from './_follow.js';

const amount = parseUsdc(process.argv[2] ?? '0.5');
if (amount == null) throw new Error('amount must be a USDC number with at most 6 decimals');
const recipient = process.argv[3] ?? Ed25519Keypair.fromSecretKey(need('DEMO_SUI_KEY')).toSuiAddress();
const account = privateKeyToAccount(need('DEMO_EVM_KEY') as Hex);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(process.env.BASE_SEPOLIA_RPC) });

const [eth, usdc] = await Promise.all([
	base.getBalance({ address: account.address }),
	base.readContract({ address: BASE_SEPOLIA.usdc, abi: erc20, functionName: 'balanceOf', args: [account.address] }),
]);
console.log(`Base wallet ${account.address}: ${Number(eth) / 1e18} ETH, ${fmtUsdc(usdc)} USDC`);
if (usdc < amount) throw new Error(`needs ${fmtUsdc(amount)} USDC on Base Sepolia: https://faucet.circle.com`);
if (eth === 0n) throw new Error('needs a little Base Sepolia ETH for the approve and burn');

const allowance = await base.readContract({ address: BASE_SEPOLIA.usdc, abi: erc20, functionName: 'allowance', args: [account.address, BASE_SEPOLIA.tokenMessenger] });
if (allowance < amount) {
	const h = await wallet.writeContract({ address: BASE_SEPOLIA.usdc, abi: erc20, functionName: 'approve', args: [BASE_SEPOLIA.tokenMessenger, amount] });
	await base.waitForTransactionReceipt({ hash: h });
	console.log(`approve ${BASE_SEPOLIA.explorer}/tx/${h}`);
}
const maxFee = fastMaxFee(amount);
const mintRecipient = recipient as Hex; // a Sui address is already 32 bytes
const hash = await wallet.writeContract({
	address: BASE_SEPOLIA.tokenMessenger,
	abi: tokenMessengerV2,
	functionName: 'depositForBurn',
	args: [amount, SUI.domain, mintRecipient, BASE_SEPOLIA.usdc, zeroHash, maxFee, FINALITY.fast],
});
const receipt = await base.waitForTransactionReceipt({ hash });
console.log(`burn on Base: ${receipt.status} ${BASE_SEPOLIA.explorer}/tx/${hash}\n  fast transfer, Circle max fee ${fmtUsdc(maxFee)}, recipient ${recipient}`);
await follow('in', hash);
