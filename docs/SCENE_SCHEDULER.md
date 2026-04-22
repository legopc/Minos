# Scene Scheduler

Time-based automatic scene recall. Configured via `config.toml` or the
`POST /api/v1/scenes/schedule` API endpoint.

---

## Schedule Format

Each schedule entry is a cron-like rule:

```toml
[[scenes.schedule]]
scene   = "Morning"
cron    = "0 8 * * 1-5"   # weekdays at 08:00
enabled = true

[[scenes.schedule]]
scene   = "Evening"
cron    = "0 18 * * *"    # every day at 18:00
enabled = true

[[scenes.schedule]]
scene   = "Closed"
cron    = "0 23 * * *"    # nightly at 23:00
enabled = true
```

### Cron field order

```
 ┌───── minute    (0–59)
 │ ┌─── hour      (0–23)
 │ │ ┌─ day       (1–31)
 │ │ │ ┌ month    (1–12)
 │ │ │ │ ┌ weekday (0–7, 0/7=Sunday)
 │ │ │ │ │
 * * * * *
```

Supports: `*`, exact values, `,` lists, `-` ranges, `/` steps.
Does **not** support seconds-level scheduling (5-field only).

### Timezone

All times are evaluated in the system local timezone (read from `/etc/timezone`
at startup). There is no per-schedule timezone override. Log entries record
the UTC timestamp alongside local time.

---

## Rust Types

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScheduleEntry {
    pub scene: String,             // name of scene to recall
    pub cron: String,              // 5-field cron expression
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SceneSchedule {
    pub entries: Vec<ScheduleEntry>,
}
```

Add `schedule: SceneSchedule` to `ScenesConfig` (or `PatchboxConfig` top-level).

---

## Implementation

Use the `cron` crate (`cron = "0.12"`) for expression parsing and next-fire
calculation. The scheduler runs as a single `tokio::task::spawn` loop:

```
loop {
    let next = find_next_fire(&entries);  // nearest future timestamp
    sleep_until(next).await;
    let entry = entries matching next;
    recall_scene(entry.scene, &state).await;
    log_event(EventLevel::Info, format!("Scheduler: recalled '{}'", entry.scene));
}
```

Restart the loop whenever schedule entries change (use a `watch::channel` from
`tokio::sync`).

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/scenes/schedule` | List all schedule entries |
| `POST` | `/api/v1/scenes/schedule` | Create or replace the full schedule |
| `PUT` | `/api/v1/scenes/schedule/{idx}` | Update a single entry |
| `DELETE` | `/api/v1/scenes/schedule/{idx}` | Remove a single entry |

`POST /api/v1/scenes/schedule` body:

```json
{
  "entries": [
    { "scene": "Morning", "cron": "0 8 * * 1-5", "enabled": true }
  ]
}
```

All schedule changes are persisted immediately (same persist path as scenes).

---

## Error Handling

- Invalid cron expression → `400 Bad Request` with `"invalid cron expression: …"`
- Scene name not found → `404 Not Found` at recall time; log warning, continue scheduler
- Schedule file corrupt at startup → log error, start with empty schedule

---

## UI (Sprint 6+)

On the Scenes page, below the scene grid:

```
── SCHEDULE ──────────────────────────────────────────

[+ ADD RULE]

  Morning    │ 0 8 * * 1-5   │ ● enabled  │ [Edit] [Delete]
  Evening    │ 0 18 * * *    │ ● enabled  │ [Edit] [Delete]
  Closed     │ 0 23 * * *    │ ○ disabled │ [Edit] [Delete]

  Next: "Evening" in 3h 22m
```

The `[+ ADD RULE]` button opens an inline form with: scene picker (select from
existing scenes), cron field with live validation, enabled toggle.
