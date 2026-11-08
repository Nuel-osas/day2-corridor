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

/// Module: receive_message
/// Contains public functions for receiving cross-chain messages.
///
/// Note on upgrades: If interacting with this module from other packages, it
/// is recommended to call the receive_message_with_package_auth and stamp_receipt 
/// methods from a PTB rather than directly from dependent packages. These functions  
/// are version gated, so if this package is upgraded, the upgraded package must be called. 
module message_transmitter_v2::receive_message {

  // === Imports ===
  use sui::{
    event::emit,
  };
  use message_transmitter_v2::{
    attestation::{Self},
    auth::auth_caller_identifier,
    message::{Self},
    state::{State},
    version_control::{Self, assert_object_version_is_compatible_with_package}
  };

  // === Errors ===
  const EPaused: u64 = 0;
  const EInvalidDestinationCaller: u64 = 1;
  const EInvalidDestinationDomain: u64 = 2;
  const EInvalidMessageVersion: u64 = 3;
  const ENonceAlreadyUsed: u64 = 4;
  const ERecipientNotAuth: u64 = 5;
  const EInvalidReceiptVersion: u64 = 6;

  // === Structs ===
  public struct Receipt {
    caller: address,
    recipient: address,
    source_domain: u32,
    sender: address,
    nonce: u256,
    finality_threshold_executed: u32,
    message_body: vector<u8>,
    // Used to ensure all receipt calls are made on the same version of the package as receive_message.
    current_version: u64
  }

  public struct StampedReceipt {
    receipt: Receipt
  }

  // === Events ===
  public struct MessageReceived has copy, drop {
    caller: address,
    source_domain: u32,
    nonce: u256,
    sender: address,
    finality_threshold_executed: u32,
    message_body: vector<u8>
  }

  // === Public-Mutative Functions ===

  /// Receives a message. Messages with a given nonce can only be received once. Nonces are globally unique across source domains.
  /// Intended to be called directly from an EOA when a package destination_caller is not specified on the message.
  /// Please use receive_message_with_package_auth if a package destination_caller is specified.
  /// 
  /// This function returns a `Receipt` struct ([Hot Potato](https://medium.com/@borispovod/move-hot-potato-pattern-bbc48a48d93c))
  /// after validating attestation and marking the nonce as used.
  /// In order to destroy the Receipt and complete the message, `stamp_receipt()` must be called with the receipt and 
  /// an authenticator struct (see the token_messenger_minter::receive_message_authenticator module for reference) and then 
  /// `complete_receive_message()` must be called with the Stamped Receipt to emit the `MessageReceived` event and complete the message. 
  /// It is recommended to call stamp_receipt and complete_receive_message functions from PTBs if possible to prevent breaking packages when an upgrade occurs. 
  /// create_stamp_receipt_ticket is safe to be called from a package as it is not version-gated.
  /// Integrating handle_receive_message calls should only allow Receipt parameters (not StampedReceipt) and should call create_stamp_receipt_ticket in the 
  /// package to prevent message replays.
  /// The Receipt/stamp pattern is used to enforce atomicity and ensure the intended receiver contract is called. 
  /// Example (in a PTB):
  /// ```
  ///     let receipt = message_transmitter_v2::receive_message(message, attestation, &mut state);
  ///     let stamp_receipt_ticket = receiver_package::handle_receive_message(receipt);
  ///     let stamped_receipt = message_transmitter_v2::stamp_receipt(stamp_receipt_ticket, &state);
  ///     message_transmitter_v2::complete_receive_message(stamped_receipt, &state);
  /// ```
  ///
  /// Reverts if:
  /// - contract is paused
  /// - the message format is invalid
  /// - the attestation is invalid
  /// - the destination domain of the message does not match the local domain
  /// - the destination caller of the message is set and does not match the caller
  /// - the message version does not match the local message version
  /// - a message with the given nonce has already been received
  /// 
  /// Parameters:
  /// - message: a message, in bytes, corresponding with the format defined in the `message_transmitter_v2::message` module.
  /// - attestation: a valid attestation consisting of concatenated 65-byte signature(s) of exactly `signature_threshold` signatures, in
  ///                increasing order of attester address.
  /// - state: State shared object for the MessageTransmitter package.
  public fun receive_message(message: vector<u8>, attestation: vector<u8>, state: &mut State, ctx: &mut TxContext): Receipt {
    let sender = ctx.sender();
    receive_message_shared(message, attestation, sender, state)
  }

