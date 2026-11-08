use proptest::prelude::*;

use phenotype_xdd_lib::cli::baseline::{epoch_to_ymdhms, now_iso};
use phenotype_xdd_lib::cli::time_utils::is_leap;

proptest! {
    #[test]
    fn epoch_to_ymdhms_year_always_ge_1970(secs in 0u64..=3_250_368_000_000u64) {
        let (year, _month, _day, _h, _m, _s) = epoch_to_ymdhms(secs);
        prop_assert!(year >= 1970, "year {} should be >= 1970", year);
    }

    #[test]
    fn epoch_to_ymdhms_month_always_1_to_12(secs in 0u64..=3_250_368_000_000u64) {
        let (_year, month, _day, _h, _m, _s) = epoch_to_ymdhms(secs);
        prop_assert!((1..=12).contains(&month), "month {} out of range", month);
    }

    #[test]
    fn epoch_to_ymdhms_day_always_1_to_31(secs in 0u64..=3_250_368_000_000u64) {
        let (_year, _month, day, _h, _m, _s) = epoch_to_ymdhms(secs);
        prop_assert!((1..=31).contains(&day), "day {} out of range", day);
    }

    #[test]
    fn epoch_to_ymdhms_hour_always_0_to_23(secs in 0u64..=3_250_368_000_000u64) {
        let (_year, _month, _day, hour, _m, _s) = epoch_to_ymdhms(secs);
        prop_assert!(hour <= 23, "hour {} out of range", hour);
    }

    #[test]
    fn epoch_to_ymdhms_min_always_0_to_59(secs in 0u64..=3_250_368_000_000u64) {
        let (_year, _month, _day, _hour, min, _s) = epoch_to_ymdhms(secs);
        prop_assert!(min <= 59, "min {} out of range", min);
    }

    #[test]
    fn epoch_to_ymdhms_sec_always_0_to_59(secs in 0u64..=3_250_368_000_000u64) {
        let (_year, _month, _day, _hour, _min, sec) = epoch_to_ymdhms(secs);
        prop_assert!(sec <= 59, "sec {} out of range", sec);
    }

    #[test]
    fn epoch_to_ymdhms_epoch_zero_is_1970_01_01(_secs in 0u64..1u64) {
        let (y, mo, d, h, mi, s) = epoch_to_ymdhms(0);
        prop_assert_eq!((y, mo, d, h, mi, s), (1970, 1, 1, 0, 0, 0));
    }
}

#[test]
fn is_leap_known_leap_years() {
    assert!(is_leap(2000), "2000 is divisible by 400");
    assert!(is_leap(2024), "2024 is divisible by 4 but not 100");
    assert!(is_leap(2028), "2028 is divisible by 4 but not 100");
    assert!(is_leap(1600), "1600 is divisible by 400");
}

#[test]
fn is_leap_known_non_leap_years() {
    assert!(!is_leap(1900), "1900 is divisible by 100 but not 400");
    assert!(!is_leap(2100), "2100 is divisible by 100 but not 400");
    assert!(!is_leap(2023), "2023 is not divisible by 4");
    assert!(!is_leap(2025), "2025 is not divisible by 4");
}

#[test]
fn is_leap_property_all_multiples_of_400_are_leap() {
    for y in (1600..=3200).step_by(400) {
        assert!(is_leap(y), "{y} should be leap (multiple of 400)");
    }
}

#[test]
fn is_leap_property_all_multiples_of_100_not_400_are_not_leap() {
    for y in (1700..=3100).step_by(100) {
        if y % 400 != 0 {
            assert!(!is_leap(y), "{y} should NOT be leap");
        }
    }
}

#[test]
fn now_iso_ends_with_z() {
    let ts = now_iso();
    assert!(
        ts.ends_with('Z'),
        "now_iso() should end with 'Z', got: {ts}"
    );
}

#[test]
fn now_iso_has_rfc3339_shape() {
    let ts = now_iso();
    // Expect format: YYYY-MM-DDTHH:MM:SSZ
    assert_eq!(ts.len(), 20, "expected 20 chars, got {}: {ts}", ts.len());
    assert_eq!(&ts[4..5], "-", "dash after year");
    assert_eq!(&ts[7..8], "-", "dash after month");
    assert_eq!(&ts[10..11], "T", "T separator");
    assert_eq!(&ts[13..14], ":", "colon after hour");
    assert_eq!(&ts[16..17], ":", "colon after minute");
    assert_eq!(&ts[19..20], "Z", "Z terminator");
}

#[test]
fn now_iso_year_reasonable() {
    let ts = now_iso();
    let year: i32 = ts[..4].parse().expect("first 4 chars should be a year");
    assert!(year >= 2024, "year should be >= 2024, got {year}");
    assert!(year <= 2100, "year should be <= 2100, got {year}");
}

#[test]
fn epoch_to_ymdhms_known_timestamps() {
    // 2000-01-01 00:00:00 UTC = 946684800
    let (y, mo, d, h, mi, s) = epoch_to_ymdhms(946_684_800);
    assert_eq!((y, mo, d, h, mi, s), (2000, 1, 1, 0, 0, 0));

    // 2024-06-15 12:30:45 UTC
    let secs = 1_718_454_645u64;
    let (y, mo, d, h, mi, s) = epoch_to_ymdhms(secs);
    assert_eq!((y, mo, d), (2024, 6, 15));
    assert_eq!((h, mi, s), (12, 30, 45));
}
