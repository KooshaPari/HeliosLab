use super::*;

#[test]
fn config_round_trip_links_and_runs() {
    let config = PhenoConfig::new(":memory:".to_string(), "smoke".to_string()).unwrap();

    config
        .set(
            "theme".to_string(),
            "dark".to_string(),
            "string".to_string(),
        )
        .unwrap();

    assert_eq!(
        config.get("theme".to_string()).unwrap(),
        (
            "theme".to_string(),
            "dark".to_string(),
            "string".to_string(),
        )
    );
}
