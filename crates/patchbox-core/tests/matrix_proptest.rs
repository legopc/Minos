use patchbox_core::config::{PatchboxConfig, StereoLinkConfig};
use patchbox_core::matrix::MatrixProcessor;
use proptest::prelude::*;

fn base_cfg(rx: usize, tx: usize) -> PatchboxConfig {
    let mut cfg = PatchboxConfig::default();
    cfg.rx_channels = rx;
    cfg.tx_channels = tx;
    cfg.sources = (0..rx).map(|i| format!("S{i}")).collect();
    cfg.zones = (0..tx).map(|i| format!("Z{i}")).collect();

    // session-only (serde skipped) fields: keep deterministic
    cfg.solo_channels.clear();
    cfg.xp_ramp_ms = 0.0;

    cfg.stereo_links.clear();
    cfg.normalize();
    cfg
}

fn gain_db_strategy() -> impl Strategy<Value = f32> {
    -200.0f32..200.0f32
}

proptest! {
    #![proptest_config(ProptestConfig {
        cases: 256,
        failure_persistence: None,
        .. ProptestConfig::default()
    })]

    #[test]
    fn prop_apply_crosspoint_idempotent(
        rx in 1usize..=64,
        tx in 1usize..=32,
        tx_raw in any::<u8>(),
        rx_raw in any::<u8>(),
        enabled in any::<bool>(),
        gain_db in gain_db_strategy(),
    ) {
        let tx_idx = (tx_raw as usize) % tx;
        let rx_idx = (rx_raw as usize) % rx;

        let mut cfg_once = base_cfg(rx, tx);
        cfg_once.apply_crosspoint(tx_idx, rx_idx, enabled, gain_db).unwrap();

        let mut cfg_twice = cfg_once.clone();
        cfg_twice.apply_crosspoint(tx_idx, rx_idx, enabled, gain_db).unwrap();

        prop_assert_eq!(cfg_once.matrix, cfg_twice.matrix);
        prop_assert_eq!(cfg_once.matrix_gain_db, cfg_twice.matrix_gain_db);
    }

    #[test]
    fn prop_commutative_unrelated_crosspoints(
        rx in 1usize..=64,
        tx in 2usize..=32,
        a_tx_raw in any::<u8>(),
        a_rx_raw in any::<u8>(),
        b_tx_raw in any::<u8>(),
        b_rx_raw in any::<u8>(),
        a_enabled in any::<bool>(),
        b_enabled in any::<bool>(),
        a_gain_db in gain_db_strategy(),
        b_gain_db in gain_db_strategy(),
    ) {
        let mut cfg1 = base_cfg(rx, tx);
        let mut cfg2 = cfg1.clone();

        let a_tx = (a_tx_raw as usize) % tx;
        let b_tx = (b_tx_raw as usize) % tx;
        let a_rx = (a_rx_raw as usize) % rx;
        let b_rx = (b_rx_raw as usize) % rx;

        // Unrelated: different source and different destination.
        prop_assume!(a_tx != b_tx);
        prop_assume!(a_rx != b_rx);

        cfg1.apply_crosspoint(a_tx, a_rx, a_enabled, a_gain_db).unwrap();
        cfg1.apply_crosspoint(b_tx, b_rx, b_enabled, b_gain_db).unwrap();

        cfg2.apply_crosspoint(b_tx, b_rx, b_enabled, b_gain_db).unwrap();
        cfg2.apply_crosspoint(a_tx, a_rx, a_enabled, a_gain_db).unwrap();

        prop_assert_eq!(cfg1.matrix, cfg2.matrix);
        prop_assert_eq!(cfg1.matrix_gain_db, cfg2.matrix_gain_db);
    }

    #[test]
    fn prop_gain_clamped_when_finite(
        rx in 1usize..=64,
        tx in 1usize..=32,
        tx_raw in any::<u8>(),
        rx_raw in any::<u8>(),
        enabled in any::<bool>(),
        gain_db in -10_000.0f32..10_000.0f32,
    ) {
        let tx_idx = (tx_raw as usize) % tx;
        let rx_idx = (rx_raw as usize) % rx;

        let mut cfg = base_cfg(rx, tx);
        cfg.apply_crosspoint(tx_idx, rx_idx, enabled, gain_db).unwrap();

        let stored = cfg.matrix_gain_db[tx_idx][rx_idx];
        prop_assert!(stored.is_finite());
        prop_assert!(stored >= -60.0);
        prop_assert!(stored <= 12.0);
        prop_assert_eq!(stored, patchbox_core::gain::clamp_db(gain_db));
    }

    #[test]
    fn prop_stereo_link_mirrors_route(
        rx in 2usize..=64,
        tx in 1usize..=32,
        tx_raw in any::<u8>(),
        left_raw in any::<u8>(),
        enabled in any::<bool>(),
        gain_db in gain_db_strategy(),
    ) {
        let tx_idx = (tx_raw as usize) % tx;
        let left_max = rx - 1;
        let left = ((left_raw as usize) % left_max) & !1usize;
        let right = left + 1;
        prop_assume!(right < rx);

        let mut cfg = base_cfg(rx, tx);
        cfg.stereo_links = vec![StereoLinkConfig {
            left_channel: left,
            right_channel: right,
            linked: true,
            pan: 0.0,
        }];

        cfg.apply_crosspoint(tx_idx, left, enabled, gain_db).unwrap();
        prop_assert_eq!(cfg.matrix[tx_idx][left], enabled);
        prop_assert_eq!(cfg.matrix[tx_idx][right], enabled);
        prop_assert_eq!(cfg.matrix_gain_db[tx_idx][left], cfg.matrix_gain_db[tx_idx][right]);

        cfg.apply_crosspoint(tx_idx, right, !enabled, gain_db).unwrap();
        prop_assert_eq!(cfg.matrix[tx_idx][left], !enabled);
        prop_assert_eq!(cfg.matrix[tx_idx][right], !enabled);
    }

    #[test]
    fn prop_channel_bounds_error_no_partial_state(
        rx in 1usize..=64,
        tx in 1usize..=32,
        enabled in any::<bool>(),
        gain_db in gain_db_strategy(),
        tx_oob in 1usize..=32,
        rx_oob in 1usize..=64,
    ) {
        let mut cfg = base_cfg(rx, tx);
        let before_matrix = cfg.matrix.clone();
        let before_gain = cfg.matrix_gain_db.clone();

        let err1 = cfg.apply_crosspoint(tx + tx_oob, 0, enabled, gain_db).unwrap_err();
        prop_assert!(err1.contains("tx index"));
        prop_assert_eq!(&cfg.matrix, &before_matrix);
        prop_assert_eq!(&cfg.matrix_gain_db, &before_gain);

        let err2 = cfg.apply_crosspoint(0, rx + rx_oob, enabled, gain_db).unwrap_err();
        prop_assert!(err2.contains("rx index"));
        prop_assert_eq!(&cfg.matrix, &before_matrix);
        prop_assert_eq!(&cfg.matrix_gain_db, &before_gain);
    }

    #[test]
    fn prop_roundtrip_serde_json_matrix_state(
        rx in 1usize..=64,
        tx in 1usize..=32,
        ops in prop::collection::vec((any::<u8>(), any::<u8>(), any::<bool>(), gain_db_strategy()), 0..=128),
    ) {
        let mut cfg = base_cfg(rx, tx);
        for (tx_raw, rx_raw, enabled, gain_db) in ops {
            let tx_idx = (tx_raw as usize) % tx;
            let rx_idx = (rx_raw as usize) % rx;
            cfg.apply_crosspoint(tx_idx, rx_idx, enabled, gain_db).unwrap();
        }

        let v1 = serde_json::to_value(&cfg).unwrap();
        let cfg2: PatchboxConfig = serde_json::from_value(v1.clone()).unwrap();
        let v2 = serde_json::to_value(&cfg2).unwrap();
        prop_assert_eq!(v1, v2);
    }
}

