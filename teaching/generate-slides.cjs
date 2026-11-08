// Day 2 deck: Build Your Own Bridge (13 slides) and speaker notes. Run: pnpm slides
// Facts checked on 8 Nov 2026 against Circle's docs, GraphQL on Sui testnet, Base Sepolia RPC and
// Circle's Iris API. Digests on slide 10 come from our own runs (README "Verified so far").
const path = require('node:path');
const { createDeck, assets } = require('./deck-kit.cjs');

const LIVE = 'https://day2-corridor.vercel.app';
const REPO = 'https://github.com/Nuel-osas/day2-corridor';
const SUI_PKGS = 'https://developers.circle.com/cctp/references/sui-packages';
const EVM_ADDRS = 'https://developers.circle.com/cctp/references/contract-addresses';
const OUT = process.env.SLIDES_OUT || path.join(__dirname, 'Day2_Build_Your_Own_Bridge.pptx');
const NOTES = path.join(__dirname, 'day2-speaker-notes.md');

// Filled from real runs. Set MINTED_OUT / MINTED_IN to the destination tx once verified.
const RUN = {
	burn: 'DpUY4FYuUbgNHCAxW7oqVeKzdwC9ZNCwkEivVP2imCBF',
	burnApp: '2ZRMaMbdC7D5RPZaPEZgHNXkFAca4gVq7LrZjLRLoL9X',
	burnLive: 'DBywjeDodSV9FAMvddLzVFCPAQ9BKpGMvjSHvfDFWsGb',
	timed: 'C1qH9SEzWwDHPCHf7dVWKiTcNAXuyxGsrRe5HqYMbB5T',
	mintOut: process.env.MINTED_OUT || null,
	burnIn: process.env.BURN_IN || null,
	mintIn: process.env.MINTED_IN || null,
};

const d = createDeck({
	title: 'Build Your Own Bridge: Native USDC on Sui with CCTP V2, Bridge Fees and Gasless Transfers',
	subject: 'Keys, Dollars and Bitcoin, Day 2, SuiHub Lagos, November 2026',
	footerLeft: 'KEYS, DOLLARS AND BITCOIN · SUIHUB LAGOS',
	footerRight: 'DAY 2 · CORRIDOR',
	total: 13,
	glow: path.join(assets, 'cover-glow.png'),
});
const { C, M, CW, text, mono } = d;

// 01 Cover
d.cover({
	glyph: '⇄',
	name: 'corridor',
	subtitle: 'Build Your Own Bridge',
	blurb: 'Native USDC between Sui and Base on Circle CCTP V2. We build Corridor: a fee our Move contract enforces, and gas we pay for our users on both chains.',
	link: LIVE,
	label: '[ KEYS, DOLLARS AND BITCOIN · DAY 2 · SUIHUB LAGOS ]',
	note: {
		explain: 'Yesterday we changed who can sign for an account. Today we move dollars between chains, and we do it as a business: our own bridge, our own fee, and no gas for the user on either side. Everything runs on Sui testnet and Base Sepolia against Circle\'s real CCTP V2 contracts.',
		show: `Open ${LIVE} on the projector. Ask the room to clone ${REPO}, run pnpm install, and request testnet USDC on Sui from faucet.circle.com while you talk.`,
		ask: 'Which bridges have you used, and what did they charge you?',
		answer: 'Most people name a liquidity bridge or an exchange. They charged a fee, sometimes a spread, and the user paid gas on both sides. Today we build the same product without holding anyone\'s money.',
		next: 'What a bridge really is.',
		refs: `${LIVE} ; ${REPO}`,
	},
});

