// Day 2 deck: Build Your Own Bridge (13 slides) and speaker notes. Run: pnpm slides
// The class builds a multi-chain USDC bridge app in the shape of bridge.setsuna.finance: the user's
// own wallets, any CCTP V2 chain including Sui, Bridge Kit for EVM routes, our own PTBs for Sui, a
// choice of who pays the gas, and transfers that survive a closed tab.
// Facts checked 8 to 10 Nov 2026 against Circle's docs, Iris (sandbox and mainnet), Sui GraphQL and
// Base Sepolia. Transaction ids on slide 12 come from our own runs (README "Verified so far").
const path = require('node:path');
const { createDeck, assets } = require('./deck-kit.cjs');

const LIVE = 'https://day2-corridor.vercel.app';
const REPO = 'https://github.com/Nuel-osas/day2-corridor';
const PRODUCT = 'https://bridge.setsuna.finance';
const SUI_PKGS = 'https://developers.circle.com/cctp/references/sui-packages';
const EVM_ADDRS = 'https://developers.circle.com/cctp/references/contract-addresses';
const OUT = process.env.SLIDES_OUT || path.join(__dirname, 'Day2_Build_Your_Own_Bridge.pptx');
const NOTES = path.join(__dirname, 'day2-speaker-notes.md');

// Real runs. Rows whose env var is unset print as pending, never as done.
const RUN = {
	corridorBurn: 'DpUY4FYuUbgNHCAxW7oqVeKzdwC9ZNCwkEivVP2imCBF',
	corridorMint: '0x0a95d8a9f259278d09f59e0b070533c0c5faddecb016e19b41ce641d8e4b7a6b',
	inboundMint: 'sydqu42S2TK71VcQpBFDq8QyxpoZeZUMd7CtsW8S9XK',
	mainnetBurn: 'CtgJhudiEsBs5FtBwkYaGkQYhMtwgkpQwLBCfUcchvnb',
	mainnetMint: 'Gy3393NZCGnzxt88vPUjK6bjmSpWkqVjujjXvkwYoHq8',
	// Live site, 10 Nov 2026, scripts/e2e-bridge.ts: test wallets injected over EIP-6963 and Wallet Standard.
	kitBurn: '0x1cd7eea61631906eb4931e1aba75a3d1a8ae6cdfaea2264fca19d83b3c5d3d52', // 0.15 burned, 0.009 to us, 0.001 to Circle
	forward: '0x306a45f03eb6058f4f190f42866af6f3585fbb708756b4a70ae4e74cdcc1fcea', // Circle's forwarder mints on Arbitrum
	suiOut: '0xcc7a695a1b479b64fc6c095eb7204920425d8e7aa8fe3c2a266788cb2979d5ba', // user claims on Base (burn DRXw9ymq...zjakR)
	suiIn: 'CnYYh73wTjCZUyWnMFQFYVMRad3apzCwFGEaMM1DnrKy', // user claims on Sui (burn 0xee8d65be...caa62)
	corridorOutLive: '0xccbe62a560ef923700746a99d3a621b7f09cd4a5ecf54bdfcb63cbf2b5d29ddc', // relayer mints, 0.14 after 0.01 fee
	corridorInLive: '4Mrr1e2GmZ6YrgmR5gmtvAWmSsByv2v8Umr5hHqfZCU2', // operator mints on Sui
};
const short = (h) => (h && h.length > 50 ? `${h.slice(0, 18)}...${h.slice(-12)}` : h);

const d = createDeck({
	title: 'Build Your Own Bridge: A Multi-Chain USDC Bridge on Sui with CCTP V2',
	subject: 'Keys, Dollars and Bitcoin, Day 2, SuiHub Lagos, November 2026',
	footerLeft: 'KEYS, DOLLARS AND BITCOIN · SUIHUB LAGOS',
	footerRight: 'DAY 2 · BUILD YOUR OWN BRIDGE',
	total: 13,
	glow: path.join(assets, 'cover-glow.png'),
});

