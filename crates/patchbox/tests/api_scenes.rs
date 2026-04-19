mod common;

use axum::http::{Method, StatusCode};
use patchbox::scenes::SceneStore;
use patchbox_core::config::{
    AutomixerGroupConfig, SignalGenType, SignalGeneratorConfig, StereoLinkConfig, VcaGroupConfig,
    VcaGroupType,
};

#[tokio::test]
async fn scenes_save_list_load_delete_roundtrip() {
    let app = common::test_app();
    let tok = common::login_token(&app);

    let (status, json) = common::get_json(&app, "/api/v1/scenes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("active").and_then(|v| v.as_str()), None);
    assert_eq!(
        json.get("scenes")
            .and_then(|v| v.as_array())
            .map(|v| v.len()),
        Some(0)
    );

    let (status, _resp, _bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes",
        Some(serde_json::json!({"name":"scene1","description":"test"})),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = common::get_json(&app, "/api/v1/scenes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    let scenes = json
        .get("scenes")
        .and_then(|v| v.as_array())
        .expect("scenes must be array");
    assert_eq!(scenes.len(), 1);
    let scene = scenes
        .iter()
        .find(|scene| scene.get("name").and_then(|v| v.as_str()) == Some("scene1"))
        .expect("saved scene present");
    assert_eq!(
        scene.get("schema_version").and_then(|v| v.as_u64()),
        Some(2)
    );

    let (status, _resp, _bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes/scene1/load",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = common::get_json(&app, "/api/v1/scenes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(json.get("active").and_then(|v| v.as_str()), Some("scene1"));

    let (status, _resp, _bytes) = common::send(
        &app,
        Method::DELETE,
        "/api/v1/scenes/scene1",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, json) = common::get_json(&app, "/api/v1/scenes", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        json.get("scenes")
            .and_then(|v| v.as_array())
            .map(|v| v.len()),
        Some(0)
    );
    assert_eq!(json.get("active").and_then(|v| v.as_str()), None);
}

#[tokio::test]
async fn legacy_v1_scene_loads_via_legacy_path() {
    let (app, state) = common::test_app_with_state();
    let tok = common::login_token(&app);

    {
        let mut cfg = state.config.write().await;
        cfg.matrix = vec![vec![false, false], vec![false, false]];
        cfg.matrix_gain_db = vec![vec![0.0, 0.0], vec![0.0, 0.0]];
        cfg.input_gain_db = vec![0.0, 0.0];
        cfg.output_gain_db = vec![0.0, 0.0];
        cfg.output_muted = vec![false, false];
        for dsp in &mut cfg.input_dsp {
            dsp.gain_db = 0.0;
        }
        for dsp in &mut cfg.output_dsp {
            dsp.gain_db = 0.0;
            dsp.muted = false;
        }
    }

    let scenes_toml = r#"
active = "legacy"

[scenes.legacy]
name = "legacy"
description = "legacy scene"
is_favourite = false
matrix = [[true, false], [false, true]]
input_gain_db = [1.5, -2.5]
output_gain_db = [-3.0, 4.5]
matrix_gain_db = [[0.0, -6.0], [0.0, 0.0]]
input_dsp_gain_db = [1.5, -2.5]
output_dsp_gain_db = [-3.0, 4.5]
output_muted = [true, false]
"#;
    std::fs::write(&state.scenes_path, scenes_toml).expect("write legacy scenes");
    *state.scenes.write().await = SceneStore::load(&state.scenes_path);

    let (status, _resp, _bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes/legacy/load",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let cfg = state.config.read().await;
    assert_eq!(cfg.matrix, vec![vec![true, false], vec![false, true]]);
    assert_eq!(cfg.input_gain_db, vec![1.5, -2.5]);
    assert_eq!(cfg.output_gain_db, vec![-3.0, 4.5]);
    assert_eq!(cfg.output_muted, vec![true, false]);
    assert_eq!(cfg.input_dsp[0].gain_db, 1.5);
    assert_eq!(cfg.input_dsp[1].gain_db, -2.5);
    assert_eq!(cfg.output_dsp[0].gain_db, -3.0);
    assert!(cfg.output_dsp[0].muted);
    assert_eq!(cfg.output_dsp[1].gain_db, 4.5);
}

#[tokio::test]
async fn scene_v2_roundtrip_and_grouped_diff_cover_full_snapshot() {
    let (app, state) = common::test_app_with_state();
    let tok = common::login_token(&app);

    {
        let mut cfg = state.config.write().await;
        cfg.matrix = vec![vec![true, false], vec![true, true]];
        cfg.matrix_gain_db = vec![vec![0.0, -3.0], vec![1.5, 0.5]];
        cfg.input_dsp[0].gain_db = 5.5;
        cfg.input_dsp[0].gate.enabled = true;
        cfg.input_dsp[0].gate.threshold_db = -42.0;
        cfg.input_dsp[0].automixer.enabled = true;
        cfg.input_dsp[0].automixer.group_id = Some("amg_voice".to_string());
        cfg.input_dsp[0].automixer.weight = 1.7;
        cfg.input_dsp[1].polarity = true;
        cfg.input_dsp[1].feedback.enabled = true;
        cfg.output_dsp[0].gain_db = -6.0;
        cfg.output_dsp[0].muted = true;
        cfg.output_dsp[0].delay.enabled = true;
        cfg.output_dsp[0].delay.delay_ms = 12.5;
        cfg.output_dsp[1].gain_db = 2.0;
        cfg.output_dsp[1].compressor.enabled = true;
        cfg.output_dsp[1].compressor.threshold_db = -10.0;
        cfg.input_gain_db = cfg.input_dsp.iter().map(|dsp| dsp.gain_db).collect();
        cfg.output_gain_db = cfg.output_dsp.iter().map(|dsp| dsp.gain_db).collect();
        cfg.output_muted = cfg.output_dsp.iter().map(|dsp| dsp.muted).collect();
        cfg.per_output_eq = cfg.output_dsp.iter().map(|dsp| dsp.eq.clone()).collect();
        cfg.per_output_limiter = cfg
            .output_dsp
            .iter()
            .map(|dsp| dsp.limiter.clone())
            .collect();
        cfg.internal_buses[0].routing = vec![true, false];
        cfg.internal_buses[0].routing_gain = vec![0.0, -9.0];
        cfg.internal_buses[0].dsp.gain_db = 3.0;
        cfg.internal_buses[0].muted = true;
        cfg.bus_matrix = Some(vec![vec![true], vec![false]]);
        cfg.bus_feed_matrix = Some(vec![vec![false]]);
        cfg.vca_groups = vec![VcaGroupConfig {
            id: "vca_inputs".to_string(),
            name: "Inputs".to_string(),
            gain_db: -4.0,
            muted: false,
            members: vec!["rx_0".to_string(), "rx_1".to_string()],
            group_type: VcaGroupType::Input,
        }];
        cfg.stereo_links = vec![StereoLinkConfig {
            left_channel: 0,
            right_channel: 1,
            linked: true,
            pan: 0.25,
        }];
        cfg.output_stereo_links = vec![StereoLinkConfig {
            left_channel: 0,
            right_channel: 1,
            linked: true,
            pan: -0.25,
        }];
        cfg.automixer_groups = vec![AutomixerGroupConfig {
            id: "amg_voice".to_string(),
            name: "Voice".to_string(),
            enabled: true,
            gate_threshold_db: -44.0,
            off_attenuation_db: -70.0,
            hold_ms: 150.0,
            last_mic_hold: true,
            gating_enabled: true,
        }];
        cfg.signal_generators = vec![SignalGeneratorConfig {
            id: "gen_0".to_string(),
            name: "Pink".to_string(),
            gen_type: SignalGenType::PinkNoise,
            freq_hz: 500.0,
            level_db: -18.0,
            enabled: true,
            sweep_start_hz: 30.0,
            sweep_end_hz: 18000.0,
            sweep_duration_s: 8.0,
        }];
        cfg.generator_bus_matrix = vec![vec![-3.0, f32::NEG_INFINITY]];
        cfg.normalize();
    }

    let (status, _resp, _bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes",
        Some(serde_json::json!({"name":"scene-v2","description":"full snapshot"})),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (status, saved_scene) = common::get_json(&app, "/api/v1/scenes/scene-v2", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        saved_scene.get("schema_version").and_then(|v| v.as_u64()),
        Some(2)
    );
    assert_eq!(
        saved_scene
            .get("input_dsp")
            .and_then(|v| v.as_array())
            .map(|v| v.len()),
        Some(2)
    );
    assert_eq!(
        saved_scene
            .get("internal_buses")
            .and_then(|v| v.as_array())
            .map(|v| v.len()),
        Some(1)
    );
    assert_eq!(
        saved_scene
            .get("vca_groups")
            .and_then(|v| v.as_array())
            .map(|v| v.len()),
        Some(1)
    );
    assert_eq!(
        saved_scene
            .get("signal_generators")
            .and_then(|v| v.as_array())
            .map(|v| v.len()),
        Some(1)
    );

    {
        let mut cfg = state.config.write().await;
        cfg.matrix = vec![vec![false, false], vec![false, false]];
        cfg.matrix_gain_db = vec![vec![0.0, 0.0], vec![0.0, 0.0]];
        for dsp in &mut cfg.input_dsp {
            *dsp = patchbox_core::config::InputChannelDsp::default();
        }
        for dsp in &mut cfg.output_dsp {
            *dsp = patchbox_core::config::OutputChannelDsp::default();
        }
        cfg.input_gain_db = vec![0.0, 0.0];
        cfg.output_gain_db = vec![0.0, 0.0];
        cfg.output_muted = vec![false, false];
        cfg.per_output_eq = cfg.output_dsp.iter().map(|dsp| dsp.eq.clone()).collect();
        cfg.per_output_limiter = cfg
            .output_dsp
            .iter()
            .map(|dsp| dsp.limiter.clone())
            .collect();
        cfg.internal_buses.clear();
        cfg.bus_matrix = None;
        cfg.bus_feed_matrix = None;
        cfg.vca_groups.clear();
        cfg.stereo_links.clear();
        cfg.output_stereo_links.clear();
        cfg.automixer_groups.clear();
        cfg.signal_generators.clear();
        cfg.generator_bus_matrix.clear();
        cfg.normalize();
    }

    let (status, diff) = common::get_json(&app, "/api/v1/scenes/scene-v2/diff", Some(&tok)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        diff.get("has_changes").and_then(|v| v.as_bool()),
        Some(true)
    );
    let sections = diff
        .get("sections")
        .and_then(|v| v.as_object())
        .expect("grouped sections");
    assert!(sections.contains_key("routing"));
    assert!(sections.contains_key("inputs"));
    assert!(sections.contains_key("outputs"));
    assert!(sections.contains_key("buses"));
    assert!(sections.contains_key("groups"));
    assert!(sections.contains_key("generators"));
    assert!(diff
        .get("changes")
        .and_then(|v| v.as_array())
        .is_some_and(|changes| !changes.is_empty()));
    assert_eq!(
        diff.get("summary")
            .and_then(|v| v.get("section_count"))
            .and_then(|v| v.as_u64()),
        Some(6)
    );

    let (status, scoped_diff) = common::get_json(
        &app,
        "/api/v1/scenes/scene-v2/diff?routing=false&inputs=true&outputs=false&buses=false&groups=false&generators=false",
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let scoped_sections = scoped_diff
        .get("sections")
        .and_then(|v| v.as_object())
        .expect("scoped grouped sections");
    assert_eq!(scoped_sections.len(), 1);
    assert!(scoped_sections.contains_key("inputs"));
    assert_eq!(
        scoped_diff
            .get("summary")
            .and_then(|v| v.get("section_count"))
            .and_then(|v| v.as_u64()),
        Some(1)
    );

    let (status, _resp, _bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes/scene-v2/load",
        Some(serde_json::json!({
            "scope": {
                "routing": false,
                "inputs": true,
                "outputs": false,
                "buses": false,
                "groups": false,
                "generators": false
            }
        })),
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    {
        let cfg = state.config.read().await;
        assert_eq!(cfg.matrix, vec![vec![false, false], vec![false, false]]);
        assert_eq!(cfg.input_dsp[0].gain_db, 5.5);
        assert!(cfg.input_dsp[0].gate.enabled);
        assert_eq!(cfg.output_dsp[0].gain_db, 0.0);
        assert!(!cfg.output_dsp[0].muted);
        assert!(cfg.internal_buses.is_empty());
        assert!(cfg.vca_groups.is_empty());
        assert!(cfg.signal_generators.is_empty());
    }

    let (status, _resp, _bytes) = common::send(
        &app,
        Method::POST,
        "/api/v1/scenes/scene-v2/load",
        None,
        Some(&tok),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let cfg = state.config.read().await;
    assert_eq!(cfg.matrix, vec![vec![true, false], vec![true, true]]);
    assert_eq!(cfg.matrix_gain_db, vec![vec![0.0, -3.0], vec![1.5, 0.5]]);
    assert_eq!(cfg.input_dsp[0].gain_db, 5.5);
    assert!(cfg.input_dsp[0].gate.enabled);
    assert_eq!(
        cfg.input_dsp[0].automixer.group_id.as_deref(),
        Some("amg_voice")
    );
    assert!(cfg.input_dsp[1].polarity);
    assert!(cfg.output_dsp[0].muted);
    assert!(cfg.output_dsp[0].delay.enabled);
    assert_eq!(cfg.output_dsp[0].delay.delay_ms, 12.5);
    assert!(cfg.output_dsp[1].compressor.enabled);
    assert_eq!(cfg.internal_buses.len(), 1);
    assert_eq!(cfg.internal_buses[0].routing, vec![true, false]);
    assert_eq!(cfg.internal_buses[0].routing_gain, vec![0.0, -9.0]);
    assert!(cfg.internal_buses[0].muted);
    assert_eq!(cfg.bus_matrix, Some(vec![vec![true], vec![false]]));
    assert_eq!(cfg.bus_feed_matrix, Some(vec![vec![false]]));
    assert_eq!(cfg.vca_groups.len(), 1);
    assert_eq!(cfg.stereo_links.len(), 1);
    assert_eq!(cfg.output_stereo_links.len(), 1);
    assert_eq!(cfg.automixer_groups.len(), 1);
    assert_eq!(cfg.signal_generators.len(), 1);
    assert_eq!(cfg.generator_bus_matrix.len(), 1);
    assert_eq!(cfg.input_gain_db, vec![5.5, 0.0]);
    assert_eq!(cfg.output_gain_db, vec![-6.0, 2.0]);
    assert_eq!(cfg.output_muted, vec![true, false]);
}