// 02 The one idea
d.statement({
	eyebrow: 'THE ONE IDEA',
	line1: 'A bridge is a burn, a proof and a mint.',
	line2: 'CCTP does all three.\nYou add the fee and the gas.',
	body: 'CCTP burns native USDC on one chain, Circle\'s attesters sign the message, and the other chain mints the same amount. No wrapped token, no pool, nothing for you to guard. Your product is everything around it: the fee, the relayer, the status screen. V1 contracts are paused on 1 December 2026, so this is V2.',
	note: {
		explain: 'Three kinds of bridge: lock and mint (a wrapped token backed by a vault someone must guard), liquidity pools (someone must fund both sides), and burn and mint, which only works when the issuer controls the token. Circle issues USDC, so CCTP can burn it here and mint it there. You never custody user funds, which removes the biggest risk a bridge has.',
		show: 'Draw three boxes on the board: Burn on chain A, Circle signs, Mint on chain B. Then circle the gaps around them: who pays gas on A, who submits the mint on B, who charges what. That is our product.',
		ask: 'If CCTP does the hard part, what is left for a bridge business?',
		answer: 'Fees, paying gas so the user does not need two tokens, relaying the mint, routing, and a status screen that tells the truth when a transfer is half done.',
		next: 'What V2 looks like on Sui today.',
		refs: SUI_PKGS,
	},
});

// 03 V2 on Sui, checked
{
	const s = d.slide({
		eyebrow: 'CHECKED ON 8 NOVEMBER',
		title: 'CCTP V2 on Sui: what is live',
		subtitle: 'From Circle\'s docs, then confirmed on chain: objects on Sui testnet, bytecode on Base Sepolia, live burns and mints.',
		note: {
			explain: 'Circle merged "CCTP V2 on Sui" into circlefin/sui-cctp on 5 October and lists the V2 package ids for testnet and mainnet. Sui is domain 8. As a source Sui sends standard transfers only, but Sui finalises in about a second, so Circle attested our standard burn 5 seconds after it executed. Into Sui, fast transfers work: live mints we read paid Circle 1 basis point.',
			show: 'Run the timing yourself: pnpm send 0.1 prints the burn, then the relayer shows Circle\'s status moving from pending_confirmations to complete within seconds.',
			ask: 'Why would Sui have no fast transfer, if fast is the premium product elsewhere?',
			answer: 'Fast transfers exist because Ethereum and its rollups take minutes to finalise; Circle takes the reorg risk for a fee. Sui is final in about a second, so a standard transfer from Sui is already fast, at no fee.',
			next: 'How the burn is built on Sui.',
			refs: `${SUI_PKGS} ; ${EVM_ADDRS} ; https://github.com/circlefin/sui-cctp (commit "CCTP V2 on Sui #32")`,
		},
	});
	d.table(s, [
		['', 'What we found', 'How we know'],
		['Sui domain', '8 (Base Sepolia 6, Ethereum Sepolia 0)', 'Circle docs, Iris messages'],
		['V2 on Sui testnet', 'Live: TMM 0x267d...3c64, MT 0xe967...bbe', 'GraphQL types, live burns'],
		['Sui as source', 'Standard only, attested in 5 s', 'Our timed burn C1qH...bB5T'],
		['Into Sui', 'Fast works, 1 bp fee', 'Live mint DHwH...yad'],
		['V1', 'Burn limits cut 31 Oct, paused 1 Dec 2026', 'Circle blog, 27 Aug'],
		['Fee endpoint', '/v2/burn/USDC/fees rejects domain 8', 'Iris, 8 Nov'],
	], { widths: [2.55, 5.0, 4.0], rowH: 0.5, size: 13.5 });
}

