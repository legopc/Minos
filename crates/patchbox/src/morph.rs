use crate::ab_compare::MorphDirection;
use crate::api::ws_broadcast;
use crate::scenes::{RecallScope, Scene};
use crate::state::AppState;
use serde_json::{Map, Number, Value};
use std::time::Duration;

const SILENCE_FLOOR_DB: f64 = -120.0;

pub fn blend_scenes(from: &Scene, to: &Scene, t: f32, scope: &RecallScope) -> Scene {
    let from_value = serde_json::to_value(from).unwrap_or(Value::Null);
    let to_value = serde_json::to_value(to).unwrap_or(Value::Null);
    let Value::Object(from_obj) = from_value else {
        return if t >= 1.0 { to.clone() } else { from.clone() };
    };
    let Value::Object(to_obj) = to_value else {
        return if t >= 1.0 { to.clone() } else { from.clone() };
    };

    let mut blended = Map::new();
    let mut keys: Vec<_> = from_obj.keys().chain(to_obj.keys()).cloned().collect();
    keys.sort();
    keys.dedup();
    for key in keys {
        let from_entry = from_obj.get(&key).unwrap_or(&Value::Null);
        let to_entry = to_obj.get(&key).unwrap_or(&Value::Null);
        let value = if scene_field_in_scope(&key, scope) {
            blend_value(&key, from_entry, to_entry, t, from, to)
        } else if key == "schema_version" {
            Value::Number(Number::from(from.schema_version.max(to.schema_version)))
        } else if t >= 0.5 {
            to_entry.clone()
        } else {
            from_entry.clone()
        };
        blended.insert(key, value);
    }

    let mut scene = serde_json::from_value(Value::Object(blended))
        .unwrap_or_else(|_| if t >= 1.0 { to.clone() } else { from.clone() });
    scene.schema_version = from.schema_version.max(to.schema_version);
    scene.input_gain_db = if !scene.input_dsp.is_empty() {
        scene.input_dsp.iter().map(|dsp| dsp.gain_db).collect()
    } else if t >= 0.5 {
        to.input_gain_db.clone()
    } else {
        from.input_gain_db.clone()
    };
    scene.input_dsp_gain_db = if !scene.input_dsp.is_empty() {
        scene.input_dsp.iter().map(|dsp| dsp.gain_db).collect()
    } else {
        scene.input_gain_db.clone()
    };
    scene.output_gain_db = if !scene.output_dsp.is_empty() {
        scene.output_dsp.iter().map(|dsp| dsp.gain_db).collect()
    } else if t >= 0.5 {
        to.output_gain_db.clone()
    } else {
        from.output_gain_db.clone()
    };
    scene.output_dsp_gain_db = if !scene.output_dsp.is_empty() {
        scene.output_dsp.iter().map(|dsp| dsp.gain_db).collect()
    } else {
        scene.output_gain_db.clone()
    };
    scene.output_muted = if !scene.output_dsp.is_empty() {
        scene.output_dsp.iter().map(|dsp| dsp.muted).collect()
    } else if t >= 0.5 {
        to.output_muted.clone()
    } else {
        from.output_muted.clone()
    };
    scene
}

pub async fn run_morph(
    state: AppState,
    from: Scene,
    to: Scene,
    direction: MorphDirection,
    duration_ms: u32,
    scope: RecallScope,
) {
    let start = tokio::time::Instant::now();
    let duration_ms = duration_ms.max(1);
    let mut interval = tokio::time::interval(Duration::from_millis(20));

    loop {
        interval.tick().await;
        let elapsed_ms = start.elapsed().as_millis().min(u32::MAX as u128) as u32;
        let t = (elapsed_ms as f32 / duration_ms as f32).clamp(0.0, 1.0);
        let frame = blend_scenes(&from, &to, t, &scope);

        {
            let mut cfg = state.config.write().await;
            frame.apply_to_config_scoped(&mut cfg, &scope);
        }

        {
            let mut ab = state.ab_state.write().await;
            if let Some(morph) = ab.morph.as_mut() {
                morph.elapsed_ms = elapsed_ms.min(duration_ms);
            }
        }

        ws_broadcast(
            &state,
            serde_json::json!({
                "type": "morph_progress",
                "direction": direction,
                "t": t,
                "elapsed_ms": elapsed_ms.min(duration_ms),
                "remaining_ms": duration_ms.saturating_sub(elapsed_ms),
            })
            .to_string(),
        );

        if t >= 1.0 {
            break;
        }
    }

    if let Err(error) = state.persist().await {
        tracing::error!(error = %error, "morph final persist failed");
    }

    {
        let mut ab = state.ab_state.write().await;
        ab.morph = None;
        ab.active = direction.target_slot();
    }
    {
        let mut task = state.morph_task.lock().await;
        *task = None;
    }

    ws_broadcast(
        &state,
        serde_json::json!({
            "type": "morph_complete",
            "active": direction.target_slot(),
        })
        .to_string(),
    );
    ws_broadcast(&state, serde_json::json!(ab_state_event_payload(&state).await).to_string());
}

