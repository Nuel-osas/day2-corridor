# Day 2 Speaker Notes: Build Your Own Bridge

Keys, Dollars and Bitcoin, Day 2, SuiHub Lagos. Deck: teaching/Day2_Build_Your_Own_Bridge.pptx (13 slides, rebuilt with `pnpm slides`). The product we model: https://bridge.setsuna.finance. Class app: https://day2-corridor.vercel.app. Repo: https://github.com/Nuel-osas/day2-corridor.

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


## 01. corridor: Build Your Own Bridge

EXPLAIN
Today we build a bridge app, the product a user actually opens. https://bridge.setsuna.finance is the finished version of what we build: 28 chains, one wallet per ecosystem, fast or standard, pay gas in USDC, and a history that follows the wallet. Our class app, Corridor, is the same design cut to teaching size, on testnets, with Sui at the centre.

SHOW / DO
Open https://bridge.setsuna.finance on the projector, switch it to testnet and walk through one transfer screen. Then open https://day2-corridor.vercel.app: same shape, the code we read today. Ask the room to clone https://github.com/Nuel-osas/day2-corridor and run pnpm install while you talk.

ASK THE ROOM
Which bridges have you used, and what did they charge you?

EXPECTED ANSWER
Most people name a liquidity bridge or an exchange. They charged a fee or a spread, and the user paid gas on both sides. Today we build the same product without holding anyone's money.

TRANSITION
What a bridge really is.

REFERENCES
https://bridge.setsuna.finance ; https://day2-corridor.vercel.app ; https://github.com/Nuel-osas/day2-corridor

## 02. A bridge is a burn, a proof and a mint.

EXPLAIN
Three kinds of bridge: lock and mint (a wrapped token backed by a vault someone must guard), liquidity pools (someone must fund both sides), and burn and mint, which only works when the issuer controls the token. Circle issues USDC, so CCTP can burn it here and mint it there. You never hold user funds, which removes the biggest risk a bridge has.

SHOW / DO
Draw three boxes: Burn on chain A, Circle signs, Mint on chain B. Then circle what is missing for a user: connecting wallets, picking chains, paying gas on B, knowing where the money is. That is our app.

ASK THE ROOM
If CCTP does the hard part, what is left for a bridge app?

EXPECTED ANSWER
Wallets on every chain, routing, quotes, fees, gas on the destination, and a tracker that survives a closed tab.

TRANSITION
The product we are building.

REFERENCES
https://developers.circle.com/cctp/references/sui-packages

## 03. What a bridge app does

EXPLAIN
This is the spec for today. Every part maps to a file in the repo: wallets.tsx, chains.ts, the quote in Bridge.tsx, the speed switch, the gas choice, and transfer.ts for the tracker.

SHOW / DO
On https://bridge.setsuna.finance point at each part in turn: the wallet drawer with one wallet per ecosystem, the chain pickers, the quote, Fast and Standard, "Pay gas in USDC", and History with search by hash.

ASK THE ROOM
Which of the six is the hardest to get right?

EXPECTED ANSWER
The tracker. Everything else is a form. The tracker must be right when the user closes the tab after the burn and comes back a day later on a different device.

TRANSITION
What CCTP V2 offers on Sui today.

REFERENCES
https://bridge.setsuna.finance

## 04. CCTP V2 on Sui: what is live

EXPLAIN
Circle merged "CCTP V2 on Sui" into circlefin/sui-cctp on 5 October and lists V2 package ids for testnet and mainnet. Sui is domain 8. As a source Sui sends standard transfers only, but Sui finalises in about a second, so Circle attested our standard burn 5 seconds after it executed. Into Sui, fast transfers work. On 10 November we read Circle's mainnet state objects and real mainnet transactions with the same calls we write today: a burn on 5 November (CtgJhudiEsBs5FtBwkYaGkQYhMtwgkpQwLBCfUcchvnb) and a mint on 7 November (Gy3393NZCGnzxt88vPUjK6bjmSpWkqVjujjXvkwYoHq8). The app runs on testnet because the class uses test money; mainnet is the same code with mainnet ids.

SHOW / DO
Open Circle's Sui packages page next to Suiscan: the package ids match the objects on chain.

ASK THE ROOM
Why would Sui have no fast transfer, if fast is the premium product elsewhere?

EXPECTED ANSWER
Fast transfers exist because Ethereum and its rollups take minutes to finalise; Circle takes the reorg risk for a fee. Sui is final in about a second, so a standard transfer from Sui is already fast, at no fee.

TRANSITION
One transfer, step by step.

REFERENCES
https://developers.circle.com/cctp/references/sui-packages ; https://developers.circle.com/cctp/references/contract-addresses ; https://github.com/circlefin/sui-cctp (commit "CCTP V2 on Sui #32")