// 04 One PTB out of Sui
{
	const s = d.slide({
		tone: 'dark',
		eyebrow: 'THE BURN ON SUI',
		title: 'Out of Sui: one PTB, four calls',
		subtitle: 'V2 split the burn: CCTP checks, the USDC handler burns, CCTP sends. Into Sui is four calls too: receive_message, prepare_mint, mint, complete_mint.',
		note: {
			explain: 'In V1 you handed a coin to deposit_for_burn. In V2 TokenMessengerMinter never touches the coin. Phase one validates and returns a BurnReceipt hot potato plus the coin; the USDC handler burns the coin with its MintCap and returns a ticket; complete_burn sends the message. Hot potatoes force all of it into one transaction. Our corridor::send goes in front and takes the fee.',
			show: 'Open shared/corridor.ts, function addSend. Then open the burn digest on Suiscan and show the four MoveCall commands and the events: TransferSentEvent (ours), Burn, MessageSent, DepositForBurn.',
			ask: 'Why does Circle split the burn into tickets instead of one function?',
			answer: 'Upgrades. Integrators link only to the ticket constructors, which are not version gated, and the PTB calls the latest TokenMessengerMinter. Circle can upgrade without breaking every package that depends on it.',
			next: 'Our part: the fee.',
			refs: 'shared/corridor.ts ; move/vendor/circle/token_messenger_minter_v2/sources/deposit_for_burn.move ("Integrator Ticket Pattern")',
		},
	});
	d.steps(s, [
		{ title: 'Take the fee', body: 'corridor::send (ours). Measures the coin, puts the fee in the vault, returns Circle\'s burn ticket.' },
		{ title: 'Check', body: 'Circle\'s deposit_for_burn, package-auth variant. Domain, limits, fees. Returns BurnReceipt and the coin.' },
		{ title: 'Burn', body: 'handler::burn. The USDC handler burns the coin with its MintCap and returns a ticket.' },
		{ title: 'Send', body: 'complete_burn. Sends the CCTP message and emits DepositForBurn.' },
		{ title: 'Attest', body: 'Circle\'s Iris signs the message. Anyone can now mint on Base.' },
	], { y: 3.05, h: 3.65, bodySize: 14 });
}

// 05 The Move fee
{
	const s = d.slide({
		tone: 'dark',
		eyebrow: 'MOVE/CORRIDOR/SOURCES/CORRIDOR.MOVE',
		title: 'The fee, enforced by Move',
		subtitle: 'Abridged. The fee is measured from the coin, never from a number the client sends.',
		note: {
			explain: 'send takes the coin by value, so the fee comes out of what actually arrived. The rest goes into Circle\'s package-auth ticket with our witness, CorridorAuth. Only this module can construct CorridorAuth, so CCTP records keccak256 of its type name as the message sender. That hash, 0xccb6...606b, is how the relayer knows a transfer paid Corridor before it spends any gas.',
			show: 'Open corridor.move and the tests: pnpm move:test runs 10, including fee above the 5 percent ceiling, amount equal to the fee, zero recipient, paused corridor and a foreign admin cap.',
			ask: 'A user can call Circle directly and skip corridor::send. Is that a hole?',
			answer: 'No. They lose what the fee buys: our relayer only mints messages whose sender is Corridor, and only Corridor messages name our relayer as destination caller. CCTP itself stays open to everyone, which is the point of a public protocol.',
			next: 'The other way to charge: Circle\'s Bridge Kit.',
			refs: 'move/corridor/sources/corridor.move ; move/corridor/tests/corridor_tests.move',
		},
	});
	d.code(s, [
		'public fun send<T: drop>(',
		'    self: &mut Corridor<T>, mut coin: Coin<T>,',
		'    destination_domain: u32, mint_recipient: address,',
		'    circle_max_fee: u64, min_finality_threshold: u32, ctx: &mut TxContext,',
		'): DepositForBurnWithPackageAuthTicket<T, CorridorAuth> {',
		'    assert!(self.is_open(), EPaused);',
		'    let gross = coin.value();',
		'    let fee = self.fee_for(gross);             // max(bps, floor)',
		'    assert!(gross > fee, EAmountNotAboveFee);',
		'    self.vault.join(coin.split(fee, ctx).into_balance());',
		'    emit(TransferSentEvent<T> { gross, fee, net: coin.value(), .. });',
		'    deposit_for_burn::create_deposit_for_burn_with_package_auth_ticket(',
		'        coin, destination_domain, mint_recipient,',
		'        self.relayer,                          // destination caller',
		'        circle_max_fee as u256, min_finality_threshold, vector[],',
		'        CorridorAuth {},                       // CCTP sender = keccak256(type name)',
		'    )',
		'}',
	].join('\n'), { lang: 'MOVE', size: 10.5, y: 2.78, h: 4.05 });
}

