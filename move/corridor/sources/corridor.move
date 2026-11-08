// Copyright (c) 2026 SuiHub Lagos
// SPDX-License-Identifier: Apache-2.0

/// Corridor: a USDC bridge out of Sui that charges its fee on chain.
///
/// `send` measures the coin it is given, moves the fee into the corridor's vault and
/// hands the rest to Circle's CCTP V2 as a package-auth burn ticket. CCTP records
/// keccak256 of the `CorridorAuth` type name as the message sender, so a relayer on
/// the destination chain can check that a transfer came through Corridor and paid.
/// The client PTB then calls TokenMessengerMinterV2 `deposit_for_burn_with_package_auth`,
/// the USDC handler's `burn` and `complete_burn` with the ticket, in the same transaction.
///
/// ### Key Features:
///
/// - Fee in basis points with a floor, taken from the coin itself, never from a claimed amount
/// - Anyone can open a corridor for any coin type CCTP accepts, with their own fee and relayer
/// - The relayer, when set, is the CCTP destination caller: only it can mint on the destination
/// - Fees accrue in the corridor's vault until the admin withdraws them
///
/// ### State Machine:
///
/// Open ⇄ Paused
module corridor::corridor;

use sui::balance::{Self, Balance};
use sui::coin::Coin;
use sui::event::emit;

use token_messenger_minter_v2::deposit_for_burn::{Self, DepositForBurnWithPackageAuthTicket};

// === Structs ===

public struct Corridor<phantom T> has key {
    id: UID,
    state: CorridorState,
    fee_bps: u64,
    min_fee: u64,
    relayer: address,
    vault: Balance<T>,
}

public struct CorridorAdminCap<phantom T> has key, store {
    id: UID,
    corridor_id: ID,
}

/// The package's identity inside CCTP. Only this module can construct it.
public struct CorridorAuth has drop {}

// === Enums ===

public enum CorridorState has copy, drop, store {
    Open,
    Paused,
}

// === Events ===

public struct CorridorOpenedEvent<phantom T> has copy, drop {
    corridor_id: ID,
    fee_bps: u64,
    min_fee: u64,
    relayer: address,
}

public struct TransferSentEvent<phantom T> has copy, drop {
    corridor_id: ID,
    sender: address,
    gross: u64,
    fee: u64,
    net: u64,
    destination_domain: u32,
    mint_recipient: address,
    destination_caller: address,
    circle_max_fee: u64,
    min_finality_threshold: u32,
}

public struct SettingsChangedEvent<phantom T> has copy, drop {
    corridor_id: ID,
    fee_bps: u64,
    min_fee: u64,
    relayer: address,
    paused: bool,
}

public struct FeesWithdrawnEvent<phantom T> has copy, drop {
    corridor_id: ID,
    amount: u64,
    vault_after: u64,
}

// === Constants ===

const BPS: u64 = 10_000;
/// Five percent. A typo in an admin call cannot turn the corridor into a trap.
const MAX_FEE_BPS: u64 = 500;

// === Errors ===
// State errors (10-19)
const EPaused: u64 = 10;

// Validation errors (20-29)
const EFeeTooHigh: u64 = 20;
const EAmountNotAboveFee: u64 = 21;
const EZeroRecipient: u64 = 22;
const EWrongCap: u64 = 23;

// Constraint errors (30-39)
const EVaultTooSmall: u64 = 30;

// === Public Functions ===

/// Opens and shares a corridor for coin type `T`. `relayer` is the 32-byte destination
/// caller (an EVM address left-padded with zeros), or @0x0 to let anyone mint.
public fun open<T>(
    fee_bps: u64,
    min_fee: u64,
    relayer: address,
    ctx: &mut TxContext,
): CorridorAdminCap<T> {
    assert!(fee_bps <= MAX_FEE_BPS, EFeeTooHigh);
    let corridor = Corridor<T> {
        id: object::new(ctx),
        state: CorridorState::Open,
        fee_bps,
        min_fee,
        relayer,
        vault: balance::zero(),
    };
    let corridor_id = corridor.id.to_inner();
    let cap = CorridorAdminCap<T> { id: object::new(ctx), corridor_id };
    emit(CorridorOpenedEvent<T> { corridor_id, fee_bps, min_fee, relayer });
    transfer::share_object(corridor);
    cap
}