  /// The same as receive_message, except intended to be used by a dependent package when a package as destination_caller
  /// is specified in order to run an atomic operation. This function is version-gated and should be called from a PTB 
  /// to prevent breaking changes when an upgrade occurs. 
  /// create_receive_message_ticket is safe to be called directly from a package (not version-gated).
  /// 
  /// This function uses a ReceiveMessageTicket for parameters so that the calling package can 
  /// call create_receive_message_ticket (not version-gated) from their package with parameters, and call 
  /// receive_message_with_package_auth (version-gated) from a PTB so packages don't have to be updated
  /// during CCTP package upgrades. ReceiveMessageTicket also requires an Auth parameter. This is required  
  /// whenever a package as assigned as a destination_caller. destination_caller address should be set to the
  /// auth identifier returned from the auth_caller_identifier function with the package's Auth struct.
  /// Any struct that implements the drop trait can be used as an authenticator, but it is recommended to 
  /// use a dedicated auth struct. Calling contracts should be careful to not expose these objects to the 
  /// public or else messages intended for their package could be skipped.
  /// 
  /// Example (in a PTB):
  /// ```
  ///     let receive_msg_ticket = your_package::prepare_receive_message_ticket(message, attestation);
  ///     let receipt = message_transmitter_v2::receive_message_with_package_auth(receive_msg_ticket, &mut state);
  ///     // create_stamp_receipt_ticket is called from inside receiver_package::handle_receive_message()
  ///     let (message_body, stamp_receipt_ticket) = receiver_package::handle_receive_message(receipt);
  ///     let stamped_receipt = message_transmitter_v2::stamp_receipt(stamp_receipt_ticket, &state);
  ///     message_transmitter_v2::complete_receive_message(stamped_receipt, &state);
  /// ```
  /// 
  /// Parameters:
  /// - receive_message_ticket: a ticket struct containing the message, attestation, and an authenticator struct.
  /// - state: State shared object for the MessageTransmitter package.
  public fun receive_message_with_package_auth<Auth: drop>(receive_message_ticket: ReceiveMessageTicket<Auth>, state: &mut State): Receipt {
    let ReceiveMessageTicket { message, attestation, auth: _auth } = receive_message_ticket;
    let sender_identifier = auth_caller_identifier<Auth>();
    receive_message_shared(message, attestation, sender_identifier, state)
  }

  /// Stamps a receipt after verifying the intended package acknowledged the message (through the Auth struct) by
  /// returning a StampedReceipt struct that can be used to complete the message via complete_receive_message.
  /// 
  /// This function is version-gated and should be called from a PTB to prevent breaking changes when an upgrade occurs.
  /// create_stamp_receipt_ticket is safe to be called directly from a package (not version-gated), and its returned ticket 
  /// struct can be passed into stamp_receipt() in a PTB.
  /// 
  /// Reverts if:
  /// - an invalid auth module is provided
  /// 
  /// Parameters:
  /// - stamp_receipt_ticket: ticket struct created by create_stamp_receipt_ticket() with the receipt and auth struct
  public fun stamp_receipt<Auth: drop>(stamp_receipt_ticket: StampReceiptTicket<Auth>, state: &State): StampedReceipt {
    let StampReceiptTicket { receipt, auth: _auth } = stamp_receipt_ticket;
    assert_object_version_is_compatible_with_package(state.compatible_versions());
    assert_valid_receipt_version(&receipt);
    assert!(receipt.recipient == auth_caller_identifier<Auth>(), ERecipientNotAuth);

    StampedReceipt { receipt }
  }

