use std::time::{SystemTime, UNIX_EPOCH};

pub fn is_leap(y: i32) -> bool {
    (y % 4 == 0 && y % 100 != 0) || (y % 400 == 0)
}

pub fn epoch_to_ymdhms(secs: u64) -> (i32, u32, u32, u32, u32, u32) {
    let s = (secs % 60) as u32;
    let m = ((secs / 60) % 60) as u32;
    let h = ((secs / 3600) % 24) as u32;
    let mut days = (secs / 86_400) as i64;
    let mut year: i32 = 1970;
    loop {
        let leap = is_leap(year);
        let in_year = if leap { 366 } else { 365 };
        if days >= in_year {
            days -= in_year;
            year += 1;
        } else {
            break;
        }
    }
    let mdays = if is_leap(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };
    let mut month = 1u32;
    for &dm in &mdays {
        if days >= dm as i64 {
            days -= dm as i64;
            month += 1;
        } else {
            break;
        }
    }
    (year, month, (days as u32) + 1, h, m, s)
}

/// Minimal RFC3339-ish: YYYY-MM-DDTHH:MM:SSZ computed from the current wall
/// clock.  This was previously duplicated as `now_iso` / `now_iso_via_pub` /
/// `now_iso_string` in baseline.rs and report.rs.
pub fn now_iso() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let (y, mo, d, h, mi, s) = epoch_to_ymdhms(secs);
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, mi, s)
}
