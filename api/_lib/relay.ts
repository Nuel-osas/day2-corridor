// The relayer. Stateless on purpose: the chains and Circle's API are the only records, so the
// same call can be repeated after a crash, a closed tab or a redeploy, and it never pays twice.
import { bcs } from '@mysten/sui/bcs';
import { Transaction } from '@mysten/sui/transactions';
import { normalizeSuiAddress } from '@mysten/sui/utils';
import { parseAbi, parseAbiItem, type Hex } from 'viem';
import { BASE_SEPOLIA, CORRIDOR, IRIS, SUI } from '../../shared/config.js';
import { addIsNonceUsed, addReceive, corridorSender, evmToBytes32 } from '../../shared/corridor.js';
import { base, getOperator, getRelayer, sui } from './server.js';

export type Direction = 'out' | 'in';
// ready = Circle has attested and anyone could mint now, but the relayer has not (yet).
export type Stage = 'not_found' | 'attesting' | 'ready' | 'minted' | 'rejected';

export type Progress = {
	direction: Direction;
	sourceTx: string;
	stage: Stage;
	circleStatus?: string;
	nonce?: Hex;
	amount?: string; // gross burned, USDC units
	circleFee?: string; // feeExecuted by Circle on the destination
	mintRecipient?: string;
	destinationTx?: string | null;
	paidBy?: string;
	note?: string;
	corridor?: { gross: string; fee: string; net: string } | null;
};

type IrisMessage = {
	status: string;
	message: Hex;
	attestation: Hex;
	eventNonce: Hex;
	decodedMessage?: {
		sourceDomain: string;
		destinationDomain: string;
		destinationCaller: string;
		decodedMessageBody?: { mintRecipient: string; amount: string; messageSender: string; feeExecuted?: string };
	};
};

/** Circle's view of a burn. A 404 means Circle has not indexed it yet, which is still pending. */
export async function irisMessage(domain: number, txHash: string): Promise<IrisMessage | null> {
	const r = await fetch(`${IRIS}/v2/messages/${domain}?transactionHash=${txHash}`);
	if (r.status === 404) return null;
	if (!r.ok) throw new Error(`Circle attestation API ${r.status}`);
	const j = (await r.json()) as { messages?: IrisMessage[] };
	return j.messages?.[0] ?? null;
}

const mt = parseAbi([
	'function receiveMessage(bytes message, bytes attestation) returns (bool)',
	'function usedNonces(bytes32 nonce) view returns (uint256)',
]);
const messageReceived = parseAbiItem(
	'event MessageReceived(address indexed caller, uint32 sourceDomain, bytes32 indexed nonce, bytes32 sender, uint32 indexed finalityThresholdExecuted, bytes messageBody)',
);

const MIN_RELAYER_WEI = 20_000_000_000_000n; // 0.00002 ETH, a few receiveMessage calls on Base Sepolia

const eqAddr = (a?: string, b?: string) => !!a && !!b && normalizeSuiAddress(a.toLowerCase()) === normalizeSuiAddress(b.toLowerCase());

async function corridorEvent(digest: string) {
	const r = await sui.core.getTransaction({ digest, include: { events: true } });
	const t = r.Transaction ?? r.FailedTransaction;
	const ev = t?.events?.find((e) => e.eventType.startsWith(`${normalizeSuiAddress(CORRIDOR.pkg)}::corridor::TransferSentEvent`));
	if (!ev) return null;
	const j = ev.json as { gross: string; fee: string; net: string; corridor_id: string };
	return normalizeSuiAddress(j.corridor_id) === normalizeSuiAddress(CORRIDOR.corridorId) ? { gross: j.gross, fee: j.fee, net: j.net } : null;
}

/** Where a used nonce was minted on Base. Public RPCs cap log ranges, so search back in steps. */
async function findEvmMint(nonce: Hex) {
	const latest = await base.getBlockNumber();
	for (let i = 0n; i < 10n; i++) {
		const toBlock = latest - i * 9_000n, fromBlock = toBlock - 8_999n;
		const logs = await base.getLogs({ address: BASE_SEPOLIA.messageTransmitter, event: messageReceived, args: { nonce }, fromBlock, toBlock }).catch(() => []);
		if (logs.length) return logs[0].transactionHash;
	}
	return null;
}

