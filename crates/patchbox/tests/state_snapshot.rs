// S7 s7-test-state-snapshot — golden JSON snapshot of GET /state.
//
// Uses `insta` crate: first run writes .snap, subsequent runs assert.
// Run: `cargo insta test -p patchbox`.

#[test]
fn placeholder() {
    // TODO: build default config, call state_to_value, insta::assert_json_snapshot!
}
