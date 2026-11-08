# Day 2 Speaker Notes: Build Your Own Bridge

Keys, Dollars and Bitcoin, Day 2, SuiHub Lagos. Deck: teaching/Day2_Build_Your_Own_Bridge.pptx (13 slides, rebuilt with `pnpm slides`). App: https://day2-corridor.vercel.app. Repo: https://github.com/Nuel-osas/day2-corridor.

## Before class

- Fund the relayer with Base Sepolia ETH (0xd1f2CBd5797545FA97410056304CDF1b35865cAe) and check the corridor card shows "Relayer gas left" above zero. Then `pnpm relay out <digest>` for any transfer still in Ready.
- Fund the demo Base wallet (0x0E0cacEa53366bF31Bf6938F51ea8E96d1EBBDC4) with Base Sepolia USDC and a little ETH, and run `pnpm inbound 0.5` once.
- Run `APP_URL=https://day2-corridor.vercel.app pnpm e2e` (it requires the mint by default).
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


## 01. corridor: Build Your Own Bridge

EXPLAIN
Yesterday we changed who can sign for an account. Today we move dollars between chains, and we do it as a business: our own bridge, our own fee, and no gas for the user on either side. Everything runs on Sui testnet and Base Sepolia against Circle's real CCTP V2 contracts.

SHOW / DO
Open https://day2-corridor.vercel.app on the projector. Ask the room to clone https://github.com/Nuel-osas/day2-corridor, run pnpm install, and request testnet USDC on Sui from faucet.circle.com while you talk.

ASK THE ROOM
Which bridges have you used, and what did they charge you?

EXPECTED ANSWER
Most people name a liquidity bridge or an exchange. They charged a fee, sometimes a spread, and the user paid gas on both sides. Today we build the same product without holding anyone's money.

TRANSITION
What a bridge really is.

REFERENCES
https://day2-corridor.vercel.app ; https://github.com/Nuel-osas/day2-corridor

## 02. A bridge is a burn, a proof and a mint.

EXPLAIN
Three kinds of bridge: lock and mint (a wrapped token backed by a vault someone must guard), liquidity pools (someone must fund both sides), and burn and mint, which only works when the issuer controls the token. Circle issues USDC, so CCTP can burn it here and mint it there. You never custody user funds, which removes the biggest risk a bridge has.

SHOW / DO
Draw three boxes on the board: Burn on chain A, Circle signs, Mint on chain B. Then circle the gaps around them: who pays gas on A, who submits the mint on B, who charges what. That is our product.

ASK THE ROOM
If CCTP does the hard part, what is left for a bridge business?

EXPECTED ANSWER
Fees, paying gas so the user does not need two tokens, relaying the mint, routing, and a status screen that tells the truth when a transfer is half done.

TRANSITION
What V2 looks like on Sui today.

REFERENCES
https://developers.circle.com/cctp/references/sui-packages

## 03. CCTP V2 on Sui: what is live

EXPLAIN
Circle merged "CCTP V2 on Sui" into circlefin/sui-cctp on 5 October and lists the V2 package ids for testnet and mainnet. Sui is domain 8. As a source Sui sends standard transfers only, but Sui finalises in about a second, so Circle attested our standard burn 5 seconds after it executed. Into Sui, fast transfers work: live mints we read paid Circle 1 basis point.

SHOW / DO
Run the timing yourself: pnpm send 0.1 prints the burn, then the relayer shows Circle's status moving from pending_confirmations to complete within seconds.

ASK THE ROOM
Why would Sui have no fast transfer, if fast is the premium product elsewhere?

EXPECTED ANSWER
Fast transfers exist because Ethereum and its rollups take minutes to finalise; Circle takes the reorg risk for a fee. Sui is final in about a second, so a standard transfer from Sui is already fast, at no fee.

TRANSITION
How the burn is built on Sui.

REFERENCES
https://developers.circle.com/cctp/references/sui-packages ; https://developers.circle.com/cctp/references/contract-addresses ; https://github.com/circlefin/sui-cctp (commit "CCTP V2 on Sui #32")

## 04. Out of Sui: one PTB, four calls

EXPLAIN
In V1 you handed a coin to deposit_for_burn. In V2 TokenMessengerMinter never touches the coin. Phase one validates and returns a BurnReceipt hot potato plus the coin; the USDC handler burns the coin with its MintCap and returns a ticket; complete_burn sends the message. Hot potatoes force all of it into one transaction. Our corridor::send goes in front and takes the fee.

