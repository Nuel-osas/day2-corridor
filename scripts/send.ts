// Sui -> Base Sepolia through Corridor, as a user with USDC and no SUI.
//   pnpm send <amountUSDC=0.25> [baseRecipient=DEMO_EVM_KEY address]
// The operator sponsors the gas, corridor::send takes the fee, CCTP burns the rest,
// then the relayer waits for Circle and mints on Base (it pays the ETH).
import './_env.js';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { privateKeyToAccount } from 'viem/accounts';
import { need } from './_env.js';
import { BASE_SEPOLIA, CORRIDOR, SUI } from '../shared/config.js';
import { addSend, fmtUsdc, parseUsdc, quote } from '../shared/corridor.js';
import { sui } from '../api/_lib/server.js';
import { sponsorAndExecute } from '../api/_lib/sponsor.js';
import { follow } from './_follow.js';

const amount = parseUsdc(process.argv[2] ?? '0.25');
if (amount == null) throw new Error('amount must be a USDC number with at most 6 decimals');
const recipient = process.argv[3] ?? privateKeyToAccount(need('DEMO_EVM_KEY') as `0x${string}`).address;
const user = Ed25519Keypair.fromSecretKey(need('DEMO_SUI_KEY'));
const owner = user.toSuiAddress();

const [usdc, gas] = await Promise.all([
	sui.core.getBalance({ owner, coinType: SUI.usdc }),
	sui.core.getBalance({ owner, coinType: '0x2::sui::SUI' }),
]);
const { fee, net } = quote(amount, CORRIDOR.feeBps, BigInt(CORRIDOR.minFee));
console.log(`user ${owner}\n  USDC ${fmtUsdc(BigInt(usdc.balance.balance))}, SUI ${gas.balance.balance} (gas is sponsored)`);
console.log(`send ${fmtUsdc(amount)} USDC -> ${recipient} on ${BASE_SEPOLIA.name}: Corridor fee ${fmtUsdc(fee)}, burned ${fmtUsdc(net)}`);

const tx = new Transaction();
tx.setSender(owner);
tx.setGasOwner(CORRIDOR.operator);
tx.setGasPayment([]);
addSend(tx, { amount, destinationDomain: BASE_SEPOLIA.domain, mintRecipient: recipient });
const bytes = await tx.build({ client: sui });
const { signature } = await user.signTransaction(bytes);
const res = await sponsorAndExecute(bytes, signature);
console.log(`burn on Sui: ${res.ok ? 'ok' : 'FAILED'} ${SUI.explorer}/tx/${res.digest}`);
if (!res.ok) throw new Error(JSON.stringify(res.error));
await follow('out', res.digest);
