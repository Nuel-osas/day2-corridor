// One-time setup: open a Corridor<USDC> owned by the operator. Writes shared/deployment.json.
//   pnpm open-corridor [feeBps=30] [minFeeUnits=10000]
import { writeFileSync } from 'node:fs';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { privateKeyToAccount } from 'viem/accounts';
import { need } from './_env.js';
import { CORRIDOR, SUI } from '../shared/config.js';
import { evmToBytes32 } from '../shared/corridor.js';

const feeBps = Number(process.argv[2] ?? 30);
const minFee = BigInt(process.argv[3] ?? 10_000);
const operator = Ed25519Keypair.fromSecretKey(need('OPERATOR_SECRET_KEY'));
const relayerEvm = privateKeyToAccount(need('RELAYER_EVM_KEY') as `0x${string}`).address;
const client = new SuiGrpcClient({ network: SUI.network, baseUrl: SUI.grpc });

const tx = new Transaction();
tx.setSender(operator.toSuiAddress());
const cap = tx.moveCall({
	target: `${CORRIDOR.pkg}::corridor::open`,
	typeArguments: [SUI.usdc],
	arguments: [tx.pure.u64(feeBps), tx.pure.u64(minFee), tx.pure.address(evmToBytes32(relayerEvm))],
});
tx.transferObjects([cap], operator.toSuiAddress());
const r = await client.signAndExecuteTransaction({ transaction: tx, signer: operator, include: { effects: true, objectTypes: true } });
const t = r.Transaction ?? r.FailedTransaction!;
if (!t.status.success) throw new Error(JSON.stringify(t.status));
await client.core.waitForTransaction({ digest: t.digest });
const created = (t.effects?.changedObjects ?? []).filter((o) => o.idOperation === 'Created');
const type = (id: string) => t.objectTypes?.[id] ?? '';
const corridorId = created.find((o) => type(o.objectId).includes('::corridor::Corridor<'))!.objectId;
const adminCapId = created.find((o) => type(o.objectId).includes('::corridor::CorridorAdminCap<'))!.objectId;
const out = { ...CORRIDOR, corridorId, adminCapId, operator: operator.toSuiAddress(), relayerEvm, openDigest: t.digest, feeBps, minFee: minFee.toString() };
writeFileSync(new URL('../shared/deployment.json', import.meta.url), JSON.stringify(out, null, 2) + '\n');
console.log(out);