// 01 Cover
d.cover({
	glyph: '⇄',
	name: 'corridor',
	subtitle: 'Build Your Own Bridge',
	blurb: 'A USDC bridge app on Circle CCTP V2, built the way bridge.setsuna.finance is: your users\' own wallets, any CCTP chain with Sui included, your fee, and a choice of who pays the gas.',
	link: LIVE,
	label: '[ KEYS, DOLLARS AND BITCOIN · DAY 2 · SUIHUB LAGOS ]',
	note: {
		explain: `Today we build a bridge app, the product a user actually opens. ${PRODUCT} is the finished version of what we build: 28 chains, one wallet per ecosystem, fast or standard, pay gas in USDC, and a history that follows the wallet. Our class app, Corridor, is the same design cut to teaching size, on testnets, with Sui at the centre.`,
		show: `Open ${PRODUCT} on the projector, switch it to testnet and walk through one transfer screen. Then open ${LIVE}: same shape, the code we read today. Ask the room to clone ${REPO} and run pnpm install while you talk.`,
		ask: 'Which bridges have you used, and what did they charge you?',
		answer: 'Most people name a liquidity bridge or an exchange. They charged a fee or a spread, and the user paid gas on both sides. Today we build the same product without holding anyone\'s money.',
		next: 'What a bridge really is.',
		refs: `${PRODUCT} ; ${LIVE} ; ${REPO}`,
	},
});

// 02 The one idea
d.statement({
	eyebrow: 'THE ONE IDEA',
	line1: 'A bridge is a burn, a proof and a mint.',
	line2: 'CCTP does all three.\nYou build the product around it.',
	body: 'CCTP burns native USDC on one chain, Circle\'s attesters sign the message, and the other chain mints the same amount. No wrapped token, no pool, nothing for you to guard. Your product is everything around it: wallets, routes, fees, gas and a status screen that tells the truth. V1 contracts are paused on 1 December 2026, so this is V2.',
	note: {
		explain: 'Three kinds of bridge: lock and mint (a wrapped token backed by a vault someone must guard), liquidity pools (someone must fund both sides), and burn and mint, which only works when the issuer controls the token. Circle issues USDC, so CCTP can burn it here and mint it there. You never hold user funds, which removes the biggest risk a bridge has.',
		show: 'Draw three boxes: Burn on chain A, Circle signs, Mint on chain B. Then circle what is missing for a user: connecting wallets, picking chains, paying gas on B, knowing where the money is. That is our app.',
		ask: 'If CCTP does the hard part, what is left for a bridge app?',
		answer: 'Wallets on every chain, routing, quotes, fees, gas on the destination, and a tracker that survives a closed tab.',
		next: 'The product we are building.',
		refs: SUI_PKGS,
	},
});

// 03 The product
{
	const s = d.slide({
		eyebrow: 'THE PRODUCT',
		title: 'What a bridge app does',
		subtitle: `The six parts of ${PRODUCT.replace('https://', '')}. Our app has the same six.`,
		note: {
			explain: 'This is the spec for today. Every part maps to a file in the repo: wallets.tsx, chains.ts, the quote in Bridge.tsx, the speed switch, the gas choice, and transfer.ts for the tracker.',
			show: `On ${PRODUCT} point at each part in turn: the wallet drawer with one wallet per ecosystem, the chain pickers, the quote, Fast and Standard, "Pay gas in USDC", and History with search by hash.`,
			ask: 'Which of the six is the hardest to get right?',
			answer: 'The tracker. Everything else is a form. The tracker must be right when the user closes the tab after the burn and comes back a day later on a different device.',
			next: 'What CCTP V2 offers on Sui today.',
			refs: PRODUCT,
		},
	});
	d.grid(s, [
		{ title: 'Connect', body: 'One wallet per ecosystem, side by side: MetaMask for EVM chains, Slush for Sui.' },
		{ title: 'Route', body: 'Any two CCTP chains. Each has a domain, a USDC address and two contracts.' },
		{ title: 'Quote', body: 'Amount, fees and what arrives, shown before anything is signed.' },
		{ title: 'Speed', body: 'Fast costs a small fee. Standard is free. Sui is standard only, and fast anyway.' },
		{ title: 'Gas', body: 'The user claims on the destination, Circle delivers for USDC, or you pay.' },
		{ title: 'Track', body: 'Approve, burn, attest, mint. Saved at every step, found again by hash.' },
	], { y: 2.6, h: 1.95 });
}

