# Corridor · Day 2

The class app for **Build Your Own Bridge: Native USDC on Sui with CCTP V2, Bridge Fees and Gasless Transfers** at SuiHub Lagos.

Corridor is a working USDC bridge between Sui testnet and Base Sepolia, built on Circle's Cross-Chain Transfer Protocol V2. CCTP burns USDC on one chain and Circle's attesters let it be minted natively on the other, so Corridor never holds anyone's money. On top of CCTP, Corridor adds the two things that make a bridge a business:

- **A fee, enforced onchain.** `corridor::send` (our Move contract) takes its cut from the coin and hands the rest to CCTP's burn in the same transaction. CCTP records Corridor's package as the message sender, so the relayer can prove a transfer paid before it spends gas on it.
- **No gas for users.** The operator sponsors the Sui transaction, and the relayer fetches Circle's attestation and pays for the mint on the other chain. A user who holds only USDC can bridge.

## How a transfer moves

```
Sui -> Base Sepolia (one PTB, sponsored)
  corridor::send                                  fee into the corridor's vault, returns Circle's burn ticket
  deposit_for_burn_with_package_auth<USDC, CorridorAuth>   validates, returns BurnReceipt + coin
  stablecoin_handler::handler::burn               burns the coin with the USDC MintCap
  deposit_for_burn::complete_burn                 sends the CCTP message, emits DepositForBurn
then
  Circle attests (Iris API, domain 8)  ->  relayer calls MessageTransmitterV2.receiveMessage on Base, pays ETH

Base Sepolia -> Sui
  TokenMessengerV2.depositForBurn (fast transfer, finality 1000)  ->  Circle attests in seconds
  relayer runs one PTB on Sui and pays the SUI:
  receive_message -> prepare_mint<USDC> -> handler::mint -> complete_mint<USDC, Auth>
```

The relayer is stateless. Every step reads Circle's API and the chains (`usedNonces` on Base, `is_nonce_used` on Sui), so after a crash, a redeploy or a closed tab, the same call picks up where it stopped and never mints twice.

## Deployed on testnet (8 November 2026)

| What | Id | How it was checked |
|---|---|---|
| Corridor package | `0x8ab082c86cdfa84e6d1b5470c93821c6ee8535f0a24dfc938e85cb4206f39765` | published from `move/corridor`, digest HB5gC9PyrmehSyivDbz9enmtwj5XohK652w4cEZHfVab |
| Corridor\<USDC\> (0.3%, min 0.01 USDC) | `0xa4ba9246b0dc99282bc0292ad13e2e0ea2b122b4013510f89c8050dad924fcfd` | opened by `pnpm open-corridor`, digest 8xv4WnC7x9xp3NBQgBqsFzNT28nQJ5NvsQKZ42rrcZr6 |
| CCTP V2 on Sui testnet | see `shared/config.ts` | Circle's sui-packages page, GraphQL object types, and live burns and mints that use the same ids |
| CCTP V2 on Base Sepolia | TokenMessengerV2 `0x8FE6...2DAA`, MessageTransmitterV2 `0xE737...E275` | Circle's contract-addresses page, `eth_getCode`, and the destination token messenger in live Sui burns |
| Corridor's CCTP sender id | `0xccb66fbbb2f339a61a1bd81ad924d0d9ed21658c1fa26a16762ae23d320d606b` | keccak256 of `<pkg>::corridor::CorridorAuth`, equal to `messageSender` in Circle's attestation of our burns |

## Verified so far

| Step | Result |
|---|---|
| Move tests | `pnpm move:test`: 10 passed |
| Sponsored burn, user holds 0 SUI | DpUY4FYuUbgNHCAxW7oqVeKzdwC9ZNCwkEivVP2imCBF: 0.25 in, 0.01 to the vault, 0.24 burned for Base Sepolia |
| Same, through the browser app (`pnpm e2e`) | 2ZRMaMbdC7D5RPZaPEZgHNXkFAca4gVq7LrZjLRLoL9X: 0.2 in, vault 0.01 -> 0.02 USDC |
| Circle attestation | `complete` for both, sender = Corridor's id, destination caller = our relayer |
| Mint on Base by the relayer | waiting: the relayer address needs Base Sepolia ETH (the app shows "attested, waiting for relayer") |
| Base -> Sui with the relayer paying SUI | written (`pnpm inbound`), not yet run: needs Base Sepolia USDC and ETH on the demo EVM wallet |