pub async fn ab_state_event_payload(state: &AppState) -> Value {
    let ab = state.ab_state.read().await.clone();
    serde_json::json!({
        "type": "ab_update",
        "active": ab.active,
        "slot_a": slot_summary(ab.slot_a.as_ref()),
        "slot_b": slot_summary(ab.slot_b.as_ref()),
        "morph": ab.morph,
    })
}

fn slot_summary(slot: Option<&crate::ab_compare::AbSlotData>) -> Value {
    match slot {
        Some(slot) => serde_json::json!({
            "source": slot.source,
            "captured_at_ms": slot.captured_at_ms,
            "scene_name": slot.snapshot.name,
            "schema_version": slot.snapshot.schema_version,
        }),
        None => Value::Null,
    }
}

fn scene_field_in_scope(field: &str, scope: &RecallScope) -> bool {
    match field {
        "matrix" | "matrix_gain_db" => scope.routing,
        "input_dsp" | "input_gain_db" | "input_dsp_gain_db" => scope.inputs,
        "output_dsp" | "output_gain_db" | "output_dsp_gain_db" | "output_muted" => scope.outputs,
        "internal_buses" | "bus_matrix" | "bus_feed_matrix" => scope.buses,
        "vca_groups" | "stereo_links" | "output_stereo_links" | "automixer_groups" => scope.groups,
        "signal_generators" | "generator_bus_matrix" => scope.generators,
        _ => false,
    }
}

fn blend_value(path: &str, from: &Value, to: &Value, t: f32, from_scene: &Scene, to_scene: &Scene) -> Value {
    if from == to {
        return from.clone();
    }
    match (from, to) {
        (Value::Object(from_obj), Value::Object(to_obj)) => {
            let mut blended = Map::new();
            let mut keys: Vec<_> = from_obj.keys().chain(to_obj.keys()).cloned().collect();
            keys.sort();
            keys.dedup();
            for key in keys {
                let child_path = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                let from_entry = from_obj.get(&key).unwrap_or(&Value::Null);
                let to_entry = to_obj.get(&key).unwrap_or(&Value::Null);
                blended.insert(key, blend_value(&child_path, from_entry, to_entry, t, from_scene, to_scene));
            }
            Value::Object(blended)
        }
        (Value::Array(from_arr), Value::Array(to_arr)) => {
            let max_len = from_arr.len().max(to_arr.len());
            Value::Array(
                (0..max_len)
                    .map(|idx| {
                        let child_path = format!("{path}[{idx}]");
                        let from_entry = from_arr.get(idx).unwrap_or(&Value::Null);
                        let to_entry = to_arr.get(idx).unwrap_or(&Value::Null);
                        blend_value(&child_path, from_entry, to_entry, t, from_scene, to_scene)
                    })
                    .collect(),
            )
        }
        (Value::Number(from_num), Value::Number(to_num)) => blend_number(path, from_num, to_num, t, from_scene, to_scene),
        (Value::Bool(from_bool), Value::Bool(to_bool)) => {
            Value::Bool(blend_bool(path, *from_bool, *to_bool, t))
        }
        _ => step_value(from, to, t),
    }
}