## 05. Four steps on every route

EXPLAIN
This is the whole engine. On an EVM chain the user approves USDC for TokenMessengerV2, then calls depositForBurn. On Sui there is no approval: the coin goes straight into the burn PTB. Either way the burn names a destination domain and a 32-byte recipient. Then you poll Circle's Iris API with the source domain and the burn hash until the message is attested. Then someone calls receiveMessage on EVM, or the four-call receive PTB on Sui, and pays that chain's gas.

SHOW / DO
Open src/lib/transfer.ts, function runTransfer: one function walks the four steps and saves the record after each one.

ASK THE ROOM
Why does the attestation step need no wallet at all?

EXPECTED ANSWER
It is a read: Iris is a public API. The burn hash plus the source domain is enough to fetch the signed message, from any device, by anyone.

TRANSITION
Step zero: the wallets.

REFERENCES
src/lib/transfer.ts ; https://developers.circle.com/cctp

## 06. One wallet per ecosystem

EXPLAIN
A bridge needs a wallet on each side, and they are different wallets. EIP-6963 lets every EVM wallet announce itself, so MetaMask and Rabby can coexist instead of fighting over window.ethereum. Sui wallets such as Slush register with Wallet Standard; we keep the ones whose chains start with "sui:". We store one connected wallet per ecosystem, so a Base to Sui transfer has MetaMask on one side and Slush on the other.

SHOW / DO
Open the wallet drawer in the app: two sections, EVM and Sui, each with the wallets this browser has installed.

ASK THE ROOM
Why not use one EVM wallet for everything?

EXPECTED ANSWER
Sui does not use EVM keys or EVM transactions. The Sui side needs a Sui wallet to sign a PTB. Even the recipient address is a different shape: 32 bytes on Sui, 20 on EVM.

TRANSITION
EVM routes in a few lines, with Circle's Bridge Kit.

REFERENCES
https://eips.ethereum.org/EIPS/eip-6963 ; https://docs.sui.io/standards/wallet-standard

## 07. EVM to EVM with Bridge Kit

EXPLAIN
For EVM and Solana routes, Circle's Bridge Kit does the four steps in one call. You give it an adapter made from the user's wallet, the two chain names and an amount. It emits an event per step, which we turn into the tracker, and returns a result you can hand back to kit.retry after a failure. Two settings matter for a product: transferSpeed (FAST or SLOW) and useForwarder, which asks Circle to mint on the destination and take its fee from the USDC, so the user needs no gas there.

SHOW / DO
Bridge 1 USDC from Base Sepolia to Arbitrum Sepolia in the app and watch the four events arrive.

ASK THE ROOM
Bridge Kit does all of this. Why do we still write our own code for Sui?

EXPECTED ANSWER
Bridge Kit has adapters for EVM and Solana and only knows Sui's V1 contracts. Any route that touches Sui is ours to build: the burn and mint PTBs on the next slide.

TRANSITION
The Sui side, in our own PTBs.

REFERENCES
https://developers.circle.com/bridge-kit ; @circle-fin/bridge-kit, @circle-fin/adapter-viem-v2

## 08. Sui routes: your own PTBs

EXPLAIN
In V2 TokenMessengerMinter never touches the coin. deposit_for_burn validates and returns a BurnReceipt plus the coin; the USDC handler burns the coin with its MintCap and returns a ticket; complete_burn sends the message. Hot potatoes force all three into one PTB, which the user's Sui wallet signs. Into Sui is receive_message, prepare_mint, handler::mint, complete_mint. With a zero destination caller, anyone can submit the mint, so the user can claim with their own wallet.

SHOW / DO
Bridge from Sui testnet to Base Sepolia with Slush. Open the burn on Suiscan: three MoveCall commands and the DepositForBurn event.

ASK THE ROOM
Why does Circle split the burn into tickets instead of one function?

EXPECTED ANSWER
Upgrades. Integrators link to stable entry points while the PTB calls the latest TokenMessengerMinter, so Circle can upgrade without breaking every package that depends on it.

TRANSITION
Who pays the gas on the other side.

REFERENCES
src/lib/sui.ts ; https://developers.circle.com/cctp/references/sui-packages

## 09. Who pays on the other side

EXPLAIN
Claim it yourself: the user signs receiveMessage with their destination wallet and needs that chain's gas token. Pay gas in USDC: Circle's Forwarding Service submits the mint and takes a fee from the USDC; on 10 November the sandbox quoted about 0.053 USDC for Ethereum Sepolia to Base Sepolia and 0.086 for Base Sepolia to Arbitrum Sepolia, and returned an error for every route that touches Sui. So for Sui routes you run your own relayer, which is what Corridor does: the operator sponsors the Sui burn, so the user signs with 0 SUI, and our relayer pays for the mint.

