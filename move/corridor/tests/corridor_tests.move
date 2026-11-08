#[test_only]
module corridor::corridor_tests;

use std::unit_test::{assert_eq, destroy};
use sui::coin;

use corridor::corridor::{Self, Corridor, CorridorAdminCap};

public struct USDC has drop {}

const RELAYER: address = @0x000000000000000000000000D997E05Bcd175b43Cf9F28c007Dd2faefc1617cd;
const RECIPIENT: address = @0x000000000000000000000000be7b3f9a7f165f043a581b64e82751013ceb3a6d;
const BASE_SEPOLIA: u32 = 6;

fun setup(ctx: &mut TxContext): (Corridor<USDC>, CorridorAdminCap<USDC>) {
    // 0.3 percent with a 0.01 USDC floor
    corridor::new_for_testing<USDC>(30, 10_000, RELAYER, ctx)
}

#[test]
fun fee_uses_floor_for_small_transfers() {
    let ctx = &mut tx_context::dummy();
    let (c, cap) = setup(ctx);
    assert_eq!(c.fee_for(1_000_000), 10_000);
    assert_eq!(c.fee_for(10_000_000), 30_000);
    destroy(c);
    destroy(cap);
}

#[test]
fun send_moves_fee_to_vault_and_returns_ticket() {
    let ctx = &mut tx_context::dummy();
    let (mut c, cap) = setup(ctx);
    let usdc = coin::mint_for_testing<USDC>(10_000_000, ctx);
    let ticket = c.send(usdc, BASE_SEPOLIA, RECIPIENT, 0, 2000, ctx);
    assert_eq!(c.vault_value(), 30_000);
    let fees = c.withdraw_fees(&cap, 30_000, ctx);
    assert_eq!(fees.value(), 30_000);
    assert_eq!(c.vault_value(), 0);
    destroy(ticket);
    destroy(fees);
    destroy(c);
    destroy(cap);
}

#[test]
fun max_fee_bps_accepted() {
    let ctx = &mut tx_context::dummy();
    let (mut c, cap) = setup(ctx);
    c.set_fee(&cap, corridor::max_fee_bps(), 0);
    assert_eq!(c.fee_bps(), corridor::max_fee_bps());
    destroy(c);
    destroy(cap);
}

#[test, expected_failure(abort_code = corridor::EFeeTooHigh)]
fun fee_above_ceiling_aborts() {
    let ctx = &mut tx_context::dummy();
    let (mut c, cap) = setup(ctx);
    c.set_fee(&cap, corridor::max_fee_bps() + 1, 0);
    abort 0
}

#[test, expected_failure(abort_code = corridor::EAmountNotAboveFee)]
fun amount_equal_to_fee_aborts() {
    let ctx = &mut tx_context::dummy();
    let (mut c, _cap) = setup(ctx);
    let usdc = coin::mint_for_testing<USDC>(10_000, ctx);
    let _ticket = c.send(usdc, BASE_SEPOLIA, RECIPIENT, 0, 2000, ctx);
    abort 0
}

#[test, expected_failure(abort_code = corridor::EZeroRecipient)]
fun zero_recipient_aborts() {
    let ctx = &mut tx_context::dummy();
    let (mut c, _cap) = setup(ctx);
    let usdc = coin::mint_for_testing<USDC>(1_000_000, ctx);
    let _ticket = c.send(usdc, BASE_SEPOLIA, @0x0, 0, 2000, ctx);
    abort 0
}

#[test, expected_failure(abort_code = corridor::EPaused)]
fun paused_corridor_refuses_sends() {
    let ctx = &mut tx_context::dummy();
    let (mut c, cap) = setup(ctx);
    c.pause(&cap);
    let usdc = coin::mint_for_testing<USDC>(1_000_000, ctx);
    let _ticket = c.send(usdc, BASE_SEPOLIA, RECIPIENT, 0, 2000, ctx);
    abort 0
}

#[test]
fun resume_reopens() {
    let ctx = &mut tx_context::dummy();
    let (mut c, cap) = setup(ctx);
    c.pause(&cap);
    assert!(!c.is_open());
    c.resume(&cap);
    assert!(c.is_open());
    destroy(c);
    destroy(cap);
}

#[test, expected_failure(abort_code = corridor::EWrongCap)]
fun other_corridors_cap_cannot_withdraw() {
    let ctx = &mut tx_context::dummy();
    let (mut c, _cap) = setup(ctx);
    let (_other, other_cap) = setup(ctx);
    let _coin = c.withdraw_fees(&other_cap, 0, ctx);
    abort 0
}

#[test, expected_failure(abort_code = corridor::EVaultTooSmall)]
fun withdraw_more_than_vault_aborts() {
    let ctx = &mut tx_context::dummy();
    let (mut c, cap) = setup(ctx);
    let _coin = c.withdraw_fees(&cap, 1, ctx);
    abort 0
}