// 04 What is live
{
	const s = d.slide({
		eyebrow: 'CHECKED 8 TO 10 NOVEMBER',
		title: 'CCTP V2 on Sui: what is live',
		subtitle: 'From Circle\'s docs, then confirmed on chain: Sui testnet, Sui mainnet and Base Sepolia.',
		note: {
			explain: 'Circle merged "CCTP V2 on Sui" into circlefin/sui-cctp on 5 October and lists V2 package ids for testnet and mainnet. Sui is domain 8. As a source Sui sends standard transfers only, but Sui finalises in about a second, so Circle attested our standard burn 5 seconds after it executed. Into Sui, fast transfers work. On 10 November we read Circle\'s mainnet state objects and real mainnet transactions with the same calls we write today: a burn on 5 November (CtgJhudiEsBs5FtBwkYaGkQYhMtwgkpQwLBCfUcchvnb) and a mint on 7 November (Gy3393NZCGnzxt88vPUjK6bjmSpWkqVjujjXvkwYoHq8). The app runs on testnet because the class uses test money; mainnet is the same code with mainnet ids.',
			show: 'Open Circle\'s Sui packages page next to Suiscan: the package ids match the objects on chain.',
			ask: 'Why would Sui have no fast transfer, if fast is the premium product elsewhere?',
			answer: 'Fast transfers exist because Ethereum and its rollups take minutes to finalise; Circle takes the reorg risk for a fee. Sui is final in about a second, so a standard transfer from Sui is already fast, at no fee.',
			next: 'One transfer, step by step.',
			refs: `${SUI_PKGS} ; ${EVM_ADDRS} ; https://github.com/circlefin/sui-cctp (commit "CCTP V2 on Sui #32")`,
		},
	});
	d.table(s, [
		['', 'What we found', 'How we know'],
		['Domains', 'Ethereum 0, Arbitrum 3, Solana 5, Base 6, Sui 8', 'Circle docs, Iris messages'],
		['V2 on Sui testnet', 'Live: TMM 0x267d...3c64, MT 0xe967...bbe', 'GraphQL types, our burns'],
		['V2 on Sui mainnet', 'Live: TMM 0xeb14...b830, MT 0x16bc...db87', 'Burn CtgJ...bvnb, mint Gy33...Hoq8'],
		['Sui as source', 'Standard only, attested in 5 s', 'Our timed burn C1qH...bB5T'],
		['Into Sui', 'Fast works, 1 bp fee', 'Live mint DHwH...yad'],
		['V1', 'Burn limits cut 31 Oct, paused 1 Dec 2026', 'Circle blog, 27 Aug'],
		['Fee API', 'No quotes for any route touching Sui', 'Iris sandbox, 10 Nov'],
	], { widths: [2.55, 5.0, 4.0], rowH: 0.47, size: 13.5 });
}

