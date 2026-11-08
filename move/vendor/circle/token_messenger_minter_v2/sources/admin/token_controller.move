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

/// Module: token_controller
/// Admin surface for local/remote token pairs and per-token burn
/// limits. `T` is any `T: drop` witness. After the handler
/// decoupling, this module has no stablecoin dependency; production
/// `T` is currently a
/// [stablecoin](https://github.com/circlefin/stablecoin-sui/tree/master/packages/stablecoin)
/// coin witness, but the config surface is stablecoin-agnostic.
module token_messenger_minter_v2::token_controller {
    // === Imports ===
    use sui::event::emit;
    use token_messenger_minter_v2::{
        state::{State},
        token_utils,
        version_control::{assert_object_version_is_compatible_with_package}
    };

    // === Errors ===
    // Numbering gaps at 4, 5, 6 (`EMintCap*`) retired with the
    // handler decoupling; do not reuse.
    const ENotTokenController: u64 = 0;
    const EEmptyAddress: u64 = 1;
    const ETokenPairAlreadyLinked: u64 = 2;
    const ETokenPairNotLinked: u64 = 3;
    /// `T` does not match the local token currently linked to the
    /// given `(remote_domain, remote_token)` pair. Mirrors
    /// `handle_receive_message::EInvalidTokenType`.
    const EInvalidTokenType: u64 = 7;
    // Code 8 is reserved and must not be reused. Setting the limit to 0 is the
    // supported way to disable burns for a token; see
    // `set_max_burn_amount_per_message` below.

    // === Events ===
    public struct SetBurnLimitPerMessage has copy, drop {
        token: address,
        burn_limit_per_message: u64,
    }

    public struct TokenPairLinked has copy, drop {
        local_token: address,
        remote_domain: u32,
        remote_token: address,
    }

    public struct TokenPairUnlinked has copy, drop {
        local_token: address,
        remote_domain: u32,
        remote_token: address,
    }

    // === Admin Functions ===

    /// Sets (or overwrites) the per-message burn limit for `T`. Passing 0
    /// disables all future burns for `T`: `deposit_for_burn` reads the limit
    /// via `safe_get_burn_limit` and asserts `burn_limit >= amount`, and
    /// amounts are always > 0 (enforced by `EZeroAmount`), so a stored 0
    /// rejects every burn with `EBurnLimitExceeded`. This gives the token
    /// controller a way to pause burns for a specific `T` without unlinking
    /// remote pairs or deregistering the handler; call again with a positive
    /// value to re-enable. Only affects burns; existing minted tokens remain
    /// mintable if the limit is later reduced.
    ///
    /// Note the distinction between "limit is 0" (map entry present, burns
    /// intentionally disabled -> `EBurnLimitExceeded`) and "limit not set"
    /// (map entry absent, likely a misconfiguration -> `EMissingBurnLimit`).
    entry fun set_max_burn_amount_per_message<T: drop>(burn_limit_per_message: u64, state: &mut State, ctx: &TxContext) {
      assert_object_version_is_compatible_with_package(state.compatible_versions());
      verify_token_controller(state, ctx);

      let token_id = token_utils::calculate_token_id<T>();
      if (state.burn_limit_for_token_id_exists(token_id)) {
        state.remove_burn_limit(token_id);
      };

      state.add_burn_limit(token_id, burn_limit_per_message);
      emit(SetBurnLimitPerMessage {token: token_id, burn_limit_per_message});
    }

    /// Links `(remote_domain, remote_token)` to `T`'s local token id.
    /// Many remote tokens can map to one local; each remote maps to
    /// only one local. Does NOT enable the local token; call
    /// `set_max_burn_amount_per_message` for that. `remote_token` is
    /// the 32-byte hex address on the remote chain.
    entry fun link_token_pair<T: drop>(
        remote_domain: u32, 
        remote_token: address, 
        state: &mut State, 
        ctx: &TxContext
    ) {
      assert_object_version_is_compatible_with_package(state.compatible_versions());
      verify_token_controller(state, ctx);
      assert!(remote_token != @0x0, EEmptyAddress);
      assert!(!state.local_token_from_remote_token_exists(remote_domain, remote_token), ETokenPairAlreadyLinked);

      let local_token_id = token_utils::calculate_token_id<T>();
      state.add_local_token_for_remote_token(remote_domain, remote_token, local_token_id);
      emit(TokenPairLinked {local_token: local_token_id, remote_domain, remote_token});
    }

    /// Unlinks `(remote_domain, remote_token)` from its local token.
    /// `T` must be the local token the pair is currently linked to;
    /// a mismatch aborts with `EInvalidTokenType` and unlinks nothing.
    entry fun unlink_token_pair<T: drop>(
        remote_domain: u32, 
        remote_token: address, 
        state: &mut State, 
        ctx: &TxContext
    ) {
      assert_object_version_is_compatible_with_package(state.compatible_versions());
      verify_token_controller(state, ctx);
      assert!(remote_token != @0x0, EEmptyAddress);
      assert!(state.local_token_from_remote_token_exists(remote_domain, remote_token), ETokenPairNotLinked);
      let local_token_id = token_utils::calculate_token_id<T>();
      assert!(local_token_id == state.local_token_from_remote_token(remote_domain, remote_token), EInvalidTokenType);
      state.remove_local_token_for_remote_token(remote_domain, remote_token);
      emit(TokenPairUnlinked {local_token: local_token_id, remote_domain, remote_token});
    }

    // === Private Functions ===
    fun verify_token_controller(state: &State, ctx: &TxContext) {
      assert!(ctx.sender() == state.roles().token_controller(), ENotTokenController);
    }

    #[test_only]
    public fun create_set_burn_limit_per_message_event(token: address, burn_limit_per_message: u64): SetBurnLimitPerMessage {
        SetBurnLimitPerMessage {token, burn_limit_per_message}
    }

    #[test_only]
    public fun create_token_pair_linked_event(local_token: address, remote_domain: u32, remote_token: address): TokenPairLinked {
        TokenPairLinked {local_token, remote_domain, remote_token}
    }

    #[test_only]
    public fun create_token_pair_unlinked_event(local_token: address, remote_domain: u32, remote_token: address): TokenPairUnlinked {
        TokenPairUnlinked {local_token, remote_domain, remote_token}
    }
}