SHOW / DO
Open shared/corridor.ts, function addSend. Then open the burn digest on Suiscan and show the four MoveCall commands and the events: TransferSentEvent (ours), Burn, MessageSent, DepositForBurn.

ASK THE ROOM
Why does Circle split the burn into tickets instead of one function?

EXPECTED ANSWER
Upgrades. Integrators link only to the ticket constructors, which are not version gated, and the PTB calls the latest TokenMessengerMinter. Circle can upgrade without breaking every package that depends on it.

TRANSITION
Our part: the fee.

REFERENCES
shared/corridor.ts ; move/vendor/circle/token_messenger_minter_v2/sources/deposit_for_burn.move ("Integrator Ticket Pattern")

## 05. The fee, enforced by Move

EXPLAIN
send takes the coin by value, so the fee comes out of what actually arrived. The rest goes into Circle's package-auth ticket with our witness, CorridorAuth. Only this module can construct CorridorAuth, so CCTP records keccak256 of its type name as the message sender. That hash, 0xccb6...606b, is how the relayer knows a transfer paid Corridor before it spends any gas.

SHOW / DO
Open corridor.move and the tests: pnpm move:test runs 10, including fee above the 5 percent ceiling, amount equal to the fee, zero recipient, paused corridor and a foreign admin cap.

ASK THE ROOM
A user can call Circle directly and skip corridor::send. Is that a hole?

EXPECTED ANSWER
No. They lose what the fee buys: our relayer only mints messages whose sender is Corridor, and only Corridor messages name our relayer as destination caller. CCTP itself stays open to everyone, which is the point of a public protocol.

TRANSITION
The other way to charge: Circle's Bridge Kit.

REFERENCES
move/corridor/sources/corridor.move ; move/corridor/tests/corridor_tests.move

## 06. Bridge Kit fee or your own Move fee

EXPLAIN
Circle's Bridge Kit (now part of App Kit) has setCustomFeePolicy with computeFee and resolveFeeRecipientAddress. The fee is taken on the source chain and Circle keeps 10 percent of it. On 6 November its docs listed EVM and Solana adapters and no Sui adapter, so for a Sui route you write the fee yourself, which is what Corridor does.

SHOW / DO
Show the vault growing: the corridor card in the app reads the Corridor object, and every send adds its fee.

ASK THE ROOM
When would you still choose Bridge Kit?

EXPECTED ANSWER
On EVM and Solana routes, when you want Circle's SDK to handle routing, approvals and retries, and you accept the 10 percent share. For Sui, or when the fee must be provable on chain, write the Move.

TRANSITION
Who pays the gas.

REFERENCES
developers.circle.com Bridge Kit custom fees (checked 6 Nov 2026)

## 07. Who pays for what

EXPLAIN
Two gas bills, two payers. On Sui the operator sponsors the transaction: it is the gas owner and pays from its address balance, so the user signs with zero SUI. On Base the relayer submits receiveMessage and pays the ETH. The relayer is also the destination caller, so nobody else can mint our messages. Inbound is mirrored: the user burns on Base, the operator mints on Sui.

SHOW / DO
Point at the wallet card: 0.000 SUI and the green "no gas needed" tag. Then the burn on Suiscan: sender is the user, gas sponsor is 0xce4a...f80d.

ASK THE ROOM
The sponsor signs every user transaction. What stops a user from spending the sponsor's money?

EXPECTED ANSWER
The sponsor policy in api/_lib/server.ts: only Corridor's calls and coin helpers, exactly one corridor::send, gas only from the sponsor's address balance with a budget cap, and nothing the sponsor owns as an input. CCTP also screens the sponsor against its denylist.

TRANSITION
The relayer, in code.

REFERENCES
api/_lib/server.ts checkSponsorable ; Suiscan DpUY4FYu...imCBF

## 08. A relayer with no database

EXPLAIN
The relayer keeps no state. It asks Iris for the message, refuses anything not sent by Corridor, asks Base whether the nonce is already used, simulates, checks its own balance, then sends. On Sui the same check is is_nonce_used, called through a simulation; the u256 is the nonce bytes read big endian, which we confirmed against Circle's own record.