  /// Emits `MessageReceived` event for a stamped receipt and destroys the receipt.
  /// Cannot be called without a StampedReceipt (returned from stamp_receipt).
  /// 
  /// Parameters:
  /// - stamped_receipt: a stamped receipt initially created from a receive_message call and verified in a stamp_receipt call
  public fun complete_receive_message(stamped_receipt: StampedReceipt, state: &State) {
    assert_object_version_is_compatible_with_package(state.compatible_versions());
    assert_valid_receipt_version(stamped_receipt.receipt());

    emit(MessageReceived {
      caller: stamped_receipt.receipt.caller,
      source_domain: stamped_receipt.receipt.source_domain,
      nonce: stamped_receipt.receipt.nonce,
      sender: stamped_receipt.receipt.sender,
      finality_threshold_executed: stamped_receipt.receipt.finality_threshold_executed,
      message_body: stamped_receipt.receipt.message_body
    });

    stamped_receipt.destroy_receipt();
  }

  /// Fetch the sender for a receipt.
  public fun sender(
    receipt: &Receipt
  ): address {
    receipt.sender
  }

  /// Fetch the source_domain for a receipt.
  public fun source_domain(
    receipt: &Receipt
  ): u32 {
    receipt.source_domain
  }

  /// Fetch the message_body for a receipt.
  public fun message_body(
    receipt: &Receipt
  ): &vector<u8> {
    &receipt.message_body
  }

  /// Fetch the current_version for a receipt.
  public fun current_version(
    receipt: &Receipt
  ): u64 {
    receipt.current_version
  }

  // Fetch a reference to a receipt for a stamped receipt.
  public fun receipt(
    stamped_receipt: &StampedReceipt
  ): &Receipt {
    &stamped_receipt.receipt
  }

  /// Fetch the nonce for a receipt.
  public fun nonce(
    receipt: &Receipt
  ): u256 {
    receipt.nonce
  }

  /// Fetch the finality_threshold_executed for a receipt.
  public fun finality_threshold_executed(
    receipt: &Receipt
  ): u32 {
    receipt.finality_threshold_executed
  }

  /// Fetch the caller for a receipt.
  public fun caller(
    receipt: &Receipt
  ): address {
    receipt.caller
  }

  /// Fetch the recipient for a receipt.
  public fun recipient(
    receipt: &Receipt
  ): address {
    receipt.recipient
  }

  // === Ticket Structs/Functions ===
  /// create_receive_message_ticket and create_stamp_receipt_ticket are non version-gated functions, intended to be 
  /// called directly from other packages to create ticket structs that can be passed into public version-gated functions 
  /// outside of the calling package in a PTB. This prevents dependent packages from needing to be updated after CCTP upgrades.
  public struct ReceiveMessageTicket<Auth: drop> {
    auth: Auth,
    message: vector<u8>, 
    attestation: vector<u8>
  }

  /// Not version-gated so it can be safely called from a dependent package,
  /// and then passed to receive_message_with_package_auth (version-gated) from a PTB.
  /// See receive_message for parameter information.
  public fun create_receive_message_ticket<Auth: drop>(auth: Auth, message: vector<u8>, attestation: vector<u8>): ReceiveMessageTicket<Auth> {
    ReceiveMessageTicket {
      auth,
      message,
      attestation
    }
  }

  public struct StampReceiptTicket<Auth: drop> {
    auth: Auth,
    receipt: Receipt
  }

  /// Not version-gated so it can be safely called from a dependent package,
  /// and then passed to stamp_receipt (version-gated) from a PTB.
  public fun create_stamp_receipt_ticket<Auth: drop>(auth: Auth, receipt: Receipt): StampReceiptTicket<Auth> {
    StampReceiptTicket {
      auth,
      receipt
    }
  }

  // === Private Functions ===