// 05 One transfer, four steps
{
	const s = d.slide({
		eyebrow: 'ONE TRANSFER',
		title: 'Four steps on every route',
		subtitle: 'Approve, burn, attest, mint. Only the code for each step changes from chain to chain.',
		note: {
			explain: 'This is the whole engine. On an EVM chain the user approves USDC for TokenMessengerV2, then calls depositForBurn. On Sui there is no approval: the coin goes straight into the burn PTB. Either way the burn names a destination domain and a 32-byte recipient. Then you poll Circle\'s Iris API with the source domain and the burn hash until the message is attested. Then someone calls receiveMessage on EVM, or the four-call receive PTB on Sui, and pays that chain\'s gas.',
			show: 'Open src/lib/transfer.ts, function runTransfer: one function walks the four steps and saves the record after each one.',
			ask: 'Why does the attestation step need no wallet at all?',
			answer: 'It is a read: Iris is a public API. The burn hash plus the source domain is enough to fetch the signed message, from any device, by anyone.',
			next: 'Step zero: the wallets.',
			refs: 'src/lib/transfer.ts ; https://developers.circle.com/cctp',
		},
	});
	d.steps(s, [
		{ title: 'Approve', body: 'EVM only: let the token messenger spend the USDC. Sui needs none: the coin goes into the PTB.' },
		{ title: 'Burn', body: 'depositForBurn on EVM, a three-call PTB on Sui. Names the destination domain and recipient.' },
		{ title: 'Attest', body: 'Ask Circle\'s Iris API with the source domain and burn hash until it is signed. A 404 means not indexed yet.' },
		{ title: 'Mint', body: 'receiveMessage on EVM, a four-call PTB on Sui. Whoever submits it pays the gas.' },
		{ title: 'Save', body: 'Write the record after every step, so a closed tab never loses a transfer.' },
	], { y: 3.0, h: 3.7, bodySize: 14 });
}

// 06 Wallets
{
	const s = d.slide({
		tone: 'dark',
		eyebrow: 'SRC/LIB/WALLETS.TSX',
		title: 'One wallet per ecosystem',
		subtitle: 'Abridged. EVM wallets announce themselves (EIP-6963). Sui wallets register with Wallet Standard.',
		note: {
			explain: 'A bridge needs a wallet on each side, and they are different wallets. EIP-6963 lets every EVM wallet announce itself, so MetaMask and Rabby can coexist instead of fighting over window.ethereum. Sui wallets such as Slush register with Wallet Standard; we keep the ones whose chains start with "sui:". We store one connected wallet per ecosystem, so a Base to Sui transfer has MetaMask on one side and Slush on the other.',
			show: 'Open the wallet drawer in the app: two sections, EVM and Sui, each with the wallets this browser has installed.',
			ask: 'Why not use one EVM wallet for everything?',
			answer: 'Sui does not use EVM keys or EVM transactions. The Sui side needs a Sui wallet to sign a PTB. Even the recipient address is a different shape: 32 bytes on Sui, 20 on EVM.',
			next: 'EVM routes in a few lines, with Circle\'s Bridge Kit.',
			refs: 'https://eips.ethereum.org/EIPS/eip-6963 ; https://docs.sui.io/standards/wallet-standard',
		},
	});
	d.code(s, [
		'// EVM: every wallet announces itself (EIP-6963)',
		'window.addEventListener(\'eip6963:announceProvider\', (e) => {',
		'  const { info, provider } = (e as CustomEvent).detail;',
		'  evm.set(info.rdns, { name: info.name, icon: info.icon, provider });',
		'});',
		'window.dispatchEvent(new Event(\'eip6963:requestProvider\'));',
		'',
		'// Sui: wallets register with Wallet Standard (Slush, Suiet, ...)',
		'const sui = getWallets().get()',
		'  .filter((w) => w.chains.some((c) => c.startsWith(\'sui:\')));',
		'',
		'// Connect, one per ecosystem',
		'const [address] = await provider.request({ method: \'eth_requestAccounts\' });',
		'const { accounts } = await slush.features[\'standard:connect\'].connect();',
		'connected = { evm: { address, provider }, sui: { address: accounts[0].address, wallet: slush } };',
	].join('\n'), { size: 10.5, y: 2.78, h: 4.05 });
}

