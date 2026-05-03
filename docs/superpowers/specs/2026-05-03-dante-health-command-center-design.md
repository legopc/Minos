# Dante Health Command Center Design

## Purpose

The Dante tab should become an admin troubleshooting page. Its first job is to answer: is Dante/PTP healthy? Secondary jobs are to explain silent audio, show recent Dante/PTP/recovery activity, and make safe recovery actions available to admins.

The first implementation pass should reorganize existing diagnostics data. It should reserve space for richer statime/PTP diagnostics later, but it must not depend on a new statime backend API.

## Current State

The current Dante page renders a broad diagnostics grid from `web/src/js/dante.js` and `web/src/css/dante.css`. It polls `GET /api/v1/system/dante/diagnostics` and `GET /api/v1/routes/trace?tx_id=...` every two seconds while the tab is active.

Current cards include Device, Local I/O Roster, Subscription Health, Route Trace, Network, PTP, PTP History, Network Event Log, Task Status, and Recovery Actions. This exposes useful data, but everything competes for equal attention. An admin has to read the whole page to answer the basic health question.

Observed issues:

- Diagnostics refresh errors are swallowed, so stale data can look current.
- Recovery actions are visible to operators even though the backend rejects them with `403`.
- `Restart Minos` submits immediately with no confirmation.
- Subscription health and roster status are estimated from Minos config and metering, but the UI does not make that distinction strongly enough.
- The Network card is currently thin and should not overclaim health.
- PTP status appears in several places from related but not identical sources.

## Virgil/PTP Context

The Virgil project lives at `/home/legopc/_archive/copilot_projects/Inferno_Appliance/inferno-aoip-releases`. Its Cockpit app monitors PTP/statime using local host data, journald parsing, service state, NIC data, and offset history.

Useful concepts to bring into Minos later:

- A prominent PTP health pill.
- Offset sparkline and rolling quality thresholds.
- Service state for statime.
- Grandmaster identity.
- Protocol/domain/role metadata.
- Hardware timestamping capability.
- NIC carrier/link status.

Virgil's current frontend parses journald text directly. Minos should not copy that pattern. Minos should eventually expose structured backend diagnostics instead of relying on exact log wording in browser code. Log scraping in UI works until somebody changes a sentence. Computers are very literal and very petty.

## Approved Layout

Use a Health Command Center model.

### Top Health Command Bar

The top of the Dante tab should show a single health verdict:

- `Healthy`
- `Degraded`
- `Fault`
- `Unknown`

The command bar should summarize the strongest existing signals:

- Dante connected/disconnected.
- PTP locked/unlocked/unknown.
- Sample rate.
- RX/TX channel count.
- Configured Dante NIC.
- Last successful diagnostics refresh age.

If refresh fails, keep the last good diagnostics visible but mark them stale. The page must not silently imply fresh data.

### Troubleshooting Lanes

Below the command bar, show four compact lanes.

#### Clock/PTP

Show lock state, offset if known, clock socket state, observation socket config, PTP history sparkline, and a future structured-statime placeholder. This lane should make clear when data is missing versus merely unhealthy.

#### Network/Device

Show Dante device name, configured NIC, Dante connection status, and the current network card data. Because the backend network data is currently shallow, the UI should label it as configuration/device context rather than authoritative network health.

#### Audio Flow

Show subscription health, routed-but-silent outputs, muted outputs, and route trace for a selected output. Subscription and roster data must be labeled as estimated from Minos config and metering, not Dante Controller ground truth.

#### Recent Activity

Show Dante/PTP/recovery event log entries and recent Dante recovery tasks. Keep JSON export for event logs.

### Recovery Actions

Recovery actions should sit below the main diagnostic lanes.

Admins see actionable controls. Operators either do not see the controls or see a clear `admin required` note with disabled controls. Viewers continue not to see the Dante tab.

`Restart Minos` must require confirmation before submitting. `Rescan now` and `Rebind runtime` can remain one-click actions, with busy state and task updates.

## Data And API Scope

First pass uses existing endpoints:

- `GET /api/v1/system/dante/diagnostics`
- `GET /api/v1/routes/trace?tx_id=...`
- `POST /api/v1/system/dante/recovery-actions/:action`

Do not introduce a new backend statime API in the first pass. The frontend should, however, reserve a visible place for future statime diagnostics so the layout does not need to be redesigned again.

Measured or current-ish data:

- Dante connection flag.
- PTP lock/offset/socket state as currently exposed.
- RX/TX counts.
- Event log.
- Task state.
- Route trace derived from current config.

Estimated data:

- Subscription health.
- Endpoint roster signal state.
- Routed-silent diagnosis.
- Muted-output diagnosis.

## Refresh Behavior

The Dante tab should continue polling only while active. Poll interval remains two seconds.

The frontend should track:

- Last successful diagnostics refresh time.
- Last diagnostics refresh error.
- Route trace refresh state and route trace error separately.

Diagnostics failure should not erase the last good data. Route trace failure should affect only the Audio Flow trace area, not the whole page.

## Testing

Required verification for implementation:

- JS syntax check for `web/src/js/dante.js`.
- JS syntax check for `web/src/js/api.js` if touched.
- UI smoke test for Dante tab rendering the health command center.
- UI smoke or browser test for stale diagnostics behavior.
- UI/browser test that `Restart Minos` requires confirmation.
- Backend tests only if backend response shape or auth behavior changes.

## Separate-Agent Prompt For Statime/Inferno Research

Before implementation begins, give this prompt to a separate agent:

```text
Research whether Minos can gain richer structured PTP/statime diagnostics without breaking compatibility with the existing Inferno/Virgil statime work.

Relevant paths:
- Virgil/Inferno release project: /home/legopc/_archive/copilot_projects/Inferno_Appliance/inferno-aoip-releases
- PTPv1 master/statime work: /home/legopc/_Inferno/inferno-ptpv1-master
- Minos project: /home/legopc/Opencode/minos

Goals:
1. Inspect the statime branches/configs used by Virgil/Inferno, especially teodly/statime inferno-dev and legopc/statime ptpv1-master.
2. Identify whether statime already exposes structured observation data that Minos can read without scraping journald.
3. Determine whether adding richer diagnostic output is feasible without breaking existing Virgil/Inferno behavior, configs, or service assumptions.
4. Identify the safest compatibility path: reuse existing observation socket, add a separate optional endpoint/socket/file, or add statime logging/JSON output behind config.
5. Propose a minimal JSON shape for Minos PTP diagnostics, including service state, protocol version, domain, role, grandmaster, offset, offset distribution, hardware timestamping, clock socket freshness, and config path.
6. Call out risks around PTPv1 master vs slave configs, protocol-version differences, hardware-clock behavior, usrvclock export, and statime branch drift.

Constraints:
- Do not modify repositories.
- Do not assume Virgil's frontend journal scraping is acceptable for Minos.
- Preserve backward compatibility for existing Inferno/Virgil image/service behavior.
- Return concrete file references, branch/commit details, available data sources, proposed diagnostic schema, and a compatibility recommendation.
```

## Out Of Scope For First Pass

- Implementing a new statime backend API.
- Changing statime configuration or branch selection.
- Deploying to dante-doos.
- Changing backend recovery action authorization.
- Replacing Dante Controller as the source of actual Dante network subscriptions.