/** Sui -> Base. Pays Base gas only for transfers that went through this corridor. */
export async function relayOut(digest: string): Promise<Progress> {
	const p: Progress = { direction: 'out', sourceTx: digest, stage: 'not_found' };
	p.corridor = await corridorEvent(digest).catch(() => null);
	const m = await irisMessage(SUI.domain, digest);
	if (!m) return { ...p, stage: 'attesting', circleStatus: 'not indexed yet' };
	const body = m.decodedMessage?.decodedMessageBody;
	Object.assign(p, { circleStatus: m.status, nonce: m.eventNonce, amount: body?.amount, mintRecipient: body?.mintRecipient, circleFee: body?.feeExecuted });
	if (m.status !== 'complete') return { ...p, stage: 'attesting' };

	const relayer = getRelayer();
	if (Number(m.decodedMessage?.destinationDomain) !== BASE_SEPOLIA.domain)
		return { ...p, stage: 'rejected', note: `destination domain ${m.decodedMessage?.destinationDomain} is not Base Sepolia` };
	if (!eqAddr(body?.messageSender, corridorSender()))
		return { ...p, stage: 'rejected', note: 'not sent through Corridor, so Corridor does not pay its gas' };
	if (!eqAddr(m.decodedMessage?.destinationCaller, evmToBytes32(relayer.account.address)))
		return { ...p, stage: 'rejected', note: 'destination caller is not this relayer' };

	const used = await base.readContract({ address: BASE_SEPOLIA.messageTransmitter, abi: mt, functionName: 'usedNonces', args: [m.eventNonce] });
	if (used !== 0n) return { ...p, stage: 'minted', destinationTx: await findEvmMint(m.eventNonce), paidBy: relayer.account.address, note: 'already minted' };

	// Simulate first: a message that would revert costs nothing to discover.
	const { request } = await base.simulateContract({
		account: relayer.account,
		address: BASE_SEPOLIA.messageTransmitter,
		abi: mt,
		functionName: 'receiveMessage',
		args: [m.message, m.attestation],
	});
	const balance = await base.getBalance({ address: relayer.account.address });
	if (balance < MIN_RELAYER_WEI)
		return { ...p, stage: 'ready', note: `relayer ${relayer.account.address} needs Base Sepolia ETH for gas; the transfer is attested and will mint once it is funded` };
	const hash = await relayer.wallet.writeContract(request);
	const receipt = await base.waitForTransactionReceipt({ hash });
	if (receipt.status !== 'success') throw new Error(`receiveMessage reverted in ${hash}`);
	return { ...p, stage: 'minted', destinationTx: hash, paidBy: relayer.account.address };
}

async function suiNonceUsed(nonce: Hex) {
	const tx = new Transaction();
	tx.setSender(getOperator().toSuiAddress());
	addIsNonceUsed(tx, nonce);
	const r = await sui.core.simulateTransaction({ transaction: tx, include: { commandResults: true }, checksEnabled: false });
	const bytes = r.commandResults?.[0]?.returnValues?.[0]?.bcs;
	if (!bytes) throw new Error('could not read is_nonce_used');
	return bcs.bool().parse(bytes);
}

/** Base -> Sui. The operator pays the Sui gas; the recipient needs no SUI. */
export async function relayIn(hash: string): Promise<Progress> {
	const p: Progress = { direction: 'in', sourceTx: hash, stage: 'not_found' };
	const m = await irisMessage(BASE_SEPOLIA.domain, hash);
	if (!m) return { ...p, stage: 'attesting', circleStatus: 'not indexed yet' };
	const body = m.decodedMessage?.decodedMessageBody;
	Object.assign(p, { circleStatus: m.status, nonce: m.eventNonce, amount: body?.amount, mintRecipient: body?.mintRecipient, circleFee: body?.feeExecuted });
	if (m.status !== 'complete') return { ...p, stage: 'attesting' };
	if (Number(m.decodedMessage?.destinationDomain) !== SUI.domain)
		return { ...p, stage: 'rejected', note: `destination domain ${m.decodedMessage?.destinationDomain} is not Sui` };
	const caller = m.decodedMessage?.destinationCaller;
	const operator = getOperator();
	if (caller && BigInt(caller) !== 0n && !eqAddr(caller, operator.toSuiAddress()))
		return { ...p, stage: 'rejected', note: 'destination caller is someone else' };

	if (await suiNonceUsed(m.eventNonce)) return { ...p, stage: 'minted', destinationTx: null, paidBy: operator.toSuiAddress(), note: 'already minted' };

	const tx = new Transaction();
	tx.setSender(operator.toSuiAddress());
	addReceive(tx, m.message, m.attestation);
	const r = await sui.signAndExecuteTransaction({ transaction: tx, signer: operator, include: { effects: true } });
	const t = r.Transaction ?? r.FailedTransaction!;
	if (!t.status.success) {
		if (await suiNonceUsed(m.eventNonce).catch(() => false)) return { ...p, stage: 'minted', destinationTx: null, note: 'minted by someone else first' };
		throw new Error(`Sui mint failed in ${t.digest}: ${JSON.stringify(t.status.error)}`);
	}
	await sui.core.waitForTransaction({ digest: t.digest }).catch(() => {});
	return { ...p, stage: 'minted', destinationTx: t.digest, paidBy: operator.toSuiAddress() };
}
