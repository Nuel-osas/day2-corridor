# Circle CCTP V2 Move sources (vendored)

These four packages are copied from Circle's repositories so Corridor can compile against the
real CCTP V2 types on Sui testnet. They are Circle's code under the Apache 2.0 licence in `LICENSE`.

| Package | Source | Testnet address |
|---|---|---|
| sui_extensions | circlefin/stablecoin-sui `packages/sui_extensions` at 23fff2ed | 0x252b1dd4b853d6b4c0721cf3f55c0587c940ee4d386d1b1cb5f46fa16e3de98a |
| cctp_extensions | circlefin/sui-cctp `packages/cctp_extensions` at master (5 Oct 2026, "CCTP V2 on Sui #32") | 0x3cdb05f9a035c147410f5a9cfe2ccb741f4ab3cd59411e86714ce4b45e2c4d95 |
| message_transmitter_v2 | circlefin/sui-cctp `packages/message_transmitter_v2` | 0xe9678cd42a81886e18e21361088071f275105636a4d3751e1d7f255211f73bbe |
| token_messenger_minter_v2 | circlefin/sui-cctp `packages/token_messenger_minter_v2` | 0x267d3c0cb776eace2840f27e4d33da9c6d952f9749403f1fe6579f4962ed3c64 |

How the addresses were checked (8 November 2026): the linkage table of TokenMessengerMinterV2 on
testnet (GraphQL `asMovePackage { linkage }`) lists the other three, and the TMM and MT ids match
developers.circle.com/cctp/references/sui-packages.

What was changed, and why:

- Each package got a hand-written `Published.toml` with its testnet address. Circle's repo has
  none, so without it the Sui CLI cannot link a dependent package to the deployed code.
- Circle's `Move.lock` files were removed; the CLI writes new ones for this layout.
- `sui_extensions` no longer pins a 2024 Sui framework git revision; it uses the CLI's own.
- Inline `#[test_only]` modules were removed. They need Circle's `stablecoin` package, which is not
  vendored, and the Sui CLI compiles dependency tests when you run `sui move test`.

No production code was edited. Do not publish these packages: they already exist on chain.