// 07 Bridge Kit
{
	const s = d.slide({
		tone: 'dark',
		eyebrow: 'SRC/LIB/KIT.TS',
		title: 'EVM to EVM with Bridge Kit',
		subtitle: 'Circle\'s SDK runs approve, burn, attestation and mint for you, with events for the tracker.',
		note: {
			explain: 'For EVM and Solana routes, Circle\'s Bridge Kit does the four steps in one call. You give it an adapter made from the user\'s wallet, the two chain names and an amount. It emits an event per step, which we turn into the tracker, and returns a result you can hand back to kit.retry after a failure. Two settings matter for a product: transferSpeed (FAST or SLOW) and useForwarder, which asks Circle to mint on the destination and take its fee from the USDC, so the user needs no gas there.',
			show: 'Bridge 1 USDC from Base Sepolia to Arbitrum Sepolia in the app and watch the four events arrive.',
			ask: 'Bridge Kit does all of this. Why do we still write our own code for Sui?',
			answer: 'Bridge Kit has adapters for EVM and Solana and only knows Sui\'s V1 contracts. Any route that touches Sui is ours to build: the burn and mint PTBs on the next slide.',
			next: 'The Sui side, in our own PTBs.',
			refs: 'https://developers.circle.com/bridge-kit ; @circle-fin/bridge-kit, @circle-fin/adapter-viem-v2',
		},
	});
	d.code(s, [
		'import { BridgeKit } from \'@circle-fin/bridge-kit\';',
		'import { createViemAdapterFromProvider } from \'@circle-fin/adapter-viem-v2\';',
		'',
		'const kit = new BridgeKit();',
		'const adapter = await createViemAdapterFromProvider({ provider: metamask });',
		'kit.on(\'*\', (e) => track(e.method, e.values?.txHash)); // approve, burn, fetchAttestation, mint',
		'',
		'const result = await kit.bridge({',
		'  from: { adapter, chain: \'Base_Sepolia\' },',
		'  to: gasInUsdc',
		'    ? { chain: \'Arbitrum_Sepolia\', recipientAddress, useForwarder: true } // Circle mints',
		'    : { adapter, chain: \'Arbitrum_Sepolia\' },                          // the user claims',
		'  amount: \'1.00\',',
		'  config: { transferSpeed: \'FAST\' },',
		'});',
		'if (result.state !== \'success\') await kit.retry(result, { from: adapter, to: adapter });',
	].join('\n'), { size: 10.5, y: 2.78, h: 4.05 });
}

// 08 Sui PTBs
{
	const s = d.slide({
		tone: 'dark',
		eyebrow: 'SRC/LIB/SUI.TS',
		title: 'Sui routes: your own PTBs',
		subtitle: 'Abridged. Out of Sui is three calls the user\'s Sui wallet signs. Into Sui is four.',
		note: {
			explain: 'In V2 TokenMessengerMinter never touches the coin. deposit_for_burn validates and returns a BurnReceipt plus the coin; the USDC handler burns the coin with its MintCap and returns a ticket; complete_burn sends the message. Hot potatoes force all three into one PTB, which the user\'s Sui wallet signs. Into Sui is receive_message, prepare_mint, handler::mint, complete_mint. With a zero destination caller, anyone can submit the mint, so the user can claim with their own wallet.',
			show: 'Bridge from Sui testnet to Base Sepolia with Slush. Open the burn on Suiscan: three MoveCall commands and the DepositForBurn event.',
			ask: 'Why does Circle split the burn into tickets instead of one function?',
			answer: 'Upgrades. Integrators link to stable entry points while the PTB calls the latest TokenMessengerMinter, so Circle can upgrade without breaking every package that depends on it.',
			next: 'Who pays the gas on the other side.',
			refs: `src/lib/sui.ts ; ${SUI_PKGS}`,
		},
	});
	d.code(s, [
		'// Sui -> anywhere. Finality 2000: Sui is standard only, and final in a second.',
		'const coin = tx.add(coinWithBalance({ type: USDC, balance: amount }));',
		'const [receipt, rest] = tx.moveCall({ target: `${TMM}::deposit_for_burn::deposit_for_burn`,',
		'  typeArguments: [USDC], arguments: [coin, tx.pure.u32(destDomain), tx.pure.address(recipient32),',
		'    tx.pure.address(\'0x0\'), tx.pure.u256(maxFee), tx.pure.u32(2000), tx.pure.vector(\'u8\', []),',
		'    tx.object(TMM_STATE)] });',
		'const [ticket] = tx.moveCall({ target: `${HANDLER}::handler::burn`,',
		'  arguments: [tx.object(HANDLER_STATE), receipt, rest, tx.object(\'0x403\'), tx.object(TREASURY)] });',
		'tx.moveCall({ target: `${TMM}::deposit_for_burn::complete_burn`,',
		'  typeArguments: [USDC, `${HANDLER}::handler::Auth`], arguments: [ticket, tmmState, mtState] });',
		'await tx.prepareForSerialization({ client });          // resolve the coins, then the wallet signs',
		'',
		'// anywhere -> Sui, after Iris attests:',
		'// receive_message -> prepare_mint<USDC> -> handler::mint -> complete_mint<USDC, Auth>',
	].join('\n'), { size: 10.5, y: 2.78, h: 4.05 });
}