fn blend_number(
    path: &str,
    from_num: &Number,
    to_num: &Number,
    t: f32,
    from_scene: &Scene,
    to_scene: &Scene,
) -> Value {
    let (mut from_value, mut to_value) = (
        number_to_f64(from_num, path),
        number_to_f64(to_num, path),
    );

    if let Some((tx, rx)) = parse_matrix_gain_path(path) {
        from_value = if from_scene
            .matrix
            .get(tx)
            .and_then(|row| row.get(rx))
            .copied()
            .unwrap_or(false)
        {
            number_to_f64(from_num, path)
        } else {
            SILENCE_FLOOR_DB
        };
        to_value = if to_scene
            .matrix
            .get(tx)
            .and_then(|row| row.get(rx))
            .copied()
            .unwrap_or(false)
        {
            number_to_f64(to_num, path)
        } else {
            SILENCE_FLOOR_DB
        };
    } else if let Some((bus_idx, rx_idx)) = parse_bus_routing_gain_path(path) {
        from_value = if from_scene
            .internal_buses
            .get(bus_idx)
            .and_then(|bus| bus.routing.get(rx_idx))
            .copied()
            .unwrap_or(false)
        {
            number_to_f64(from_num, path)
        } else {
            SILENCE_FLOOR_DB
        };
        to_value = if to_scene
            .internal_buses
            .get(bus_idx)
            .and_then(|bus| bus.routing.get(rx_idx))
            .copied()
            .unwrap_or(false)
        {
            number_to_f64(to_num, path)
        } else {
            SILENCE_FLOOR_DB
        };
    }

    let blended = if is_log_interp_path(path) && from_value > 0.0 && to_value > 0.0 {
        log_interp(from_value, to_value, t as f64)
    } else {
        lerp(from_value, to_value, t as f64)
    };
    Value::Number(
        Number::from_f64(blended.clamp(SILENCE_FLOOR_DB, f32::MAX as f64)).unwrap_or_else(|| Number::from(0)),
    )
}

fn blend_bool(path: &str, from: bool, to: bool, t: f32) -> bool {
    if is_union_route_bool_path(path) {
        if t >= 1.0 {
            to
        } else if t <= 0.0 {
            from
        } else {
            from || to
        }
    } else if t >= 0.5 {
        to
    } else {
        from
    }
}

fn step_value(from: &Value, to: &Value, t: f32) -> Value {
    if t >= 0.5 {
        to.clone()
    } else {
        from.clone()
    }
}

fn number_to_f64(value: &Number, path: &str) -> f64 {
    let fallback = if is_gain_like_path(path) { SILENCE_FLOOR_DB } else { 0.0 };
    let numeric = value.as_f64().unwrap_or(fallback);
    if numeric.is_finite() {
        numeric
    } else {
        fallback
    }
}

fn is_gain_like_path(path: &str) -> bool {
    path.ends_with("gain_db")
        || path.ends_with("threshold_db")
        || path.ends_with("off_attenuation_db")
        || path.ends_with("range_db")
        || path.ends_with("level_db")
        || path.contains("gain_db[")
}

fn is_log_interp_path(path: &str) -> bool {
    path.ends_with("freq_hz")
        || path.ends_with("sweep_start_hz")
        || path.ends_with("sweep_end_hz")
        || path.ends_with("bandwidth_hz")
}

fn is_union_route_bool_path(path: &str) -> bool {
    path.starts_with("matrix[")
        || path.starts_with("bus_matrix[")
        || path.starts_with("bus_feed_matrix[")
        || path.contains(".routing[")
}

fn parse_matrix_gain_path(path: &str) -> Option<(usize, usize)> {
    if !path.starts_with("matrix_gain_db[") {
        return None;
    }
    parse_two_indices(path)
}

fn parse_bus_routing_gain_path(path: &str) -> Option<(usize, usize)> {
    if !path.starts_with("internal_buses[") || !path.contains(".routing_gain[") {
        return None;
    }
    parse_two_indices(path)
}

fn parse_two_indices(path: &str) -> Option<(usize, usize)> {
    let mut indices = Vec::new();
    let mut current = String::new();
    let mut in_brackets = false;
    for ch in path.chars() {
        match ch {
            '[' => {
                current.clear();
                in_brackets = true;
            }
            ']' if in_brackets => {
                indices.push(current.parse().ok()?);
                in_brackets = false;
            }
            _ if in_brackets => current.push(ch),
            _ => {}
        }
    }
    match indices.as_slice() {
        [first, second, ..] => Some((*first, *second)),
        _ => None,
    }
}

fn lerp(from: f64, to: f64, t: f64) -> f64 {
    from + (to - from) * t
}

fn log_interp(from: f64, to: f64, t: f64) -> f64 {
    let from = from.max(1.0e-6);
    let to = to.max(1.0e-6);
    (from.ln() + (to.ln() - from.ln()) * t).exp()
}
