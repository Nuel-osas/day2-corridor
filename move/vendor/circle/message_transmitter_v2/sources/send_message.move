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

/// Module: send_message
/// Contains public functions for sending cross-chain messages.
///
/// Note on upgrades: It is recommended to call all of these public 
/// methods from PTBs rather than directly from other packages. 
/// These functions are version gated, so if the package is upgraded, 
/// the upgraded package must be called. In most cases, we will provide 
/// a migration period where both package versions are callable for a
/// period of time to avoid breaking all callers immediately.
module message_transmitter_v2::send_message {
  // === Imports ===
  use sui::{
    event::emit,
  };
  use message_transmitter_v2::{
    auth::{auth_caller_identifier},
    message::{Self, Message},
    state::{State},
    version_control::{assert_object_version_is_compatible_with_package}
  };

  // === Errors ===
  const EPaused: u64 = 0;
  const EMessageBodySizeExceedsLimit: u64 = 1;
  const EInvalidRecipient: u64 = 2;
  const EInvalidDestinationDomain: u64 = 3;

  // === Events ===
  public struct MessageSent has copy, drop {
    message: vector<u8>
  }

  // === Public-Mutative Functions ===

  /// Sends a message to the destination domain and recipient.
  /// 
  /// Reverts if:
  /// - contract is paused
  /// - the Auth parameter is invalid
  /// - the message body size exceeds the limit
  /// - invalid (e.g. @0x0) recipient is given
  /// - destination_domain is the same as the local domain
  /// 
  /// Parameters:
  /// - send_message_ticket: a struct containing the necessary information to send a message created via create_send_message_ticket.
  public fun send_message<Auth: drop>(
    send_message_ticket: SendMessageTicket<Auth>,
    state: &State,
  ): Message {
    let SendMessageTicket { auth, destination_domain, recipient, destination_caller, min_finality_threshold, message_body } = send_message_ticket;
    send_message_impl(state, auth, destination_domain, recipient, message_body, destination_caller, min_finality_threshold)
  }

  // === Ticket Structs/Functions ===
  /// create_..._ticket functions below are non version-gated functions, intended to be 
  /// called directly from other packages to create ticket structs that can be passed into public version-gated functions 
  /// outside of the calling package in a PTB. This prevents dependent packages from needing to be updated after CCTP upgrades.
  public struct SendMessageTicket<Auth: drop> {
    auth: Auth,
    destination_domain: u32,
    recipient: address,
    destination_caller: address,
    min_finality_threshold: u32,
    message_body: vector<u8>,
  }

  public fun create_send_message_ticket<Auth: drop>(
    auth: Auth,
    destination_domain: u32,
    recipient: address,
    destination_caller: address,
    min_finality_threshold: u32,
    message_body: vector<u8>,
  ): SendMessageTicket<Auth> {
    SendMessageTicket { auth, destination_domain, recipient, destination_caller, min_finality_threshold, message_body }
  }

  // === Private Functions ===
  
  fun send_message_impl<Auth: drop>(
    state: &State,
    _auth: Auth,
    destination_domain: u32,
    recipient: address,
    message_body: vector<u8>,
    destination_caller: address,
    min_finality_threshold: u32
  ): Message {
    assert_object_version_is_compatible_with_package(state.compatible_versions());
    assert!(!state.paused(), EPaused);
    assert!(destination_domain != state.local_domain(), EInvalidDestinationDomain);

    let sender_identifier = auth_caller_identifier<Auth>();

    let message = message::new(
      state.message_version(),
      state.local_domain(),
      destination_domain,
      sender_identifier,
      recipient,
      destination_caller,
      min_finality_threshold,
      message_body
    );

    serialize_message_and_emit_event(message, state);

    message
  }

  /// Validates the message and emits a MessageSent event for the serialized message.
  fun serialize_message_and_emit_event(    
    message: Message,
    state: &State
  ) {
    assert!(message.message_body().length() <= state.max_message_body_size(), EMessageBodySizeExceedsLimit);
    assert!(message.recipient() != @0x0, EInvalidRecipient);

    let serialized_message = message.serialize();
    emit(MessageSent{ message: serialized_message });
  }

  // === Test Functions ===

  #[test_only]
  public fun create_message_sent_event(
    version: u32,
    source_domain: u32,
    destination_domain: u32,
    sender: address,
    recipient: address,
    destination_caller: address,
    min_finality_threshold: u32,
    message_body: vector<u8>
  ): MessageSent {
    let message = message::new_for_testing(version, source_domain, destination_domain, sender, recipient, destination_caller, min_finality_threshold, message_body);
    MessageSent { message: message.serialize() }
  }
}

// === Tests ===