// 06 Two ways to charge
{
	const s = d.slide({
		eyebrow: 'TWO WAYS TO CHARGE',
		title: 'Bridge Kit fee or your own Move fee',
		subtitle: 'Bridge Kit facts from Circle\'s docs on 6 November. Corridor facts from our contract and runs.',
		note: {
			explain: 'Circle\'s Bridge Kit (now part of App Kit) has setCustomFeePolicy with computeFee and resolveFeeRecipientAddress. The fee is taken on the source chain and Circle keeps 10 percent of it. On 6 November its docs listed EVM and Solana adapters and no Sui adapter, so for a Sui route you write the fee yourself, which is what Corridor does.',
			show: 'Show the vault growing: the corridor card in the app reads the Corridor object, and every send adds its fee.',
			ask: 'When would you still choose Bridge Kit?',
			answer: 'On EVM and Solana routes, when you want Circle\'s SDK to handle routing, approvals and retries, and you accept the 10 percent share. For Sui, or when the fee must be provable on chain, write the Move.',
			next: 'Who pays the gas.',
			refs: 'developers.circle.com Bridge Kit custom fees (checked 6 Nov 2026)',
		},
	});
	d.compare(s,
		{ title: 'Bridge Kit custom fee', bullets: ['A computeFee callback in setCustomFeePolicy', 'Taken on the source chain by the SDK', 'Circle keeps 10 percent of your fee', 'No Sui adapter in the docs on 6 Nov'] },
		{ title: 'Your Move fee (Corridor)', bullets: ['Measured from the coin in the burn PTB', 'All of it lands in your onchain vault', 'CCTP names your package as the sender', 'The relayer can prove each fee was paid'] },
		{ y: 2.6, h: 4.15 });
}

// 07 Who pays for what
{
	const s = d.slide({
		eyebrow: 'GASLESS FOR THE USER',
		title: 'Who pays for what',
		subtitle: 'The user holds USDC and nothing else. Measured on our transfers, 8 November.',
		note: {
			explain: 'Two gas bills, two payers. On Sui the operator sponsors the transaction: it is the gas owner and pays from its address balance, so the user signs with zero SUI. On Base the relayer submits receiveMessage and pays the ETH. The relayer is also the destination caller, so nobody else can mint our messages. Inbound is mirrored: the user burns on Base, the operator mints on Sui.',
			show: 'Point at the wallet card: 0.000 SUI and the green "no gas needed" tag. Then the burn on Suiscan: sender is the user, gas sponsor is 0xce4a...f80d.',
			ask: 'The sponsor signs every user transaction. What stops a user from spending the sponsor\'s money?',
			answer: 'The sponsor policy in api/_lib/server.ts: only Corridor\'s calls and coin helpers, exactly one corridor::send, gas only from the sponsor\'s address balance with a budget cap, and nothing the sponsor owns as an input. CCTP also screens the sponsor against its denylist.',
			next: 'The relayer, in code.',
			refs: 'api/_lib/server.ts checkSponsorable ; Suiscan DpUY4FYu...imCBF',
		},
	});
	d.table(s, [
		['Cost', 'Who pays', 'How'],
		['Sui gas for the burn', 'Corridor operator', 'Sponsored PTB, gas from its address balance'],
		['Corridor fee', 'User, in USDC', '0.3 percent, min 0.01, kept in the vault'],
		['Circle fee', 'Nobody (standard)', 'Fast into Sui: about 1 bp, out of the mint'],
		['Base gas for the mint', 'Relayer', 'receiveMessage; it is the destination caller'],
		['Sui gas for an inbound mint', 'Corridor operator', 'Four-call receive PTB'],
		['What the user needs', 'USDC only', 'Our test wallet: 0 SUI, 0 ETH'],
	], { widths: [3.35, 2.75, 5.45], rowH: 0.5, size: 13.5 });
}

