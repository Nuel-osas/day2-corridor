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

/// Module: deposit_for_burn
/// V2 source-side burn + send flow, decoupled from any specific
/// stablecoin implementation (TMM never touches `Coin<T>`):
///
///   1. `deposit_for_burn`: validates inputs against TMM state,
///      returns a `BurnReceipt<T>` hot potato and the unchanged
///      `Coin<T>`. Callable by anyone.
///   2. `complete_burn<T, W: drop>`: called by the registered handler
///      package (proven via witness `W`). The handler burns the coin
///      itself between the two phases; `complete_burn` only sends the
///      MT message and emits `DepositForBurn`.
///
/// Trust boundary: `complete_burn` cannot observe whether the handler
/// actually burned the coin. Correctness is enforced by (a) the
/// witness `W` (proves the caller is the registered handler for
/// `burn_token`) and (b) the phantom `T` on `BurnReceipt<T>` (prevents
/// consuming a receipt for the wrong token).
module token_messenger_minter_v2::deposit_for_burn {

  // === Imports ===
  use sui::{
    coin::{Coin},
    event::emit
  };
  use message_transmitter_v2::{
    auth::{auth_caller_identifier, auth_caller_package_address},
    message::{Message},
    send_message::{create_send_message_ticket, send_message},
    state::{State as MessageTransmitterState}
  };
  use token_messenger_minter_v2::{
    burn_message::{Self, BurnMessage},
    denylistable,
    fee_controller,
    handler_registry,
    message_transmitter_authenticator,
    state::{State},
    token_utils::{calculate_token_id},
    version_control::{Self, assert_object_version_is_compatible_with_package}
  };

  // === Errors ===
  // Numbering gaps at 4, 9, 10 retired with the handler decoupling
  // (`EMissingMintCap`, `EBurnAmountMismatch`, `EBurnTokenTypeMismatch`);
  // do not reuse.
  const EZeroAmount: u64 = 0;
  const EZeroAddressMintRecipient: u64 = 1;
  const EInvalidDestinationDomain: u64 = 2;
  const EPaused: u64 = 3;
  const EMissingBurnLimit: u64 = 5;
  const EBurnLimitExceeded: u64 = 6;
  const EInvalidMaxFee: u64 = 7;
  const EInsufficientMaxFee: u64 = 8;
  /// `BurnReceipt.current_version` at consume time doesn't match
  /// `version_control::current_version()`. Fires when a receipt
  /// issued by phase-1@vN is fed to phase-2@vN+1 during a migration
  /// window (both versions are in `state.compatible_versions`, but
  /// the two phases must be pinned to the same package version).
  /// Mirrors MT's `EInvalidReceiptVersion` on the MT `Receipt`.
  const EInvalidReceiptVersion: u64 = 11;

  // === Events ===
  /// Emitted from `complete_burn`. No `nonce` because V2 assigns nonces
  /// off-chain in the attestation service.
  public struct DepositForBurn has copy, drop {
    burn_token: address,
    amount: u256,
    depositor: address,
    mint_recipient: address,
    destination_domain: u32,
    destination_token_messenger: address,
    destination_caller: address,
    max_fee: u256,
    min_finality_threshold: u32,
    hook_data: vector<u8>,
  }

  // === Hot-potato ===

  /// Handoff between `deposit_for_burn` (issues) and `complete_burn`
  /// (consumes). Zero abilities: must be consumed in the same PTB.
  /// Phantom `T` pins the receipt to the validated coin type.
  ///
  /// `current_version` is stamped at creation and re-checked at
  /// consumption so both phases must resolve to the same package
  /// version (mirrors MT's `Receipt`). `state.compatible_versions`
  /// alone is insufficient during a migration window, when the set
  /// contains both v_N and v_{N+1}: a receipt from phase-1@v_N
  /// composed with phase-2@v_{N+1} in one PTB would otherwise pass
  /// both gates.
  public struct BurnReceipt<phantom T> {
    caller: address,
    burn_token: address,
    amount: u64,
    destination_domain: u32,
    mint_recipient: address,
    destination_caller: address,
    destination_token_messenger: address,
    max_fee: u256,
    min_finality_threshold: u32,
    hook_data: vector<u8>,
    current_version: u64,
  }

  // === Public-View Functions ===

  /// Non-consuming view of `(burn_token, amount, mint_recipient)`.
  public fun get_burn_details<T>(receipt: &BurnReceipt<T>): (address, u64, address) {
    (receipt.burn_token, receipt.amount, receipt.mint_recipient)
  }

