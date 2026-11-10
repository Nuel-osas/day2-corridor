# Corridor · Day 2

The class app for **Build Your Own Bridge** at SuiHub Lagos (Keys, Dollars and Bitcoin week).

Corridor is a working USDC bridge app on Circle's Cross-Chain Transfer Protocol V2, built the way [bridge.setsuna.finance](https://bridge.setsuna.finance) is built, cut to teaching size and run on testnets:

- **Your users' own wallets**, one per ecosystem: MetaMask (or any EVM wallet, found over EIP-6963) and Slush (or any Sui wallet, found over Wallet Standard), side by side.
- **Any CCTP V2 testnet**: Sui plus every EVM testnet in Circle's Bridge Kit (Base, Ethereum, Arbitrum, OP, Avalanche, Polygon, Unichain, Linea and more).
- **Two engines**: Circle's Bridge Kit for EVM to EVM, and our own PTBs and contract calls for every route that touches Sui (Bridge Kit only knows Sui's V1 contracts).
- **A choice of who pays the gas** on the destination: the user claims it, Circle delivers for a fee in USDC (EVM routes), or Corridor pays (Sui routes).
- **A fee for the business**: Bridge Kit's custom fee on EVM routes, and our Move contract on Sui routes.
- **A tracker that survives a closed tab**: every step is saved, and any transfer can be found again from its burn hash.

Live: https://day2-corridor.vercel.app

## Routes

| Route | Burn | Mint, and who pays it | Our fee |
|---|---|---|---|
| EVM to EVM | Bridge Kit (`kit.bridge`): approve and depositForBurn | The user's wallet, or Circle's Forwarding Service (`useForwarder`), paid from the USDC | Bridge Kit custom fee, 0.1 percent, min 0.01, on top; Circle keeps 10 percent of it |
| Sui to EVM, user claims | Three-call PTB signed by the user's Sui wallet | `receiveMessage`, signed by the user's EVM wallet | none |
| EVM to Sui, user claims | approve and `depositForBurn`, signed by the user's EVM wallet | Four-call receive PTB, signed by the user's Sui wallet | none |
| Sui to Base, Corridor pays | `corridor::send` in the same PTB as the burn; the operator sponsors the gas, so the user needs 0 SUI | Corridor's relayer on Base (it is the destination caller) | Move fee, 0.3 percent, min 0.01, kept in the Corridor object's vault |
| Base to Sui, Corridor pays | approve and `depositForBurn`, signed by the user's EVM wallet | Corridor's operator on Sui | none during class |

Circle's Forwarding Service is not offered on Sui routes: on 10 November 2026 Circle's fee API (`/v2/burn/USDC/fees`) answered "Invalid source/destination domain id" for every route touching domain 8. For Sui, the bridge runs its own relayer.

```
Sui -> EVM (user claims)
  deposit_for_burn<USDC>  ->  handler::burn  ->  complete_burn       one PTB, the Sui wallet signs
  Iris /v2/messages/8?transactionHash=<digest>                         attested in seconds
  MessageTransmitterV2.receiveMessage(message, attestation)           the EVM wallet signs

EVM -> Sui (user claims)
  USDC.approve, TokenMessengerV2.depositForBurn                       the EVM wallet signs
  Iris /v2/messages/<domain>?transactionHash=<hash>
  receive_message -> prepare_mint<USDC> -> handler::mint -> complete_mint   the Sui wallet signs
```

## Verified on the live site (10 November 2026)

Every route was run through https://day2-corridor.vercel.app by `scripts/e2e-bridge.ts`, which injects an EVM test wallet over EIP-6963 and a Sui test wallet over Wallet Standard, the same way MetaMask and Slush connect, and signs with testnet keys.