SHOW / DO
In the app, pick Base Sepolia to Arbitrum Sepolia and turn on "Pay gas in USDC": the quote shows Circle's fee. Pick Sui to Base: the option changes to "Corridor pays", with Corridor's fee.

ASK THE ROOM
The relayer pays gas for strangers. What stops someone draining it?

EXPECTED ANSWER
It only mints messages whose sender is Corridor's package and whose destination caller is the relayer. Those messages only exist if the user paid Corridor's fee in the same PTB as the burn.

TRANSITION
How you charge for all this.

REFERENCES
https://developers.circle.com/cctp (Forwarding Service) ; api/_lib/relay.ts

## 10. Your fee: Bridge Kit or Move

EXPLAIN
On EVM routes, Bridge Kit's setCustomFeePolicy takes your fee on the source chain, and Circle keeps 10 percent of it. On Sui routes Bridge Kit cannot help, so corridor::send, our Move function, takes the fee from the coin and hands the rest to CCTP's burn in the same PTB. CCTP then records keccak256 of our witness type as the message sender, so the relayer can prove the fee was paid before it spends any gas.

SHOW / DO
Open move/corridor/sources/corridor.move, function send. Then the Corridor object on Suiscan: the vault balance grows with every Sui transfer.

ASK THE ROOM
A user can call Circle directly and skip corridor::send. Is that a hole?

EXPECTED ANSWER
No. They lose what the fee buys: the sponsored gas and our relayer. CCTP stays open to everyone, which is the point of a public protocol.

TRANSITION
The part users judge you on: half-done transfers.

REFERENCES
move/corridor/sources/corridor.move ; developers.circle.com Bridge Kit custom fees

## 11. Half done is a state, not an error

EXPLAIN
Once the burn lands, the money is safe: it is attested, about to be minted, or minted. So the screen never says failed after a burn. Save the burn hash the moment the wallet returns it, before waiting for the receipt, so a retry settles that burn instead of sending a second one. Before paying for a mint, ask the destination whether the nonce is used (usedNonces on EVM, is_nonce_used on Sui). While we built Corridor the relayer had no ETH and four attested transfers sat in Ready for two days, safe, until it could pay.

SHOW / DO
Send from Base Sepolia, then reload the page during attestation: the transfer comes back from localStorage. Open a private window, paste the burn hash into Find: same transfer, rebuilt from Iris.

ASK THE ROOM
A user pays, sees a red "failed" banner, and pays again. What went wrong in that product?

EXPECTED ANSWER
It treated an ambiguous state as a failure. The rule: an ambiguous status shows as pending, never failed, so nobody pays twice.

TRANSITION
What we verified.

REFERENCES
src/lib/transfer.ts ; src/lib/iris.ts

## 12. Proof: real transfers

EXPLAIN
Every row is a real transaction you can open, made through https://day2-corridor.vercel.app by scripts/e2e-bridge.ts: an EVM test wallet announced over EIP-6963 and a Sui test wallet registered with Wallet Standard, the same way MetaMask and Slush connect. The Bridge Kit burn 0x1cd7eea61631906eb4931e1aba75a3d1a8ae6cdfaea2264fca19d83b3c5d3d52 shows the fee split on chain: 0.15 USDC burned, 0.009 to our fee address, 0.001 to Circle. Circle's forwarder sent the Arbitrum mint itself. Each route took 10 to 17 seconds end to end.

SHOW / DO
Open two on the explorers: the Bridge Kit burn on sepolia.basescan.org (three USDC transfers: Circle, us, the burn) and the user's own Sui mint on Suiscan. Full hashes are in README "Verified so far".

ASK THE ROOM
Which field in Circle's message tells the destination who may submit the mint?

EXPECTED ANSWER
destinationCaller. Zero means anyone, so the user can claim. Corridor sets it to our relayer, so nobody can front-run the mint it is paying for.

TRANSITION
What will bite you, and what to take home.

REFERENCES
https://github.com/Nuel-osas/day2-corridor#verified-so-far

## 13. Six things that will bite you

EXPLAIN
Each one cost real time. The recipient one costs real money: Circle mints to whatever 32 bytes you give it, so an EVM address padded into a Sui address mints to an account nobody holds.

SHOW / DO
Open src/lib/recipient.ts: every typed recipient is checked against the destination chain before anything is burned.

ASK THE ROOM
Which of the six would cost a user money?

EXPECTED ANSWER
The recipient check and the double burn. The rest cost you time.

TRANSITION
Build it, then Day 3: Hashi, Bitcoin on Sui.

REFERENCES
README.md "Gotchas we hit"