// 08 The relayer
{
	const s = d.slide({
		tone: 'dark',
		eyebrow: 'API/_LIB/RELAY.TS',
		title: 'A relayer with no database',
		subtitle: 'Abridged. Every call reads Circle and the chain again, so it can be repeated forever and never pays twice.',
		note: {
			explain: 'The relayer keeps no state. It asks Iris for the message, refuses anything not sent by Corridor, asks Base whether the nonce is already used, simulates, checks its own balance, then sends. On Sui the same check is is_nonce_used, called through a simulation; the u256 is the nonce bytes read big endian, which we confirmed against Circle\'s own record.',
			show: 'Run pnpm relay out with an old digest: it answers "already minted" and finds the Base transaction from the MessageReceived log, without sending anything.',
			ask: 'Why not store each transfer in a database as it moves?',
			answer: 'Because then there are two truths. After a crash the database can say "not minted" while the chain says minted, and that is how bridges pay twice. The chain and Circle are the record; the relayer just reads them.',
			next: 'What the user sees while it waits.',
			refs: 'api/_lib/relay.ts ; message_transmitter_v2::state::is_nonce_used',
		},
	});
	d.code(s, [
		'export async function relayOut(digest: string) {',
		'  const m = await irisMessage(SUI.domain, digest);',
		'  if (!m) return { stage: \'attesting\' };          // 404 = not indexed yet',
		'  if (m.status !== \'complete\') return { stage: \'attesting\' };',
		'  if (!eqAddr(body.messageSender, corridorSender()))',
		'    return { stage: \'rejected\' };                 // not ours, we do not pay',
		'  if (await usedNonces(m.eventNonce) !== 0n)',
		'    return { stage: \'minted\', destinationTx: await findEvmMint(m.eventNonce) };',
		'  const { request } = await base.simulateContract({ functionName: \'receiveMessage\',',
		'    args: [m.message, m.attestation], account: relayer.account, .. });',
		'  if (await base.getBalance(relayer) < MIN_RELAYER_WEI)',
		'    return { stage: \'ready\' };                    // attested, relayer needs gas',
		'  const hash = await relayer.wallet.writeContract(request);',
		'  return { stage: \'minted\', destinationTx: hash };',
		'}',
	].join('\n'), { size: 10.5, y: 2.78, h: 4.05 });
}

// 09 Lifecycle
{
	const s = d.slide({
		eyebrow: 'A TRANSFER, START TO FINISH',
		title: 'Half done is a state, not an error',
		subtitle: 'What the app shows at each stage. Close the tab anywhere: paste the digest and it picks up.',
		note: {
			explain: 'Once the burn lands, the money is safe: it is either about to be minted or already minted. So the screen never says failed after a burn. A 404 from Iris means not indexed yet. Ready means anyone could mint now and our relayer is waiting, for example for gas. While we built Corridor the relayer had no ETH, and four attested transfers sat in Ready, safe, until it could pay: exactly the state this slide is about.',
			show: 'In the app, send 0.2 USDC, then reload the page mid-way. The transfer comes back from localStorage. Open a private window and paste the digest into Recover: same answer, because the relayer reads the chains.',
			ask: 'A user pays, then sees a red "failed" banner and pays again. What went wrong in that product?',
			answer: 'It treated an ambiguous state as a failure. The rule: an ambiguous status shows as pending, never failed, so nobody pays twice.',
			next: 'What we verified on testnet.',
		},
	});
	d.steps(s, [
		{ title: 'Burned', body: 'The Sui digest is the receipt. Fee in the vault, USDC burned.' },
		{ title: 'Attesting', body: 'Iris answers 404 or pending. Show pending, never failed.' },
		{ title: 'Ready', body: 'Attested. Anyone can mint; our relayer is about to, or needs gas.' },
		{ title: 'Minted', body: 'usedNonces is set. Repeat calls return the same mint.' },
		{ title: 'Recover', body: 'Any tab, any day: paste the digest, the relayer reads the chains.' },
	], { y: 3.0, h: 3.7, bodySize: 14.5 });
}