// 09 Who pays the gas
{
	const s = d.slide({
		eyebrow: 'THE GAS',
		title: 'Who pays on the other side',
		subtitle: 'The mint costs gas on the destination. Three ways to pay it; the app offers what each route supports.',
		note: {
			explain: 'Claim it yourself: the user signs receiveMessage with their destination wallet and needs that chain\'s gas token. Pay gas in USDC: Circle\'s Forwarding Service submits the mint and takes a fee from the USDC; on 10 November the sandbox quoted about 0.053 USDC for Ethereum Sepolia to Base Sepolia and 0.086 for Base Sepolia to Arbitrum Sepolia, and returned an error for every route that touches Sui. So for Sui routes you run your own relayer, which is what Corridor does: the operator sponsors the Sui burn, so the user signs with 0 SUI, and our relayer pays for the mint.',
			show: 'In the app, pick Base Sepolia to Arbitrum Sepolia and turn on "Pay gas in USDC": the quote shows Circle\'s fee. Pick Sui to Base: the option changes to "Corridor pays", with Corridor\'s fee.',
			ask: 'The relayer pays gas for strangers. What stops someone draining it?',
			answer: 'It only mints messages whose sender is Corridor\'s package and whose destination caller is the relayer. Those messages only exist if the user paid Corridor\'s fee in the same PTB as the burn.',
			next: 'How you charge for all this.',
			refs: 'https://developers.circle.com/cctp (Forwarding Service) ; api/_lib/relay.ts',
		},
	});
	d.table(s, [
		['', 'Who submits the mint', 'User needs there', 'Works on'],
		['Claim it yourself', 'The user\'s wallet', 'Gas (ETH, SUI)', 'Every route'],
		['Pay gas in USDC', 'Circle Forwarding Service', 'Nothing', 'EVM routes only'],
		['Corridor pays', 'Our relayer, the destination caller', 'Nothing, 0 SUI to send', 'Sui routes, for our fee'],
	], { widths: [2.6, 3.3, 2.65, 3.0], rowH: 0.62, size: 14 });
	d.bar(s, 'Circle\'s fee API answered "Invalid source/destination domain id" for every Sui route on 10 Nov. For Sui, you run the relayer.', 5.75);
}

// 10 Your fee
{
	const s = d.slide({
		eyebrow: 'THE BUSINESS',
		title: 'Your fee: Bridge Kit or Move',
		subtitle: 'Bridge Kit facts from Circle\'s docs on 6 November. Corridor facts from our contract and runs.',
		note: {
			explain: 'On EVM routes, Bridge Kit\'s setCustomFeePolicy takes your fee on the source chain, and Circle keeps 10 percent of it. On Sui routes Bridge Kit cannot help, so corridor::send, our Move function, takes the fee from the coin and hands the rest to CCTP\'s burn in the same PTB. CCTP then records keccak256 of our witness type as the message sender, so the relayer can prove the fee was paid before it spends any gas.',
			show: 'Open move/corridor/sources/corridor.move, function send. Then the Corridor object on Suiscan: the vault balance grows with every Sui transfer.',
			ask: 'A user can call Circle directly and skip corridor::send. Is that a hole?',
			answer: 'No. They lose what the fee buys: the sponsored gas and our relayer. CCTP stays open to everyone, which is the point of a public protocol.',
			next: 'The part users judge you on: half-done transfers.',
			refs: 'move/corridor/sources/corridor.move ; developers.circle.com Bridge Kit custom fees',
		},
	});
	d.compare(s,
		{ title: 'Bridge Kit fee (EVM routes)', bullets: ['setCustomFeePolicy with a computeFee callback', 'Taken on the source chain by the SDK', 'Circle keeps 10 percent of your fee', 'No Sui adapter'] },
		{ title: 'Move fee (Sui routes)', bullets: ['corridor::send, in the same PTB as the burn', 'Measured from the coin, kept in an onchain vault', 'CCTP names your package as the sender', 'Pays for the sponsored gas and the relayer'] },
		{ y: 2.6, h: 4.15 });
}