SHOW / DO
Run pnpm relay out with an old digest: it answers "already minted" and finds the Base transaction from the MessageReceived log, without sending anything.

ASK THE ROOM
Why not store each transfer in a database as it moves?

EXPECTED ANSWER
Because then there are two truths. After a crash the database can say "not minted" while the chain says minted, and that is how bridges pay twice. The chain and Circle are the record; the relayer just reads them.

TRANSITION
What the user sees while it waits.

REFERENCES
api/_lib/relay.ts ; message_transmitter_v2::state::is_nonce_used

## 09. Half done is a state, not an error

EXPLAIN
Once the burn lands, the money is safe: it is either about to be minted or already minted. So the screen never says failed after a burn. A 404 from Iris means not indexed yet. Ready means anyone could mint now and our relayer is waiting, for example for gas. While we built Corridor the relayer had no ETH, and four attested transfers sat in Ready, safe, until it could pay: exactly the state this slide is about.

SHOW / DO
In the app, send 0.2 USDC, then reload the page mid-way. The transfer comes back from localStorage. Open a private window and paste the digest into Recover: same answer, because the relayer reads the chains.

ASK THE ROOM
A user pays, then sees a red "failed" banner and pays again. What went wrong in that product?

EXPECTED ANSWER
It treated an ambiguous state as a failure. The rule: an ambiguous status shows as pending, never failed, so nobody pays twice.

TRANSITION
What we verified on testnet.

## 10. Proof: our transfers

EXPLAIN
Every row is a real transaction you can open. The fee lands in the Corridor object's vault; Circle's attestation names Corridor's hash as the sender and our relayer as the destination caller.

SHOW / DO
Open two of these on the explorers: the Sui burn (sponsor, four calls, events) and the Base mint (called by the relayer).

ASK THE ROOM
Which single field in Circle's attestation lets the relayer trust that a transfer paid Corridor?

EXPECTED ANSWER
messageSender: keccak256 of the CorridorAuth type name, 0xccb6...606b. Only corridor::send can produce it.

TRANSITION
Things that will bite you.

REFERENCES
https://github.com/Nuel-osas/day2-corridor#verified-so-far

## 11. Six things that will bite you

EXPLAIN
Each one cost us time this week. The vendoring one is the first wall anyone hits when they try to compile against CCTP on Sui.

SHOW / DO
Open move/vendor/circle/NOTICE.md for the vendoring fix, and api/_lib/relay.ts for the balance check that replaced a confusing RPC error.

ASK THE ROOM
Which of the six would cost real users money if you got it wrong?

EXPECTED ANSWER
The sponsor policy and pending versus failed. A loose policy lets users spend the sponsor's funds; a wrong failed state makes users pay twice. The rest cost you time.

TRANSITION
Build it.

REFERENCES
README.md "Gotchas we hit"

## 12. Run Corridor yourself

EXPLAIN
Two levels. Level one: use the class corridor from the app or the scripts with your own wallet. Level two: publish your own copy of the Move package, open your own corridor with your own fee and relayer, and point shared/deployment.json at it.

SHOW / DO
Live: pnpm send 0.2 from the terminal, then watch the same transfer appear in the app via Recover.

ASK THE ROOM
You open your own corridor at 1 percent. What else must you change before your relayer will mint your transfers?

EXPECTED ANSWER
The relayer must be your EVM key (the destination caller you passed to open), and corridorSender must be computed from your package id. The relayer rejects messages from any other sender.

TRANSITION
What to take home.

REFERENCES
https://github.com/Nuel-osas/day2-corridor ; https://day2-corridor.vercel.app

## 13. Circle moves the dollars. You run the corridor.

EXPLAIN
Three things to remember: the V2 burn on Sui is a four-call PTB you can wrap; your package can be the provable sender; and a bridge is judged on its half-done states, so read the chains instead of keeping your own copy.

SHOW / DO
Leave the corridor card on screen with the fees collected during class.

ASK THE ROOM
What would you add before taking Corridor to mainnet?

EXPECTED ANSWER
Audits, a relayer queue with one job per nonce, monitoring of relayer and sponsor balances, rate limits on the sponsor, a fee withdrawal policy, and mainnet ids checked the same way we checked testnet.

TRANSITION
Day 3: Hashi. Bitcoin on Sui, and what it takes to build a Bitcoin bridge.
