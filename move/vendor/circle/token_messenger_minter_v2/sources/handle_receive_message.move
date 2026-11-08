/*
 * Copyright (c) 2026, Circle Internet Group, Inc. All rights reserved.
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/// Module: handle_receive_message
/// V2 destination-side flow, decoupled from any specific stablecoin
/// implementation (TMM never touches `Coin<T>`):
///
///   1. `prepare_mint<T>`: validates the MT `Receipt` + decoded
///      `BurnMessage` and returns a `MintReceipt<T>` hot potato
///      carrying `(local_token, mint_recipient, amount_net, fee)`.
///      Callable by anyone.
///   2. `complete_mint<T, W: drop>`: called by the registered handler
///      package (proven via witness `W`). The handler mints the coin
///      itself between the two phases; `complete_mint` only stamps +
///      completes the MT receipt and emits `MintAndWithdraw`.
///
/// Trust boundary: `complete_mint` cannot observe whether the handler
/// actually minted. Correctness is enforced by (a) the witness `W`
/// (proves the caller is the registered handler for `local_token`) and
/// (b) the phantom `T` on `MintReceipt<T>` (prevents consuming a
/// receipt for the wrong token).
module token_messenger_minter_v2::handle_receive_message {
  // === Imports ===
  use sui::{
    clock::Clock,
    event::emit,
  };
  use message_transmitter_v2::{
    receive_message::{
      StampReceiptTicket,
      Receipt,
      create_stamp_receipt_ticket,
      stamp_receipt,
      complete_receive_message,
    },
    state::State as MessageTransmitterState,
  };
  use token_messenger_minter_v2::{
    burn_message,
    handler_registry,
    message_transmitter_authenticator::{Self, MessageTransmitterAuthenticator},
    state::State,
    token_utils::calculate_token_id,
    version_control::{Self, assert_object_version_is_compatible_with_package},
  };

  // === Errors ===
  // Numbering gaps at 5 (`EMissingMintCap`) and 12
  // (`ERecipientNotTokenMessenger`) retired; do not reuse.
  const EUnknownRemoteDomain: u64 = 0;
  const EInvalidRemoteTokenMessenger: u64 = 1;
  const EInvalidBurnMessageVersion: u64 = 2;
  const EUnknownBurnToken: u64 = 3;
  const EInvalidTokenType: u64 = 4;
  const EPaused: u64 = 6;
  const EAmountOverflow: u64 = 7;
  /// `expiration_block != 0 && expiration_block <= clock.timestamp_ms()`
  /// (Sui reinterprets EVM's `expirationBlock` as ms since epoch).
  const EExpiredMessage: u64 = 8;
  /// Attester charged more than the sender agreed to.
  const EFeeExceedsMaxFee: u64 = 9;
  /// Fee `>= amount` would leave the recipient with zero net mint.
  const EFeeExceedsAmount: u64 = 10;
  /// Attester marked source-chain state as less than "confirmed" (500).
  const EUnsupportedFinalityThreshold: u64 = 11;
  /// `MintReceipt.current_version` at consume time doesn't match
  /// `version_control::current_version()`. Fires when a receipt
  /// issued by phase-1@vN is fed to phase-2@vN+1 during a migration
  /// window (both versions are in `state.compatible_versions`, but
  /// the two phases must be pinned to the same package version).
  /// Mirrors MT's `EInvalidReceiptVersion` on the MT `Receipt`.
  const EInvalidReceiptVersion: u64 = 13;

  // === Constants ===
  /// Upper bound for the `u256 -> u64` cast on `BurnMessage.amount`;
  /// Sui's `Coin::mint` amount is `u64`.
  const MAX_U64: u256 = 18_446_744_073_709_551_615;
  /// Anything below "confirmed" (500) is too weak to mint on. Matches
  /// Aptos's `MIN_FINALITY_THRESHOLD_EXECUTED`.
  const MIN_FINALITY_THRESHOLD_EXECUTED: u32 = 500;

  // === Events ===
  public struct MintAndWithdraw has copy, drop {
    mint_recipient: address,
    /// Net amount (gross minus `fee_collected`) minted to `mint_recipient`.
    amount: u64,
    mint_token: address,
    /// Amount minted to `state.fee_recipient()`; 0 when `fee_executed == 0`.
    fee_collected: u64,
  }

  // === Hot-potato ===

  /// Handoff between `prepare_mint` (issues) and `complete_mint`
  /// (consumes). Zero abilities: must be consumed in the same PTB.
  /// Phantom `T` pins the receipt to the validated coin type. Also
  /// wraps the MT `StampReceiptTicket` so both payloads flow together.
  ///
  /// `current_version` is stamped at creation and re-checked at
  /// consumption so both phases must resolve to the same TMM
  /// package version (mirrors MT's `Receipt`). The embedded MT
  /// stamp ticket already pins MT's version internally; this
  /// separately pins TMM's — `state.compatible_versions` alone is
  /// insufficient during a migration window.
  public struct MintReceipt<phantom T> {
    /// MT stamp ticket produced from the consumed `Receipt`. Passed to
    /// `stamp_receipt` + `complete_receive_message` inside `complete_mint`.
    stamp_receipt_ticket: StampReceiptTicket<MessageTransmitterAuthenticator>,
    /// Local TMM token id (from remote->local mapping).
    local_token: address,
    /// Destination address that should receive the net mint.
    mint_recipient: address,
    /// Net amount to mint for `mint_recipient` (gross amount minus fee).
    amount: u64,
    /// Fee amount to mint for `state.fee_recipient()`.
    fee: u64,
    /// TMM package version at the time `prepare_mint` ran; re-checked
    /// in `complete_mint` so both phases must be the same version.
    current_version: u64,
  }

  // === Public-View Functions ===

  /// Returns `(local_token, mint_recipient, amount, fee)` from a
  /// Non-consuming view of `(local_token, mint_recipient, amount, fee)`
  /// so the handler can read + mint before `complete_mint`. Mirrors
  /// Aptos's `get_mint_details`.
  public fun get_mint_details<T>(receipt: &MintReceipt<T>): (address, address, u64, u64) {
    (receipt.local_token, receipt.mint_recipient, receipt.amount, receipt.fee)
  }

  // === Public phase-1 ===

  /// Phase 1: consume the MT `Receipt`, decode + validate the CCTP V2
  /// burn message, return a `MintReceipt<T>` for the handler to feed
  /// into `complete_mint<T, W>`. State is read-only.
  ///
  /// Aborts if the contract is paused, the remote messenger is
  /// unregistered or doesn't match the receipt sender, the burn
  /// message version is wrong, the remote burn token isn't mapped to
  /// `T`'s local id, `amount > MAX_U64`, the message has expired
  /// (`expiration_block != 0 && expiration_block <= clock.timestamp_ms()`),
  /// `fee_executed` violates its bounds
  /// (`> max_fee` or `>= amount`), or
  /// `finality_threshold_executed < 500` ("confirmed").
  ///
  /// `receipt.recipient() == this-TMM` is deliberately delegated to
  /// MT's `stamp_receipt` (`ERecipientNotAuth`), matching Sui V1.
  public fun prepare_mint<T: drop>(
    receipt: Receipt,
    state: &State,
    clock: &Clock,
  ): MintReceipt<T> {
    assert_object_version_is_compatible_with_package(state.compatible_versions());
    assert!(!state.paused(), EPaused);
    assert!(
      receipt.finality_threshold_executed() >= MIN_FINALITY_THRESHOLD_EXECUTED,
      EUnsupportedFinalityThreshold
    );

    let remote_domain = receipt.source_domain();
    let burn_message = burn_message::from_bytes(receipt.message_body());
    let burn_token_id = burn_message.burn_token();

    validate_remote_token_messenger(remote_domain, receipt.sender(), state);
    validate_burn_message_version(burn_message.version(), state);
    let local_token_id = validate_and_return_local_token<T>(remote_domain, burn_token_id, state);

    assert!(burn_message.amount() <= MAX_U64, EAmountOverflow);
    let gross = burn_message.amount() as u64;
    let fee = validate_fee_and_return_amount(gross, burn_message.max_fee(), burn_message.fee_executed());
    let net = gross - fee;

    let expiration = burn_message.expiration_block();
    if (expiration != 0) {
      assert!((clock.timestamp_ms() as u256) < expiration, EExpiredMessage);
    };

    // No CCTP denylist check on `mint_recipient` (matches Aptos):
    // recipient is passive, and Sui's framework `DenyList<T>` runs
    // when the handler mints in phase 2.
    let mint_recipient = burn_message.mint_recipient();

    let auth = message_transmitter_authenticator::new();
    let stamp_receipt_ticket = create_stamp_receipt_ticket(auth, receipt);

    MintReceipt<T> {
      stamp_receipt_ticket,
      local_token: local_token_id,
      mint_recipient,
      amount: net,
      fee,
      current_version: version_control::current_version(),
    }
  }

  // === Public phase-2 ===

  /// Phase 2: consume the `MintReceipt<T>`, stamp + complete the MT
  /// receipt, emit `MintAndWithdraw`. Does not touch any coin; the
  /// handler must have minted `amount` to `mint_recipient` and `fee`
  /// to `state.fee_recipient()` before calling here.
  ///
  /// The witness type `W` (carried inside the ticket) must be exactly the
  /// type registered as the handler for `local_token` — package + module +
  /// type. Aborts on version mismatch, unregistered handler, or MT
  /// stamp/complete failure.
  ///
  /// Ticket-based: the handler's Move package constructs the ticket via
  /// `create_complete_mint_ticket` (non-version-gated) and returns it to
  /// the client PTB, which feeds it here against the latest TMM V2
  /// package id. See the "Integrator Ticket Pattern" section below.
  public fun complete_mint<T: drop, W: drop>(
    ticket: CompleteMintTicket<T, W>,
    state: &State,
    message_transmitter_state: &MessageTransmitterState,
  ) {
    assert_object_version_is_compatible_with_package(state.compatible_versions());
    let CompleteMintTicket { mint_receipt, witness } = ticket;
    let MintReceipt<T> {
      stamp_receipt_ticket,
      local_token,
      mint_recipient,
      amount,
      fee,
      current_version,
    } = mint_receipt;

    // Pin both phases to the same TMM package version. Prevents
    // cross-version splitting (phase-1@vN + phase-2@vN+1) during a
    // migration window when `state.compatible_versions` transiently
    // holds both.
    assert!(current_version == version_control::current_version(), EInvalidReceiptVersion);
    handler_registry::assert_is_registered_handler<W>(state, local_token, witness);

    // Emit `MintAndWithdraw` before MT's `MessageReceived` so indexers
    // see the mint result first (matches Sui V1 + Aptos).
    emit(MintAndWithdraw {
      mint_recipient,
      amount,
      mint_token: local_token,
      fee_collected: fee,
    });

    let stamped = stamp_receipt(stamp_receipt_ticket, message_transmitter_state);
    complete_receive_message(stamped, message_transmitter_state);
  }

  // === Integrator Ticket Pattern (upgrade-decoupling) ===
  //
  // See `deposit_for_burn` for the ticket-pattern rationale. Only
  // `complete_mint` needs a ticket variant here: `prepare_mint` is always
  // assembled by the client PTB (never called from a downstream Move
  // package), so it has no integrator to decouple.

  /// Hot-potato ticket carrying a `MintReceipt<T>` + handler witness.
  /// Consumed by `complete_mint`.
  public struct CompleteMintTicket<phantom T: drop, W: drop> {
    mint_receipt: MintReceipt<T>,
    witness: W,
  }

  /// NOT version-gated. Handler packages call this after minting the
  /// coin (and the fee, if any) and return the ticket to the client PTB.
  public fun create_complete_mint_ticket<T: drop, W: drop>(
    mint_receipt: MintReceipt<T>,
    witness: W,
  ): CompleteMintTicket<T, W> {
    CompleteMintTicket { mint_receipt, witness }
  }

  // === Private helpers ===

  fun validate_remote_token_messenger(remote_domain: u32, sender: address, state: &State) {
    assert!(state.remote_token_messenger_for_remote_domain_exists(remote_domain), EUnknownRemoteDomain);
    let remote_token_messenger = state.remote_token_messenger_from_remote_domain(remote_domain);
    assert!(remote_token_messenger == sender && sender != @0x0, EInvalidRemoteTokenMessenger);
  }

  fun validate_and_return_local_token<T: drop>(
    remote_domain: u32,
    burn_token_id: address,
    state: &State,
  ): address {
    assert!(state.local_token_from_remote_token_exists(remote_domain, burn_token_id), EUnknownBurnToken);
    let local_token_id = state.local_token_from_remote_token(remote_domain, burn_token_id);
    assert!(calculate_token_id<T>() == local_token_id, EInvalidTokenType);
    local_token_id
  }

  fun validate_burn_message_version(version: u32, state: &State) {
    assert!(version == state.message_body_version(), EInvalidBurnMessageVersion);
  }

  /// Validate fee bounds and return `fee_executed` as `u64`. Safe
  /// cast because `gross <= MAX_U64` and `fee_executed < gross`.
  fun validate_fee_and_return_amount(gross: u64, max_fee: u256, fee_executed: u256): u64 {
    assert!(fee_executed <= max_fee, EFeeExceedsMaxFee);
    assert!(fee_executed < (gross as u256), EFeeExceedsAmount);
    fee_executed as u64
  }

  // === Test Functions ===

  #[test_only]
  public fun create_mint_and_withdraw_event(
    mint_recipient: address,
    amount: u64,
    mint_token: address,
    fee_collected: u64,
  ): MintAndWithdraw {
    MintAndWithdraw { mint_recipient, amount, mint_token, fee_collected }
  }

  #[test_only]
  public fun destroy_mint_receipt_for_testing<T>(mint_receipt: MintReceipt<T>) {
    let MintReceipt<T> {
      stamp_receipt_ticket, local_token: _, mint_recipient: _, amount: _, fee: _, current_version: _,
    } = mint_receipt;
    std::unit_test::destroy(stamp_receipt_ticket);
  }

  /// Rewrites `current_version` on an existing `MintReceipt` to
  /// simulate the "phase-1@vN, phase-2@vN+1" migration-window
  /// scenario end-to-end without needing two published package
  /// addresses.
  #[test_only]
  public fun set_current_version_for_testing<T>(receipt: &mut MintReceipt<T>, version: u64) {
    receipt.current_version = version;
  }
}