// 10 Verified
{
	const s = d.slide({
		eyebrow: 'VERIFIED ON TESTNET',
		title: 'Proof: our transfers',
		subtitle: 'Sui testnet and Base Sepolia, 8 November 2026. The user wallet held 0 SUI and 0 ETH throughout.',
		note: {
			explain: 'Every row is a real transaction you can open. The fee lands in the Corridor object\'s vault; Circle\'s attestation names Corridor\'s hash as the sender and our relayer as the destination caller.',
			show: 'Open two of these on the explorers: the Sui burn (sponsor, four calls, events) and the Base mint (called by the relayer).',
			ask: 'Which single field in Circle\'s attestation lets the relayer trust that a transfer paid Corridor?',
			answer: 'messageSender: keccak256 of the CorridorAuth type name, 0xccb6...606b. Only corridor::send can produce it.',
			next: 'Things that will bite you.',
			refs: `${REPO}#verified-so-far`,
		},
	});
	const mintRow = RUN.mintOut ? ['Relayer mints on Base', 'Base Sepolia', RUN.mintOut] : ['Relayer mints on Base', 'Base Sepolia', 'pending: relayer funding, rerun pnpm relay'];
	const inRow = RUN.mintIn ? ['Base to Sui, relayer pays SUI', 'Sui testnet', RUN.mintIn] : ['Base to Sui, relayer pays SUI', 'Sui testnet', 'pending: demo Base wallet funding'];
	d.table(s, [
		['Step', 'Chain', 'Transaction'],
		['Sponsored burn, 0.25 in, 0.01 fee', 'Sui testnet', RUN.burn],
		['Same, through the app (pnpm e2e)', 'Sui testnet', RUN.burnApp],
		['Same, on the live site', 'Sui testnet', RUN.burnLive],
		['Burn to attestation in 5 seconds', 'Sui testnet', RUN.timed],
		mintRow,
		inRow,
	], { widths: [3.9, 1.95, 5.7], rowH: 0.5, size: 13, monoCols: [2] });
}

// 11 Gotchas
{
	const s = d.slide({
		eyebrow: 'GOTCHAS',
		title: 'Six things that will bite you',
		subtitle: 'All of them came up while building and running Corridor.',
		note: {
			explain: 'Each one cost us time this week. The vendoring one is the first wall anyone hits when they try to compile against CCTP on Sui.',
			show: 'Open move/vendor/circle/NOTICE.md for the vendoring fix, and api/_lib/relay.ts for the balance check that replaced a confusing RPC error.',
			ask: 'Which of the six would cost real users money if you got it wrong?',
			answer: 'The sponsor policy and pending versus failed. A loose policy lets users spend the sponsor\'s funds; a wrong failed state makes users pay twice. The rest cost you time.',
			next: 'Build it.',
			refs: 'README.md "Gotchas we hit"',
		},
	});
	d.grid(s, [
		{ title: 'V2 is not V1', body: 'The coin goes to the USDC handler, not deposit_for_burn. V1 code and its five-call receive fail on V2.' },
		{ title: 'No Published.toml', body: 'Vendor Circle\'s sources, write the testnet addresses yourself, strip their inline tests.' },
		{ title: 'Sender is a hash', body: 'Package auth writes keccak256 of the witness type name, not your package id.' },
		{ title: 'Caller cuts both ways', body: 'Only your relayer can mint. Lose its key and those transfers can never be minted.' },
		{ title: 'Sponsor is a signer', body: 'Allow only your calls, one send, no sponsor-owned inputs, a gas cap.' },
		{ title: 'Empty relayer, odd error', body: 'Base RPC said "Missing or invalid parameters" at 0 ETH. Check the balance, report Ready.' },
	], { y: 2.8, h: 1.94 });
}

// 12 Build it
{
	const s = d.slide({
		tone: 'dark',
		eyebrow: 'BUILD IT',
		title: 'Run Corridor yourself',
		subtitle: 'Node 22+, pnpm, the Sui CLI for the Move part, testnet USDC from faucet.circle.com.',
		note: {
			explain: 'Two levels. Level one: use the class corridor from the app or the scripts with your own wallet. Level two: publish your own copy of the Move package, open your own corridor with your own fee and relayer, and point shared/deployment.json at it.',
			show: 'Live: pnpm send 0.2 from the terminal, then watch the same transfer appear in the app via Recover.',
			ask: 'You open your own corridor at 1 percent. What else must you change before your relayer will mint your transfers?',
			answer: 'The relayer must be your EVM key (the destination caller you passed to open), and corridorSender must be computed from your package id. The relayer rejects messages from any other sender.',
			next: 'What to take home.',
			refs: `${REPO} ; ${LIVE}`,
		},
	});
	d.code(s, [
		'git clone https://github.com/Nuel-osas/day2-corridor',
		'cd day2-corridor && pnpm install',
		'cp .env.example .env   # your testnet keys',
		'pnpm dev               # http://localhost:5293',
		'pnpm move:test         # 10 Move tests',
		'pnpm send 0.2          # Sui -> Base Sepolia',
		'pnpm inbound 0.5       # Base Sepolia -> Sui',
		'pnpm relay out <digest>',
		'',
		'# your own corridor',
		'cd move/corridor && sui client publish',
		'pnpm open-corridor 100 10000   # 1%, min 0.01',
	].join('\n'), { w: 6.95, lang: 'SHELL', size: 10.5 });
	const x = M + 7.25, w = CW - 7.25;
	[
		['Get USDC', 'faucet.circle.com, Sui testnet'],
		['Quote', 'Fee and net, as the Move computes it'],
		['Bridge', 'Sign with 0 SUI; Corridor pays'],
		['Watch', 'Burned, attested, minted'],
		['Recover', 'Reload or paste the digest'],
	].forEach(([t, b], i) => {
		const y = 2.88 + i * 0.79;
		mono(s, String(i + 1).padStart(2, '0'), x, y + 0.04, 0.5, 0.25, 12, C.peri);
		text(s, t, x + 0.55, y, w - 0.55, 0.34, 18, C.near);
		text(s, b, x + 0.55, y + 0.36, w - 0.55, 0.3, 13.5, C.dim);
	});
}