  // === Public-Mutative Functions ===

  /// Phase 1: validate inputs, issue `BurnReceipt<T>`, return the
  /// `Coin<T>` unchanged. Callable by anyone; handler auth is
  /// enforced in `complete_burn`.
  ///
  /// Aborts if the contract is paused, `ctx.sender()` is on the CCTP
  /// denylist, `amount == 0`, `mint_recipient == @0x0`, `max_fee` is not
  /// strictly less than `amount` (the check is `<`, so `max_fee == amount`
  /// aborts too — intentional so the net minted amount on the destination
  /// stays strictly positive) or `max_fee` falls below the per-token
  /// min-fee floor, `destination_domain` has no registered TokenMessenger,
  /// `T` has no registered burn limit, or the burn amount exceeds it.
  ///
  /// `destination_caller` restricts who can execute the receive on
  /// the destination; pass `@0x0` for no restriction. `hook_data` is
  /// opaque bytes forwarded to the destination-side handler.
  public fun deposit_for_burn<T: drop>(
    coin: Coin<T>,
    destination_domain: u32,
    mint_recipient: address,
    destination_caller: address,
    max_fee: u256,
    min_finality_threshold: u32,
    hook_data: vector<u8>,
    state: &State,
    ctx: &mut TxContext,
  ): (BurnReceipt<T>, Coin<T>) {
    // `ctx.sender()` is screened inside `create_burn_receipt` (it is the
    // `caller`); the gas sponsor, if any, is screened here.
    denylistable::assert_sponsor_not_denylisted(state, ctx);

    create_burn_receipt<T>(
      coin, destination_domain, mint_recipient, destination_caller,
      max_fee, min_finality_threshold, hook_data,
      ctx.sender(),
      state
    )
  }

  /// Phase 1, package-callable variant. Records
  /// `auth_caller_identifier<W>()` as the receipt's caller (also used
  /// for the denylist check) so the outbound message's
  /// `message_sender` reflects the calling package, not the PTB
  /// signer. Same aborts as `deposit_for_burn`.
  ///
  /// Ticket-based: the integrator's Move package constructs the ticket
  /// via `create_deposit_for_burn_with_package_auth_ticket` (non-version-
  /// gated) and the client PTB feeds it here against the latest TMM V2
  /// package id. See the "Integrator Ticket Pattern" section below.
  public fun deposit_for_burn_with_package_auth<T: drop, W: drop>(
    ticket: DepositForBurnWithPackageAuthTicket<T, W>,
    state: &State,
    ctx: &mut TxContext,
  ): (BurnReceipt<T>, Coin<T>) {
    let DepositForBurnWithPackageAuthTicket {
      coin,
      destination_domain,
      mint_recipient,
      destination_caller,
      max_fee,
      min_finality_threshold,
      hook_data,
      witness: _witness,
    } = ticket;

    // Four denylist screens:
    //   - `ctx.sender()`: blocks a denylisted user regardless of helper package.
    //   - `ctx.sponsor()`: blocks a denylisted gas payer funding the call
    //     through an unlisted sender. No-op when unsponsored.
    //   - `auth_caller_package_address<W>()`: blocks the whole calling
    //     package. The type-hash screen below is per-witness-type, so
    //     without this a denylisted package could rotate to a different
    //     `drop` witness and bypass.
    //   - `auth_caller_identifier<W>()` (inside `create_burn_receipt`):
    //     lets an admin narrowly block a single witness type.
    denylistable::assert_not_denylisted(state, ctx.sender());
    denylistable::assert_sponsor_not_denylisted(state, ctx);
    denylistable::assert_not_denylisted(state, auth_caller_package_address<W>());
    create_burn_receipt<T>(
      coin, destination_domain, mint_recipient, destination_caller,
      max_fee, min_finality_threshold, hook_data,
      auth_caller_identifier<W>(),
      state
    )
  }

  // === Private Phase-1 helper ===