## Run it

Node 22+, pnpm, and for the Move side the Sui CLI (1.81 or later).

```sh
pnpm install
cp .env.example .env     # then fill in your own testnet keys
pnpm dev                 # http://localhost:5293, the API runs inside Vite
pnpm build               # typecheck, then production build
pnpm move:test           # Move unit tests against the vendored CCTP V2 sources
pnpm send 0.25           # Sui -> Base Sepolia from DEMO_SUI_KEY, then follows the relayer
pnpm inbound 0.5         # Base Sepolia -> Sui from DEMO_EVM_KEY
pnpm relay out <digest>  # resume or recover any transfer (in <0xhash> for inbound)
pnpm e2e                 # the whole outbound flow in headless Chrome
```

To run your own corridor: publish `move/corridor` (`sui client publish` from that folder), put the package id in `shared/deployment.json`, then `pnpm open-corridor <feeBps> <minFeeUnits>`.

## Gotchas we hit

- **V2 on Sui is not V1.** The burn is three calls in one PTB and TokenMessengerMinter never touches the coin; the USDC handler burns it. The receive is four calls. V1 code (`deposit_for_burn` with a coin, the five-call receive with `stamp_receipt`) does not work against V2.
- **Circle publishes no `Published.toml`.** To compile against CCTP you vendor the sources and write the testnet addresses yourself (`move/vendor/circle/NOTICE.md`). The CLI also compiles dependency tests, so Circle's inline tests had to go.
- **The message sender is a hash.** With `deposit_for_burn_with_package_auth`, CCTP writes keccak256 of the witness type name (with defining ids, no `0x`), not your package id. Compute it once and check it in the relayer.
- **The destination caller cuts both ways.** Only our relayer can mint, so nobody can front-run it, but if its key is lost those transfers can never be minted. Keep the key safe or leave the caller empty.
- **Sui sends standard transfers only.** Fast transfers work into Sui (1 basis point in the live mints we read). Circle's fee endpoint `/v2/burn/USDC/fees` rejected domain 8 on 8 November, so the app caps the fast fee at 5 basis points instead of asking.
- **The sponsor is a signer.** Everything the operator owns is reachable from a sponsored transaction. `api/_lib/server.ts` allows only Corridor's four calls plus coin helpers, exactly one `corridor::send`, and nothing the operator owns. CCTP also screens the sponsor against its denylist.
- **Iris returns 404 before it indexes a burn.** Treat it as pending, never as failed.
- **An empty relayer looked like a bad request.** Base's public RPC answered "Missing or invalid parameters" when the relayer had no ETH. The relayer now checks its balance and reports `ready`.
- **Two tabs can race.** Both may try to mint the same attested message. The loser's simulation fails and nobody is paid twice, but production wants one queue per nonce.

## Code map

- `move/corridor/sources/corridor.move`: the fee contract (`open`, `send`, `withdraw_fees`, `set_fee`, `set_relayer`, `pause`, `resume`)
- `shared/config.ts`: every address, with how it was verified
- `shared/corridor.ts`: the outbound and inbound PTBs, the sender id, the fee quote
- `api/_lib/server.ts`: operator and relayer keys, the sponsorship policy
- `api/_lib/relay.ts`: the stateless relayer for both directions
- `api/sponsor.ts`, `api/relay.ts`, `api/config.ts`: the HTTP surface
- `src/`: the browser app (testnet key in localStorage, transfers resume after a reload)
- `scripts/`: `send`, `inbound`, `relay`, `open-corridor`, `e2e-browser`