// 13 Take home
d.statement({
	eyebrow: 'TAKE HOME',
	line1: 'Circle moves the dollars. You run the corridor.',
	line2: 'A fee Move enforces.\nGas the user never sees.',
	body: 'CCTP V2 is live on Sui and a Sui burn is attested in seconds. Put your fee in the same PTB as the burn, let CCTP name your package as the sender, pay both gas bills, and keep the relayer stateless so a half-done transfer is always safe to finish.',
	note: {
		explain: 'Three things to remember: the V2 burn on Sui is a four-call PTB you can wrap; your package can be the provable sender; and a bridge is judged on its half-done states, so read the chains instead of keeping your own copy.',
		show: 'Leave the corridor card on screen with the fees collected during class.',
		ask: 'What would you add before taking Corridor to mainnet?',
		answer: 'Audits, a relayer queue with one job per nonce, monitoring of relayer and sponsor balances, rate limits on the sponsor, a fee withdrawal policy, and mainnet ids checked the same way we checked testnet.',
		next: 'Day 3: Hashi. Bitcoin on Sui, and what it takes to build a Bitcoin bridge.',
	},
});

const header = `# Day 2 Speaker Notes: Build Your Own Bridge

Keys, Dollars and Bitcoin, Day 2, SuiHub Lagos. Deck: teaching/Day2_Build_Your_Own_Bridge.pptx (13 slides, rebuilt with \`pnpm slides\`). App: ${LIVE}. Repo: ${REPO}.

## Before class

- Fund the relayer with Base Sepolia ETH (0xd1f2CBd5797545FA97410056304CDF1b35865cAe) and check the corridor card shows "Relayer gas left" above zero. Then \`pnpm relay out <digest>\` for any transfer still in Ready.
- Fund the demo Base wallet (0x0E0cacEa53366bF31Bf6938F51ea8E96d1EBBDC4) with Base Sepolia USDC and a little ETH, and run \`pnpm inbound 0.5\` once.
- Run \`APP_URL=${LIVE} pnpm e2e\` (it requires the mint by default).
- Check the operator still has testnet SUI (corridor card or /api/config) and the demo Sui wallet has USDC.
- Students need Node 22+, pnpm, a browser, and testnet USDC on Sui from faucet.circle.com. MetaMask with Base Sepolia only for the inbound part.

## Run of show (about two hours)

| Slides | Minutes | What happens |
|---|---|---|
| 1 to 3 | 15 | The one idea, what is live on Sui |
| 4 to 6 | 25 | The four-call burn, the Move fee, Bridge Kit compared |
| 7 to 9 | 25 | Who pays, the relayer, the half-done states (reload and recover live) |
| 10 to 11 | 10 | Proof on the explorers, the gotchas |
| 12 | 40 | Everyone bridges with 0 SUI; volunteers open their own corridor |
| 13 | 5 | Take home, Day 3 preview |

`;

d.save(OUT, NOTES, header).then((r) => console.log(`wrote ${r.out} (${r.slides} slides) and ${r.notesOut}`));
