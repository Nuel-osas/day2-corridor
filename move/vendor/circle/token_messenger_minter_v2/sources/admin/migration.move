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

/// module: migration
/// Owner-driven package upgrade dance: start (add pending version),
/// abort (drop pending), complete (drop old).
module token_messenger_minter_v2::migration {
    // === Imports ===
    use std::u64::{min, max};
    use sui::event;
    use token_messenger_minter_v2::{
      state::State,
      version_control
    };

    // === Errors === 

    /// Migration related error codes, starting at 100.
    const ENotOwner: u64 = 0;
    const EMigrationStarted: u64 = 100;
    const EMigrationNotStarted: u64 = 101;
    const EObjectMigrated: u64 = 102;
    const ENotPendingVersion: u64 = 103;

    // === Events ===

    public struct MigrationStarted has copy, drop {
        compatible_versions: vector<u64>
    }

    public struct MigrationAborted has copy, drop {
        compatible_versions: vector<u64>
    }

    public struct MigrationCompleted has copy, drop {
        compatible_versions: vector<u64>
    }

    // === Public functions ===

    /// Add the current package version to the compatible set.
    entry fun start_migration(state: &mut State, ctx: &TxContext) {
        assert!(state.roles().owner() == ctx.sender(), ENotOwner);
        assert!(state.compatible_versions().length() == 1, EMigrationStarted);

        let active_version = state.compatible_versions().keys()[0];
        assert!(active_version < version_control::current_version(), EObjectMigrated);

        state.add_compatible_version(version_control::current_version());
        
        event::emit(MigrationStarted {
            compatible_versions: *state.compatible_versions().keys()
        });
    }

    /// Drop the pending version, reverting to only the previous one.
    entry fun abort_migration(state: &mut State, ctx: &TxContext) {
        assert!(state.roles().owner() == ctx.sender(), ENotOwner);
        assert!(state.compatible_versions().length() == 2, EMigrationNotStarted);

        let pending_version = max(
            state.compatible_versions().keys()[0],
            state.compatible_versions().keys()[1]
        );
        assert!(pending_version == version_control::current_version(), ENotPendingVersion);

        state.remove_compatible_version(pending_version);

        event::emit(MigrationAborted {
            compatible_versions: *state.compatible_versions().keys()
        });
    }

    /// Drop the previous version; only the current one remains compatible.
    entry fun complete_migration(state: &mut State, ctx: &TxContext) {
        assert!(state.roles().owner() == ctx.sender(), ENotOwner);
        assert!(state.compatible_versions().length() == 2, EMigrationNotStarted);

        let (version_a, version_b) = (
          state.compatible_versions().keys()[0], 
          state.compatible_versions().keys()[1]
        );
        let (active_version, pending_version) = (
          min(version_a, version_b), 
          max(version_a, version_b)
        );

        assert!(pending_version == version_control::current_version(), ENotPendingVersion);

        state.remove_compatible_version(active_version);

        event::emit(MigrationCompleted {
            compatible_versions: *state.compatible_versions().keys()
        });
    }

    // === Test-Functions ===

    #[test_only]
    public(package) fun create_migration_started_event(compatible_versions: vector<u64>): MigrationStarted {
        MigrationStarted { compatible_versions }
    }

    #[test_only]
    public(package) fun create_migration_aborted_event(compatible_versions: vector<u64>): MigrationAborted {
        MigrationAborted { compatible_versions }
    }

    #[test_only]
    public(package) fun create_migration_completed_event(compatible_versions: vector<u64>): MigrationCompleted {
        MigrationCompleted { compatible_versions }
    }
}