// 11 Half done is a state
{
	const s = d.slide({
		eyebrow: 'A TRANSFER, START TO FINISH',
		title: 'Half done is a state, not an error',
		subtitle: 'What the tracker shows at each stage. Close the tab anywhere: the burn hash brings it back.',
		note: {
			explain: 'Once the burn lands, the money is safe: it is attested, about to be minted, or minted. So the screen never says failed after a burn. Save the burn hash the moment the wallet returns it, before waiting for the receipt, so a retry settles that burn instead of sending a second one. Before paying for a mint, ask the destination whether the nonce is used (usedNonces on EVM, is_nonce_used on Sui). While we built Corridor the relayer had no ETH and four attested transfers sat in Ready for two days, safe, until it could pay.',
			show: 'Send from Base Sepolia, then reload the page during attestation: the transfer comes back from localStorage. Open a private window, paste the burn hash into Find: same transfer, rebuilt from Iris.',
			ask: 'A user pays, sees a red "failed" banner, and pays again. What went wrong in that product?',
			answer: 'It treated an ambiguous state as a failure. The rule: an ambiguous status shows as pending, never failed, so nobody pays twice.',
			next: 'What we verified.',
			refs: 'src/lib/transfer.ts ; src/lib/iris.ts',
		},
	});
	d.steps(s, [
		{ title: 'Burn sent', body: 'Save the hash before waiting. A retry settles it first: never two burns.' },
		{ title: 'Attesting', body: 'Iris answers 404 or pending. Show pending, never failed.' },
		{ title: 'Ready', body: 'Attested, not minted. Claim now, or wait for Circle or the relayer.' },
		{ title: 'Minted', body: 'The nonce is used on the destination. Check before you pay gas.' },
		{ title: 'Find it', body: 'Source domain and burn hash: Iris returns the message on any device.' },
	], { y: 3.0, h: 3.7, bodySize: 14.5 });
}

// 12 Proof
{
	const s = d.slide({
		eyebrow: 'VERIFIED',
		title: 'Proof: real transfers',
		subtitle: 'Every route through the live app on 10 November 2026, plus someone else\'s transfer on Sui mainnet.',
		note: {
			explain: `Every row is a real transaction you can open, made through ${LIVE} by scripts/e2e-bridge.ts: an EVM test wallet announced over EIP-6963 and a Sui test wallet registered with Wallet Standard, the same way MetaMask and Slush connect. The Bridge Kit burn ${RUN.kitBurn} shows the fee split on chain: 0.15 USDC burned, 0.009 to our fee address, 0.001 to Circle. Circle\'s forwarder sent the Arbitrum mint itself. Each route took 10 to 17 seconds end to end.`,
			show: `Open two on the explorers: the Bridge Kit burn on sepolia.basescan.org (three USDC transfers: Circle, us, the burn) and the user's own Sui mint on Suiscan. Full hashes are in README "Verified so far".`,
			ask: 'Which field in Circle\'s message tells the destination who may submit the mint?',
			answer: 'destinationCaller. Zero means anyone, so the user can claim. Corridor sets it to our relayer, so nobody can front-run the mint it is paying for.',
			next: 'What will bite you, and what to take home.',
			refs: `${REPO}#verified-so-far`,
		},
	});
	const row = (label, chain, tx) => [label, chain, tx ? short(tx) : 'pending'];
	d.table(s, [
		['Route', 'Chain', 'Transaction'],
		row('Bridge Kit burn with our fee', 'Base Sepolia', RUN.kitBurn),
		row('Base to Arbitrum, Circle delivers', 'Arbitrum Sepolia', RUN.forward),
		row('Sui to Base, user claims', 'Base Sepolia', RUN.suiOut),
		row('Base to Sui, user claims', 'Sui testnet', RUN.suiIn),
		row('Sui to Base, Corridor pays (0 SUI)', 'Base Sepolia', RUN.corridorOutLive),
		row('Base to Sui, Corridor pays', 'Sui testnet', RUN.corridorInLive),
		row('Mainnet: someone\'s Sui mint', 'Sui mainnet', RUN.mainnetMint),
	], { widths: [4.2, 2.15, 5.2], rowH: 0.47, size: 13, monoCols: [2] });
}