proptest! {
    // Heavier RT-path test: smaller sizes + fewer cases.
    #![proptest_config(ProptestConfig {
        cases: 64,
        failure_persistence: None,
        .. ProptestConfig::default()
    })]

    #[test]
    fn prop_muted_input_contributes_nothing(
        rx in 1usize..=8,
        tx in 1usize..=4,
        tx_raw in any::<u8>(),
        rx_raw in any::<u8>(),
        gain_db in 0.0f32..24.0f32,
    ) {
        let tx_idx = (tx_raw as usize) % tx;
        let rx_idx = (rx_raw as usize) % rx;

        let mut cfg = base_cfg(rx, tx);
        cfg.apply_crosspoint(tx_idx, rx_idx, true, gain_db).unwrap();
        cfg.input_dsp[rx_idx].enabled = false;

        let sr = 48_000.0;
        let mut mp = MatrixProcessor::new(rx, tx, sr);
        mp.sync(&cfg);

        let nframes = 16;
        let in_bufs: Vec<Vec<f32>> = (0..rx)
            .map(|i| {
                if i == rx_idx {
                    vec![1.0; nframes]
                } else {
                    vec![0.0; nframes]
                }
            })
            .collect();
        let in_refs: Vec<&[f32]> = in_bufs.iter().map(|b| b.as_slice()).collect();

        let mut out_bufs: Vec<Vec<f32>> = (0..tx).map(|_| vec![0.0; nframes]).collect();
        let mut out_refs: Vec<&mut [f32]> = out_bufs.iter_mut().map(|b| b.as_mut_slice()).collect();

        mp.process(&in_refs, &mut out_refs, &cfg);

        for &s in out_bufs[tx_idx].iter() {
            prop_assert_eq!(s, 0.0);
        }
    }
}