/// Takes the fee, then returns Circle's burn ticket for the rest. The ticket is a hot
/// potato: the same PTB must pass it to `deposit_for_burn_with_package_auth`.
public fun send<T: drop>(
    self: &mut Corridor<T>,
    mut coin: Coin<T>,
    destination_domain: u32,
    mint_recipient: address,
    circle_max_fee: u64,
    min_finality_threshold: u32,
    ctx: &mut TxContext,
): DepositForBurnWithPackageAuthTicket<T, CorridorAuth> {
    assert!(self.is_open(), EPaused);
    assert!(mint_recipient != @0x0, EZeroRecipient);
    let gross = coin.value();
    let fee = self.fee_for(gross);
    assert!(gross > fee, EAmountNotAboveFee);
    self.vault.join(coin.split(fee, ctx).into_balance());
    let net = coin.value();
    let destination_caller = self.relayer;
    emit(TransferSentEvent<T> {
        corridor_id: self.id.to_inner(),
        sender: ctx.sender(),
        gross,
        fee,
        net,
        destination_domain,
        mint_recipient,
        destination_caller,
        circle_max_fee,
        min_finality_threshold,
    });
    deposit_for_burn::create_deposit_for_burn_with_package_auth_ticket(
        coin,
        destination_domain,
        mint_recipient,
        destination_caller,
        circle_max_fee as u256,
        min_finality_threshold,
        vector[],
        CorridorAuth {},
    )
}

public fun withdraw_fees<T>(
    self: &mut Corridor<T>,
    cap: &CorridorAdminCap<T>,
    amount: u64,
    ctx: &mut TxContext,
): Coin<T> {
    self.assert_cap(cap);
    assert!(amount <= self.vault.value(), EVaultTooSmall);
    let out = self.vault.split(amount).into_coin(ctx);
    emit(FeesWithdrawnEvent<T> {
        corridor_id: self.id.to_inner(),
        amount,
        vault_after: self.vault.value(),
    });
    out
}

public fun set_fee<T>(self: &mut Corridor<T>, cap: &CorridorAdminCap<T>, fee_bps: u64, min_fee: u64) {
    self.assert_cap(cap);
    assert!(fee_bps <= MAX_FEE_BPS, EFeeTooHigh);
    self.fee_bps = fee_bps;
    self.min_fee = min_fee;
    self.emit_settings();
}

public fun set_relayer<T>(self: &mut Corridor<T>, cap: &CorridorAdminCap<T>, relayer: address) {
    self.assert_cap(cap);
    self.relayer = relayer;
    self.emit_settings();
}

public fun pause<T>(self: &mut Corridor<T>, cap: &CorridorAdminCap<T>) {
    self.assert_cap(cap);
    self.state = CorridorState::Paused;
    self.emit_settings();
}

public fun resume<T>(self: &mut Corridor<T>, cap: &CorridorAdminCap<T>) {
    self.assert_cap(cap);
    self.state = CorridorState::Open;
    self.emit_settings();
}

// === View Functions ===

/// The fee for a transfer of `gross`: the larger of the basis-point fee and the floor.
public fun fee_for<T>(self: &Corridor<T>, gross: u64): u64 {
    let proportional = ((gross as u128) * (self.fee_bps as u128) / (BPS as u128)) as u64;
    proportional.max(self.min_fee)
}

public fun fee_bps<T>(self: &Corridor<T>): u64 { self.fee_bps }

public fun min_fee<T>(self: &Corridor<T>): u64 { self.min_fee }

public fun relayer<T>(self: &Corridor<T>): address { self.relayer }

public fun vault_value<T>(self: &Corridor<T>): u64 { self.vault.value() }

public fun corridor_id<T>(cap: &CorridorAdminCap<T>): ID { cap.corridor_id }

public fun is_open<T>(self: &Corridor<T>): bool {
    match (&self.state) {
        CorridorState::Open => true,
        CorridorState::Paused => false,
    }
}

// === Private Functions ===

fun assert_cap<T>(self: &Corridor<T>, cap: &CorridorAdminCap<T>) {
    assert!(cap.corridor_id == self.id.to_inner(), EWrongCap);
}

fun emit_settings<T>(self: &Corridor<T>) {
    emit(SettingsChangedEvent<T> {
        corridor_id: self.id.to_inner(),
        fee_bps: self.fee_bps,
        min_fee: self.min_fee,
        relayer: self.relayer,
        paused: !self.is_open(),
    });
}

// === Test Only ===

#[test_only]
public fun new_for_testing<T>(
    fee_bps: u64,
    min_fee: u64,
    relayer: address,
    ctx: &mut TxContext,
): (Corridor<T>, CorridorAdminCap<T>) {
    assert!(fee_bps <= MAX_FEE_BPS, EFeeTooHigh);
    let corridor = Corridor<T> {
        id: object::new(ctx),
        state: CorridorState::Open,
        fee_bps,
        min_fee,
        relayer,
        vault: balance::zero(),
    };
    let cap = CorridorAdminCap<T> { id: object::new(ctx), corridor_id: corridor.id.to_inner() };
    (corridor, cap)
}

#[test_only]
public fun max_fee_bps(): u64 { MAX_FEE_BPS }