// 13 Gotchas and take home
{
	const s = d.slide({
		eyebrow: 'GOTCHAS',
		title: 'Six things that will bite you',
		subtitle: 'All of them came up building Corridor and bridge.setsuna.finance.',
		note: {
			explain: 'Each one cost real time. The recipient one costs real money: Circle mints to whatever 32 bytes you give it, so an EVM address padded into a Sui address mints to an account nobody holds.',
			show: 'Open src/lib/recipient.ts: every typed recipient is checked against the destination chain before anything is burned.',
			ask: 'Which of the six would cost a user money?',
			answer: 'The recipient check and the double burn. The rest cost you time.',
			next: 'Build it, then Day 3: Hashi, Bitcoin on Sui.',
			refs: 'README.md "Gotchas we hit"',
		},
	});
	d.grid(s, [
		{ title: 'V2 is not V1', body: 'On Sui the handler burns the coin. Bridge Kit only knows Sui\'s V1 contracts.' },
		{ title: 'Sui is standard only', body: 'Fast is N/A from Sui, and the fee API has no Sui quotes.' },
		{ title: 'Prepare, then sign', body: 'Resolve coinWithBalance with a client before the wallet sees the PTB.' },
		{ title: '404 is pending', body: 'Iris has not indexed the burn yet. Never show failed.' },
		{ title: 'Save the burn first', body: 'Record the hash before the receipt, or a retry burns twice.' },
		{ title: 'Check the recipient', body: 'Sui is 32 bytes, EVM 20. Circle mints to whatever you give it.' },
	], { y: 2.5, h: 1.6, bodySize: 13.5 });
	d.bar(s, 'Take home: CCTP moves the dollars. Your app is the wallets, the route, the gas and the truth about a half-done transfer.', 6.25);
}

const header = `# Day 2 Speaker Notes: Build Your Own Bridge

Keys, Dollars and Bitcoin, Day 2, SuiHub Lagos. Deck: teaching/Day2_Build_Your_Own_Bridge.pptx (13 slides, rebuilt with \`pnpm slides\`). The product we model: ${PRODUCT}. Class app: ${LIVE}. Repo: ${REPO}.

## Before class

- Install MetaMask and Slush in the presenting browser. Fund the MetaMask account with Base Sepolia ETH and USDC, and the Slush account with testnet SUI and USDC (faucet.circle.com, faucet.sui.io).
- Run one transfer per route you will show (Base to Arbitrum, Base to Sui, Sui to Base) and check each reaches Done.
- Check the Corridor relayer and operator still have gas: /api/config shows both.
- Students need Node 22+, pnpm, a browser with MetaMask and Slush, and testnet USDC.

## Run of show (about two hours)

| Slides | Minutes | What happens |
|---|---|---|
| 1 to 3 | 15 | The product on bridge.setsuna.finance, the one idea, the six parts |
| 4 to 5 | 15 | What is live on Sui, the four steps |
| 6 to 8 | 30 | Wallets, Bridge Kit for EVM, our PTBs for Sui (live transfers) |
| 9 to 11 | 20 | Who pays gas, the fee, half-done states (reload and find by hash live) |
| 12 to 13 | 10 | Proof, gotchas, take home |
| hands on | 30 | Everyone bridges between Sui and Base with their own wallets |

`;

d.save(OUT, NOTES, header).then((r) => console.log(`wrote ${r.out} (${r.slides} slides) and ${r.notesOut}`));