| Route | Burn | Mint | Time |
|---|---|---|---|
| Sui to Base, Corridor pays (user 0 SUI) | 3pGvZc1z13FhjqmWAYFDcAxpTFaCWUKq5CMdKCQ9Zipu | 0xccbe62a560ef923700746a99d3a621b7f09cd4a5ecf54bdfcb63cbf2b5d29ddc (relayer; 0.15 in, 0.01 fee, 0.14 minted) | 10 s |
| Sui to Base, user claims | DRXw9ymqgRoJPTLPTemBUhKtSp5PtKxuxvKMDEjzjakR | 0xcc7a695a1b479b64fc6c095eb7204920425d8e7aa8fe3c2a266788cb2979d5ba (user) | 16 s |
| Base to Sui, user claims, fast | 0xee8d65be75f9b4c70a36a0d81b311d6dd66cfd34e0270b59b304645fb93caa62 | CnYYh73wTjCZUyWnMFQFYVMRad3apzCwFGEaMM1DnrKy (user) | 10 s |
| Base to Sui, Corridor pays, fast | 0x45cd4706c4df6c189de49b61aaa0e2b5b5e51991f906ce0509ba3b4da89a7d9e | 4Mrr1e2GmZ6YrgmR5gmtvAWmSsByv2v8Umr5hHqfZCU2 (operator) | 10 s |
| Base to Arbitrum, Bridge Kit, Circle delivers | 0x1cd7eea61631906eb4931e1aba75a3d1a8ae6cdfaea2264fca19d83b3c5d3d52 | 0x306a45f03eb6058f4f190f42866af6f3585fbb708756b4a70ae4e74cdcc1fcea (Circle's forwarder) | 17 s |

The Bridge Kit burn shows the fee split in its USDC transfers: 0.16 from the user, 0.15 burned, 0.009 to our fee address, 0.001 to Circle. On Arbitrum, Circle's forwarder minted 0.060888 to the user and kept 0.089112.

Earlier runs (8 to 10 November): the first sponsored Sui burns (DpUY4FYuUbgNHCAxW7oqVeKzdwC9ZNCwkEivVP2imCBF and three more) waited two days in "attested" until the relayer had Base Sepolia ETH, then minted (first mint 0x0a95d8a9f259278d09f59e0b070533c0c5faddecb016e19b41ce641d8e4b7a6b). `pnpm move:test` passes 10 Move tests.

## Deployed on testnet

| What | Id | How it was checked |
|---|---|---|
| Corridor package | `0x8ab082c86cdfa84e6d1b5470c93821c6ee8535f0a24dfc938e85cb4206f39765` | published from `move/corridor`, digest HB5gC9PyrmehSyivDbz9enmtwj5XohK652w4cEZHfVab |
| Corridor\<USDC\> (0.3%, min 0.01 USDC) | `0xa4ba9246b0dc99282bc0292ad13e2e0ea2b122b4013510f89c8050dad924fcfd` | opened by `pnpm open-corridor`, digest 8xv4WnC7x9xp3NBQgBqsFzNT28nQJ5NvsQKZ42rrcZr6 |
| CCTP V2 on Sui | see `shared/config.ts` | Circle's Sui packages page, GraphQL object types, live burns and mints |
| CCTP V2 on EVM testnets | from `@circle-fin/bridge-kit/chains` | Bridge Kit's chain definitions; Base Sepolia also checked with `eth_getCode` |
| Corridor's CCTP sender id | `0xccb66fbbb2f339a61a1bd81ad924d0d9ed21658c1fa26a16762ae23d320d606b` | keccak256 of `<pkg>::corridor::CorridorAuth`, equal to `messageSender` in Circle's attestation of our burns |

CCTP V2 is live on Sui mainnet too: Circle lists mainnet package ids, and on 10 November we read mainnet transactions using the same burn (CtgJhudiEsBs5FtBwkYaGkQYhMtwgkpQwLBCfUcchvnb) and mint (Gy3393NZCGnzxt88vPUjK6bjmSpWkqVjujjXvkwYoHq8) calls. The app runs on testnet because the class uses test money.

## Run it

Node 22+, pnpm, a browser with MetaMask and Slush, and testnet USDC from faucet.circle.com. The Sui CLI (1.81 or later) for the Move part.

```sh
pnpm install
cp .env.example .env     # operator and relayer testnet keys, only for Corridor's own API
pnpm dev                 # http://localhost:5293, the API runs inside Vite
pnpm build               # typecheck, then production build
pnpm move:test           # Move unit tests against the vendored CCTP V2 sources
pnpm e2e                 # every route in headless Chrome with injected test wallets (DEMO_EVM_KEY, DEMO_SUI_KEY)
pnpm relay out <digest>  # resume a Corridor transfer by hand (in <0xhash> for Base to Sui)
```

`ROUTES=corridor-out,sui-out,sui-in,corridor-in,kit-forward APP_URL=https://day2-corridor.vercel.app pnpm e2e` runs the routes against the live site.

## Gotchas we hit

- **V2 is not V1.** On Sui the burn is three calls and the USDC handler burns the coin; the receive is four calls. Bridge Kit only knows Sui's V1 contracts, so every Sui route is ours to build.
- **Sui is standard only.** Fast is N/A from Sui (it finalises in about a second, attested in 5 seconds), and Circle's fee API has no quotes for Sui routes, so no forwarding either.
- **Prepare, then sign.** Resolve `coinWithBalance` with a client (`tx.prepareForSerialization`) before the wallet sees the PTB.
- **A sponsored PTB goes to the wallet already built.** For Corridor's 0 SUI route we build the bytes with the operator as gas owner, the wallet signs them (`sui:signTransaction`), and the API co-signs exactly those bytes.
- **Circle's delivery fee moves.** On 10 November the fee charged was above Circle's "med" estimate. The app quotes Circle's "high" estimate and says "about" for Bridge Kit routes, because Bridge Kit picks the fee ceiling itself.
- **Iris returns 404 before it indexes a burn.** Treat it as pending, never as failed.
- **Save the burn first.** The burn hash is recorded as soon as the wallet returns it, so a retry settles that burn instead of sending a second one.
- **Check the recipient.** Sui addresses are 32 bytes, EVM 20. Circle mints to whatever bytes it is given.
- **The sponsor is a signer.** `api/_lib/server.ts` allows only Corridor's calls plus coin helpers, exactly one `corridor::send`, and nothing the operator owns.
- **The destination caller cuts both ways.** Corridor transfers name our relayer, so nobody can front-run the mint it pays for, but if its key is lost those transfers can never be minted.
- **An empty relayer looked like a bad request.** Base's RPC answered "Missing or invalid parameters" at 0 ETH. The relayer checks its balance and reports `ready`.

## Code map

- `src/lib/wallets.tsx`: EIP-6963 and Wallet Standard discovery, one connected wallet per ecosystem
- `src/lib/chains.ts`: Sui plus every EVM testnet from Bridge Kit's definitions
- `src/lib/kit.ts`: Bridge Kit for EVM to EVM, events for the tracker, our custom fee
- `src/lib/sui.ts`: the Sui burn and mint PTBs signed by the user's wallet, and Corridor's sponsored send
- `src/lib/evm.ts`: approve, depositForBurn, receiveMessage and `usedNonces` with the user's EVM wallet
- `src/lib/iris.ts`: Circle's attestation and fee APIs
- `src/lib/transfer.ts`: the four-step engine, saved after every step, and find by burn hash
- `src/App.tsx`: wallets, route, quote, gas choice, tracker, history
- `move/corridor/sources/corridor.move`: the Move fee contract
- `api/`: Corridor's sponsor (`/api/sponsor`), relayer (`/api/relay`) and config (`/api/config`)
- `scripts/e2e-bridge.ts`: the browser test with injected wallets
- `teaching/`: the deck generator, speaker notes and renderer