  /// Shared validation + `BurnReceipt` construction. Called by both
  /// public wrappers with the appropriate `caller` value.
  fun create_burn_receipt<T: drop>(
    coin: Coin<T>,
    destination_domain: u32,
    mint_recipient: address,
    destination_caller: address,
    max_fee: u256,
    min_finality_threshold: u32,
    hook_data: vector<u8>,
    caller: address,
    state: &State,
  ): (BurnReceipt<T>, Coin<T>) {
    assert_object_version_is_compatible_with_package(state.compatible_versions());
    let amount = coin.value();
    let token_id = calculate_token_id<T>();

    assert!(!state.paused(), EPaused);
    // Framework `DenyList<T>` on the coin itself runs in phase 2 when
    // the handler calls `stablecoin::treasury::burn`.
    denylistable::assert_not_denylisted(state, caller);
    assert!(amount > 0, EZeroAmount);
    assert!(mint_recipient != @0x0, EZeroAddressMintRecipient);
    assert!(max_fee < (amount as u256), EInvalidMaxFee);
    assert!(
      max_fee >= fee_controller::calculate_min_fee_amount(state, token_id, amount as u256),
      EInsufficientMaxFee
    );

    let destination_token_messenger = safe_get_remote_token_messenger(destination_domain, state);
    let burn_limit = safe_get_burn_limit(token_id, state);
    assert!(burn_limit >= amount, EBurnLimitExceeded);

    let receipt = BurnReceipt<T> {
      caller,
      burn_token: token_id,
      amount,
      destination_domain,
      mint_recipient,
      destination_caller,
      destination_token_messenger,
      max_fee,
      min_finality_threshold,
      hook_data,
      current_version: version_control::current_version(),
    };

    (receipt, coin)
  }

  /// Phase 2: consume the `BurnReceipt<T>`, send the MT message, emit
  /// `DepositForBurn`. Does not touch any coin; the handler must have
  /// burned the `Coin<T>` returned from `deposit_for_burn` before
  /// calling here.
  ///
  /// The witness type `W` (carried inside the ticket) must be exactly the
  /// type registered as the handler for the receipt's `burn_token` —
  /// package + module + type (see
  /// `handler_registry::assert_is_registered_handler`). Aborts on version
  /// mismatch, unregistered handler, or MT send failure.
  ///
  /// Ticket-based: the handler's Move package constructs the ticket via
  /// `create_complete_burn_ticket` (non-version-gated) and returns it to
  /// the client PTB, which feeds it here against the latest TMM V2
  /// package id. See the "Integrator Ticket Pattern" section below.
  public fun complete_burn<T: drop, W: drop>(
    ticket: CompleteBurnTicket<T, W>,
    state: &State,
    message_transmitter_state: &MessageTransmitterState,
  ) {
    assert_object_version_is_compatible_with_package(state.compatible_versions());
    let CompleteBurnTicket { burn_receipt, witness } = ticket;
    let BurnReceipt<T> {
      caller,
      burn_token,
      amount,
      destination_domain,
      mint_recipient,
      destination_caller,
      destination_token_messenger,
      max_fee,
      min_finality_threshold,
      hook_data,
      current_version,
    } = burn_receipt;

    // Pin both phases to the same package version. Prevents
    // cross-version splitting (phase-1@vN + phase-2@vN+1) during a
    // migration window when `state.compatible_versions` transiently
    // holds both.
    assert!(current_version == version_control::current_version(), EInvalidReceiptVersion);
    handler_registry::assert_is_registered_handler<W>(state, burn_token, witness);

    let burn_message = burn_message::new(
      state.message_body_version(), burn_token, mint_recipient, amount as u256,
      caller, max_fee, hook_data
    );

    let _ = send_burn_message(
      destination_domain,
      destination_token_messenger,
      destination_caller,
      min_finality_threshold,
      &burn_message,
      message_transmitter_state
    );

    emit(DepositForBurn {
      burn_token,
      amount: amount as u256,
      depositor: caller,
      mint_recipient,
      destination_domain,
      destination_token_messenger,
      destination_caller,
      max_fee: burn_message.max_fee(),
      min_finality_threshold,
      hook_data: burn_message.hook_data()
    });
  }

  // === Integrator Ticket Pattern (upgrade-decoupling) ===
  //
  // Ticket constructors let cross-package callers avoid linking against
  // TMM V2's version-gated public entry points:
  //   1. `create_*_ticket` (non-version-gated) — integrator's Move package
  //      builds a hot-potato ticket carrying inputs + witness. No `&State`
  //      in the constructor signature, so linking against these symbols
  //      does not couple the integrator's bytecode to TMM V2's version.
  //   2. The version-gated public entry points above
  //      (`deposit_for_burn_with_package_auth` / `complete_burn`) consume
  //      the ticket. Invoked from the client PTB against the latest TMM V2
  //      package id.
  //
  // Both tickets are hot potatoes (no abilities) — must be consumed in the
  // same PTB, so the two-phase atomicity is preserved.