  fun receive_message_shared(message: vector<u8>, attestation: vector<u8>, sender: address, state: &mut State): Receipt {
    assert_object_version_is_compatible_with_package(state.compatible_versions());
    assert!(!state.paused(), EPaused);

    let message_struct = message::from_bytes(&message);
    attestation::verify_attestation_signatures(message, attestation, state);

    // Validate destination domain
    let destination_domain = message_struct.destination_domain();
    assert!(destination_domain == state.local_domain(), EInvalidDestinationDomain);

    // Validate destination caller
    let destination_caller = message_struct.destination_caller();
    assert!(
      destination_caller == @0x0 || destination_caller == sender,
      EInvalidDestinationCaller
    );

    // Validate message version
    let message_version = message_struct.version();
    assert!(message_version == state.message_version(), EInvalidMessageVersion);

    let source_domain = message_struct.source_domain();
    let nonce = message_struct.nonce();
    assert!(!state.is_nonce_used(nonce), ENonceAlreadyUsed);
    state.mark_nonce_used(nonce);

    // Return unstamped receipt
    Receipt {
      caller: sender,
      recipient: message_struct.recipient(),
      source_domain,
      sender: message_struct.sender(),
      nonce,
      finality_threshold_executed: message_struct.finality_threshold_executed(),
      message_body: message_struct.message_body(),
      current_version: version_control::current_version()
    }
  }

  /// Asserts that the current package version matches the version stored on the Receipt. 
  /// This prevents receipt calls from being called on different package versions than receive_message 
  /// while a migration is in progress.
  fun assert_valid_receipt_version(receipt: &Receipt) {
    assert!(receipt.current_version() == version_control::current_version(), EInvalidReceiptVersion);
  }

  /// Destroys a stamped receipt (and its inner receipt) once it is no
  /// longer needed in complete_receive_message.
  fun destroy_receipt(stamped_receipt: StampedReceipt) {
    let StampedReceipt { 
      receipt 
    } = stamped_receipt;

    let Receipt {
      caller: _,
      recipient: _,
      source_domain: _,
      sender: _,
      nonce: _,
      finality_threshold_executed: _,
      message_body: _,
      current_version: _
    } = receipt;
  }
  
  // === Test Functions ===
  #[test_only] use std::unit_test::{assert_eq};
  
  #[test_only]
  public fun create_receipt(
    caller: address,
    recipient: address,
    source_domain: u32,
    sender: address,
    nonce: u256,
    finality_threshold_executed: u32,
    message_body: vector<u8>,
    current_version: u64
  ): Receipt {
    Receipt {
      caller,
      recipient,
      source_domain,
      sender,
      nonce,
      finality_threshold_executed,
      message_body,
      current_version
    }
  }

  #[test_only]
  public fun create_stamped_receipt(receipt: Receipt): StampedReceipt { 
    StampedReceipt {
      receipt
    }
  }

  #[test_only]
  public fun assert_receipts_eq(
    given_receipt: &Receipt,
    expected_receipt: &Receipt
  ) {
    assert_eq!(given_receipt.caller(), expected_receipt.caller());
    assert_eq!(given_receipt.recipient(), expected_receipt.recipient());
    assert_eq!(given_receipt.source_domain(), expected_receipt.source_domain());
    assert_eq!(given_receipt.sender(), expected_receipt.sender());
    assert_eq!(given_receipt.nonce(), expected_receipt.nonce());
    assert_eq!(given_receipt.finality_threshold_executed(), expected_receipt.finality_threshold_executed());
    assert_eq!(*given_receipt.message_body(), *expected_receipt.message_body());
  }

  #[test_only]
  public fun create_message_received_event(
    caller: address,
    source_domain: u32,
    nonce: u256,
    sender: address,
    finality_threshold_executed: u32,
    message_body: vector<u8>
  ): MessageReceived {
    MessageReceived {
      caller,
      source_domain,
      nonce,
      sender,
      finality_threshold_executed,
      message_body
    }
  }
}

// === Tests ===