  /// Hot-potato ticket for phase 1 (package-auth variant). Consumed by
  /// `deposit_for_burn_with_package_auth`.
  #[allow(lint(coin_field))]
  public struct DepositForBurnWithPackageAuthTicket<phantom T: drop, W: drop> {
    coin: Coin<T>,
    destination_domain: u32,
    mint_recipient: address,
    destination_caller: address,
    max_fee: u256,
    min_finality_threshold: u32,
    hook_data: vector<u8>,
    witness: W,
  }

  /// NOT version-gated. Parameters mirror `deposit_for_burn`.
  public fun create_deposit_for_burn_with_package_auth_ticket<T: drop, W: drop>(
    coin: Coin<T>,
    destination_domain: u32,
    mint_recipient: address,
    destination_caller: address,
    max_fee: u256,
    min_finality_threshold: u32,
    hook_data: vector<u8>,
    witness: W,
  ): DepositForBurnWithPackageAuthTicket<T, W> {
    DepositForBurnWithPackageAuthTicket {
      coin,
      destination_domain,
      mint_recipient,
      destination_caller,
      max_fee,
      min_finality_threshold,
      hook_data,
      witness,
    }
  }

  /// Hot-potato ticket carrying a `BurnReceipt<T>` + handler witness.
  /// Consumed by `complete_burn`.
  public struct CompleteBurnTicket<phantom T: drop, W: drop> {
    burn_receipt: BurnReceipt<T>,
    witness: W,
  }

  /// NOT version-gated. Handler packages call this after burning the coin
  /// and return the ticket to the client PTB.
  public fun create_complete_burn_ticket<T: drop, W: drop>(
    burn_receipt: BurnReceipt<T>,
    witness: W,
  ): CompleteBurnTicket<T, W> {
    CompleteBurnTicket { burn_receipt, witness }
  }

  // === Private Functions ===

  fun safe_get_remote_token_messenger(remote_domain: u32, state: &State): address {
    assert!(
      state.remote_token_messenger_for_remote_domain_exists(remote_domain),
      EInvalidDestinationDomain
    );
    state.remote_token_messenger_from_remote_domain(remote_domain)
  }

  fun safe_get_burn_limit(local_token_id: address, state: &State): u64 {
    assert!(state.burn_limit_for_token_id_exists(local_token_id), EMissingBurnLimit);
    state.burn_limit_from_token_id(local_token_id)
  }

  /// Delegates to MT V2's `send_message`. `destination_caller == @0x0`
  /// means "no caller restriction" on the destination side.
  fun send_burn_message(
    destination_domain: u32,
    destination_token_messenger: address,
    destination_caller: address,
    min_finality_threshold: u32,
    burn_message: &BurnMessage,
    message_transmitter_state: &MessageTransmitterState
  ): Message {
    let authenticator = message_transmitter_authenticator::new();
    let ticket = create_send_message_ticket(
      authenticator,
      destination_domain,
      destination_token_messenger,
      destination_caller,
      min_finality_threshold,
      burn_message.serialize()
    );
    send_message(ticket, message_transmitter_state)
  }

  // === Test-only helpers ===

  #[test_only]
  public fun create_deposit_for_burn_event(
    burn_token: address,
    amount: u256,
    depositor: address,
    mint_recipient: address,
    destination_domain: u32,
    destination_token_messenger: address,
    destination_caller: address,
    max_fee: u256,
    min_finality_threshold: u32,
    hook_data: vector<u8>
  ): DepositForBurn {
    DepositForBurn {
      burn_token, amount, depositor, mint_recipient,
      destination_domain, destination_token_messenger, destination_caller,
      max_fee, min_finality_threshold, hook_data
    }
  }

  /// Destructor for tests that only exercise the deposit phase and
  /// never call `complete_burn`.
  #[test_only]
  public fun destroy_burn_receipt_for_testing<T>(receipt: BurnReceipt<T>) {
    let BurnReceipt<T> { .. } = receipt;
  }

  /// Rewrites `current_version` on an existing `BurnReceipt` to
  /// simulate the "phase-1@vN, phase-2@vN+1" migration-window scenario
  /// end-to-end without needing two published package addresses.
  #[test_only]
  public fun set_current_version_for_testing<T>(receipt: &mut BurnReceipt<T>, version: u64) {
    receipt.current_version = version;
  }
}
