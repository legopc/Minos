/**
 * JSDoc type definitions for Patchbox API payloads.
 * Provides autocomplete and type checking in vanilla JS via IDE JSDoc resolution.
 */

// ─── DSP Block Kinds ────────────────────────────────────────────────────────
/**
 * Enumeration of DSP block types used in audio processing.
 * @typedef {"peq"|"cmp"|"gte"|"lim"|"dly"|"aec"|"axm"|"afs"|"deq"} DspKind
 */

// ─── Common Request/Response Bodies ─────────────────────────────────────────

/**
 * Request body for updating gain in dB.
 * @typedef {Object} GainBody
 * @property {number} gain_db - Gain in decibels, typically clamped to [-60, 24]
 */

/**
 * Request body for toggling enabled state.
 * @typedef {Object} EnabledBody
 * @property {boolean} enabled - Whether the component is enabled
 */

/**
 * Request body for toggling muted state.
 * @typedef {Object} MutedBody
 * @property {boolean} muted - Whether the component is muted
 */

/**
 * Request body for inverting polarity.
 * @typedef {Object} PolarityBody
 * @property {boolean} invert - Whether to invert polarity
 */

// ─── DSP Block Envelope ─────────────────────────────────────────────────────

/**
 * Generic DSP block envelope sent to API endpoints.
 * Standardized structure: {kind, enabled, version, params}.
 * @typedef {Object} DspBlock
 * @property {DspKind} kind - The DSP processor type (peq, cmp, gte, etc.)
 * @property {boolean} enabled - Whether the processor is active
 * @property {number} version - Schema version for the params object
 * @property {Object} params - Processor-specific parameters (type varies by kind)
 */

/**
 * Filter configuration parameters (HPF/LPF).
 * @typedef {Object} FilterConfig
 * @property {boolean} enabled - Whether the filter is enabled
 * @property {number} freq_hz - Cutoff frequency in Hz (e.g., 80–20000)
 * @property {number} slope - Filter slope in dB/octave (e.g., 12, 24)
 */

/**
 * Parametric EQ configuration.
 * @typedef {Object} EqConfig
 * @property {boolean} enabled - Whether EQ is enabled
 * @property {Array<Object>} bands - Array of 3 EQ band objects
 * @property {number} bands[].freq_hz - Band center frequency in Hz
 * @property {number} bands[].gain_db - Band gain in dB (e.g., -24 to +24)
 * @property {number} bands[].q - Band Q factor (e.g., 0.1 to 10)
 */

/**
 * Compressor configuration.
 * @typedef {Object} CompressorConfig
 * @property {boolean} enabled - Whether compressor is enabled
 * @property {number} threshold_db - Threshold in dB (e.g., -40 to 0)
 * @property {number} ratio - Compression ratio (e.g., 1.5 to ∞)
 * @property {number} attack_ms - Attack time in milliseconds (e.g., 0.1 to 500)
 * @property {number} release_ms - Release time in milliseconds (e.g., 10 to 2000)
 * @property {number} makeup_gain_db - Makeup gain in dB
 */

/**
 * Gate configuration.
 * @typedef {Object} GateConfig
 * @property {boolean} enabled - Whether gate is enabled
 * @property {number} threshold_db - Gate threshold in dB (e.g., -60 to 0)
 * @property {number} attack_ms - Attack time in milliseconds
 * @property {number} release_ms - Release time in milliseconds
 * @property {number} hold_ms - Hold time in milliseconds (e.g., 0 to 1000)
 */

/**
 * Limiter configuration (output-only).
 * @typedef {Object} LimiterConfig
 * @property {boolean} enabled - Whether limiter is enabled
 * @property {number} threshold_db - Limiter threshold in dB (e.g., -40 to 0)
 * @property {number} attack_ms - Attack time in milliseconds
 * @property {number} release_ms - Release time in milliseconds (e.g., 10 to 2000)
 */

/**
 * Delay configuration (output-only).
 * @typedef {Object} DelayConfig
 * @property {boolean} enabled - Whether delay is enabled
 * @property {number} delay_ms - Delay time in milliseconds (e.g., 0 to 1000)
 * @property {number} feedback - Feedback amount (e.g., 0 to 0.95)
 * @property {number} mix - Wet/dry mix (e.g., 0 to 1)
 */

/**
 * Acoustic Echo Cancellation configuration (input-only).
 * @typedef {Object} AecConfig
 * @property {boolean} enabled - Whether AEC is enabled
 * @property {number} echo_return_loss - Echo return loss in dB (e.g., 10 to 50)
 */

/**
 * Dynamic EQ configuration.
 * @typedef {Object} DynamicEqConfig
 * @property {boolean} enabled - Whether dynamic EQ is enabled
 * @property {Array<Object>} bands - Array of dynamic EQ band objects
 * @property {number} bands[].freq_hz - Band center frequency in Hz
 * @property {number} bands[].gain_db - Static gain in dB
 * @property {number} bands[].threshold_db - Dynamic threshold in dB
 */

// ─── Channel (RX Input) ─────────────────────────────────────────────────────

/**
 * Complete channel (RX input) response from GET /api/v1/channels/:id.
 * @typedef {Object} ChannelResponse
 * @property {string} id - Channel ID (e.g., "rx_0")
 * @property {string} name - Display name (e.g., "Mic 1")
 * @property {string} source_type - Source type (e.g., "dante")
 * @property {number} gain_db - Input gain in dB
 * @property {boolean} enabled - Whether input is enabled
 * @property {number|null} colour_index - Color swatch index (0–9) or null if unset
 * @property {Object} dsp - DSP chain object containing all processors
 * @property {Object} dsp.hpf - High-pass filter config
 * @property {Object} dsp.lpf - Low-pass filter config
 * @property {Object} dsp.eq - Parametric EQ config
 * @property {Object} dsp.gate - Gate config
 * @property {Object} dsp.compressor - Compressor config
 * @property {Object} dsp.aec - Acoustic echo cancellation config
 * @property {Object} dsp.automixer - Automixer routing/weighting
 * @property {Object} dsp.feedback - Feedback suppressor config
 * @property {Object} dsp.deq - Dynamic EQ config
 * @property {boolean} dsp.polarity - Polarity invert flag
 */

/**
 * Request body to update channel properties.
 * @typedef {Object} UpdateChannelRequest
 * @property {string|undefined} name - New display name
 * @property {number|undefined} gain_db - New gain in dB (clamped to [-60, 24])
 * @property {boolean|undefined} enabled - Enable/disable input
 * @property {(number|null)|undefined} colour_index - New color index or null
 */

// ─── Output (TX Channel/Zone) ───────────────────────────────────────────────

/**
 * Complete output (TX channel) response from GET /api/v1/outputs/:id.
 * @typedef {Object} OutputResponse
 * @property {string} id - Output ID (e.g., "tx_0")
 * @property {string} name - Display name (e.g., "Zone A")
 * @property {string} zone_id - Associated zone ID (e.g., "zone_0")
 * @property {number} zone_colour_index - Zone color swatch index (0–9)
 * @property {number} volume_db - Output volume/fader in dB
 * @property {boolean} muted - Whether output is muted
 * @property {boolean} polarity - Polarity invert flag
 * @property {Object} dsp - DSP chain object containing all processors
 * @property {Object} dsp.hpf - High-pass filter config
 * @property {Object} dsp.lpf - Low-pass filter config
 * @property {Object} dsp.eq - Parametric EQ config
 * @property {Object} dsp.compressor - Compressor config
 * @property {Object} dsp.limiter - Limiter config (output-only)
 * @property {Object} dsp.delay - Delay config (output-only)
 * @property {Object} dsp.deq - Dynamic EQ config
 * @property {number} dsp.dither_bits - Dither bits (0, 16, or 24)
 */

/**
 * Request body to update output properties.
 * @typedef {Object} UpdateOutputRequest
 * @property {string|undefined} name - New display name
 * @property {number|undefined} volume_db - New volume in dB (clamped to [-60, 24])
 * @property {boolean|undefined} muted - Mute/unmute output
 */

/**
 * Request body for dither configuration (output-only).
 * @typedef {Object} DitherBody
 * @property {number} bits - Dither bits: 0 (off), 16, or 24
 */

// ─── Bus ────────────────────────────────────────────────────────────────────

/**
 * Complete bus response from GET /api/v1/buses/:id.
 * @typedef {Object} BusResponse
 * @property {string} id - Bus ID (e.g., "bus_0")
 * @property {string} name - Display name (e.g., "Main Mix")
 * @property {boolean} muted - Whether bus is muted
 * @property {Array<boolean>} routing - Routing flags per RX input (length = rx_channels)
 * @property {Array<number>} routing_gain - Per-input gain in dB for routed signals
 * @property {Object} dsp - DSP chain object (same as channel/output chains)
 */

/**
 * Request body to create a new bus.
 * @typedef {Object} CreateBusRequest
 * @property {string|undefined} name - Bus name (defaults to "Bus N")
 */

/**
 * Request body to update bus properties.
 * @typedef {Object} UpdateBusRequest
 * @property {string|undefined} name - New bus name
 * @property {boolean|undefined} muted - Mute/unmute bus
 */

/**
 * Request body for bus routing assignment.
 * @typedef {Object} BusRoutingBody
 * @property {Array<boolean>} routing - Boolean array of length rx_channels
 */

/**
 * Request body for bus-to-output matrix update.
 * @typedef {Object} BusMatrixBody
 * @property {Array<Array<boolean>>} matrix - 2D array [tx_idx][bus_idx]
 */

/**
 * Request body for setting per-input gain on a bus.
 * @typedef {Object} BusInputGainBody
 * @property {number} rx - Input channel index
 * @property {number} gain_db - Gain in dB (clamped to [-40, 12])
 */

/**
 * Request body for bus-to-bus feed routing.
 * @typedef {Object} BusFeedBody
 * @property {string} src_id - Source bus ID (e.g., "bus_0")
 * @property {string} dst_id - Destination bus ID (e.g., "bus_1")
 * @property {boolean} active - Whether feed is active
 */

// ─── Zone ───────────────────────────────────────────────────────────────────

/**
 * Zone configuration object.
 * @typedef {Object} ZoneConfig
 * @property {string} id - Zone ID (e.g., "zone_0")
 * @property {string} name - Zone display name (e.g., "Main Room")
 * @property {number} colour_index - Color swatch index (0–9)
 * @property {Array<string>} tx_ids - List of associated TX channel IDs
 */

/**
 * Request body to create a zone.
 * @typedef {Object} CreateZoneRequest
 * @property {string} name - Zone name (required)
 * @property {number|undefined} colour_index - Color index (0–9); defaults to index % 10
 * @property {Array<string>|undefined} tx_ids - Associated TX channel IDs
 */

/**
 * Request body to update zone properties.
 * @typedef {Object} UpdateZoneRequest
 * @property {string|undefined} name - New zone name
 * @property {number|undefined} colour_index - New color index
 * @property {Array<string>|undefined} tx_ids - New TX channel associations
 */

/**
 * Request body for zone name update (legacy endpoint).
 * @typedef {Object} NameUpdate
 * @property {string} name - New name value
 */

/**
 * Request body for zone EQ band update.
 * @typedef {Object} EqUpdate
 * @property {number} band - EQ band index (0–2)
 * @property {number} freq_hz - Band center frequency in Hz
 * @property {number} gain_db - Band gain in dB
 * @property {number} q - Band Q factor
 */

/**
 * Request body for zone EQ enabled toggle.
 * @typedef {Object} EqEnabledUpdate
 * @property {boolean} enabled - Whether EQ is enabled
 */

/**
 * Request body for zone limiter parameters.
 * @typedef {Object} LimiterUpdate
 * @property {number} threshold_db - Limiter threshold in dB
 * @property {number} attack_ms - Attack time in milliseconds
 * @property {number} release_ms - Release time in milliseconds
 */

/**
 * Request body for zone limiter enabled toggle.
 * @typedef {Object} LimiterEnabledUpdate
 * @property {boolean} enabled - Whether limiter is enabled
 */

// ─── Routes & Routing ───────────────────────────────────────────────────────

/**
 * Route object representing an RX-to-TX connection.
 * @typedef {Object} Route
 * @property {string} rx_id - Source input ID (e.g., "rx_0")
 * @property {string} tx_id - Destination output ID (e.g., "tx_0")
 * @property {string} route_type - Route type ("local", "dante", etc.)
 */

/**
 * Request body to create a route.
 * @typedef {Object} RoutePayload
 * @property {string} rx_id - Source input ID
 * @property {string} tx_id - Destination output ID
 * @property {string|undefined} route_type - Route type (defaults to "local")
 */

/**
 * Matrix gain cell update.
 * @typedef {Object} MatrixGainUpdate
 * @property {number} tx - Output (TX) index
 * @property {number} rx - Input (RX) index
 * @property {boolean} enabled - Whether the route is active
 * @property {number} gain_db - Gain in dB for the connection
 */

// ─── Scenes ─────────────────────────────────────────────────────────────────

/**
 * Scene metadata and snapshot data.
 * @typedef {Object} Scene
 * @property {string} id - Scene unique identifier
 * @property {string} name - Scene display name
 * @property {string|undefined} description - Optional scene description
 * @property {boolean} is_favourite - Whether marked as favorite
 * @property {number} created_at - Creation timestamp (Unix seconds)
 * @property {number} updated_at - Last update timestamp (Unix seconds)
 * @property {Array<Array<boolean>>} matrix - Routing matrix snapshot
 * @property {Array<number>} input_gain_db - Input gains snapshot
 * @property {Array<number>} output_gain_db - Output gains snapshot
 */

/**
 * Request body to save/create a new scene.
 * @typedef {Object} SaveSceneRequest
 * @property {string} name - Scene name
 * @property {string|undefined} description - Optional description
 */

/**
 * Request body to update scene metadata.
 * @typedef {Object} UpdateSceneRequest
 * @property {string|undefined} name - New scene name
 * @property {string|undefined} description - New description
 * @property {boolean|undefined} is_favourite - Favorite toggle
 */

/**
 * Scene diff object showing changes when applied.
 * @typedef {Object} SceneDiff
 * @property {string} scene_id - Scene identifier
 * @property {Array<Object>} changes - Array of change objects
 * @property {boolean} has_changes - Whether any changes exist
 */

// ─── System & Health ────────────────────────────────────────────────────────

/**
 * System health status response.
 * @typedef {Object} HealthResponse
 * @property {string} status - Health status ("ok", "degraded", etc.)
 * @property {number} uptime_seconds - System uptime in seconds
 * @property {Object} cpu - CPU metrics
 * @property {number} cpu.usage_percent - CPU usage percentage
 * @property {Object} memory - Memory metrics
 * @property {number} memory.usage_percent - Memory usage percentage
 * @property {number} memory.available_mb - Available memory in MB
 * @property {Object} ptp - PTP clock status
 * @property {boolean} ptp.locked - Whether PTP is locked to master
 * @property {number} ptp.offset_ns - Offset from master in nanoseconds
 */

/**
 * System configuration response from GET /api/v1/system.
 * @typedef {Object} SystemConfig
 * @property {string} device_name - Device hostname/name
 * @property {number} rx_channels - Number of RX (input) channels
 * @property {number} tx_channels - Number of TX (output) channels
 * @property {string} monitor_device - Monitor output device name or null
 * @property {number} monitor_volume_db - Monitor output volume in dB
 */

/**
 * Request body to update system configuration.
 * @typedef {Object} UpdateSystemRequest
 * @property {string|undefined} device_name - New device name
 * @property {string|undefined} monitor_device - New monitor device
 * @property {number|undefined} monitor_volume_db - New monitor volume
 */

/**
 * Admin request body to reconfigure channel counts.
 * @typedef {Object} AdminChannelsReq
 * @property {number} rx - Desired RX channel count
 * @property {number} tx - Desired TX channel count
 * @property {number|undefined} bus_count - Optional bus count
 */

// ─── Solo & Monitoring ──────────────────────────────────────────────────────

/**
 * Solo state request/response.
 * @typedef {Object} SoloRequest
 * @property {Array<string>} channels - Array of soloed channel IDs (e.g., ["rx_0", "rx_2"])
 */

/**
 * Solo state response from GET /api/v1/solo.
 * @typedef {Object} SoloResponse
 * @property {Array<string>} channels - Array of currently soloed channel IDs
 * @property {string|null} monitor_device - Monitor device for solo output
 */

/**
 * Monitor output configuration.
 * @typedef {Object} MonitorResponse
 * @property {string|null} monitor_device - Monitor device name or null
 * @property {number} monitor_volume_db - Monitor output volume in dB
 * @property {Array<string>} soloed_channels - Array of currently soloed channel IDs
 */

// ─── Input Automixer ────────────────────────────────────────────────────────

/**
 * Request body for input automixer configuration.
 * @typedef {Object} UpdateAutomixerChannelRequest
 * @property {string|undefined} group_id - Automixer group ID or empty to remove
 * @property {number|undefined} weight - Channel weight in automixer group
 */

/**
 * Request body for input feedback suppressor parameters.
 * @typedef {Object} UpdateFeedbackSuppressorRequest
 * @property {boolean|undefined} enabled - Enable feedback suppression
 * @property {number|undefined} threshold_db - Detection threshold in dB
 * @property {number|undefined} hysteresis_db - Hysteresis in dB
 * @property {number|undefined} bandwidth_hz - Notch filter bandwidth in Hz
 * @property {number|undefined} max_notches - Maximum number of active notches
 * @property {boolean|undefined} auto_reset - Auto-reset notches after quiet period
 * @property {number|undefined} quiet_hold_ms - Hold time after quiet period (ms)
 * @property {number|undefined} quiet_threshold_db - Quiet threshold in dB
 * @property {boolean|undefined} reset_notches - Toggle to force notch reset
 */

// ─── Metering ───────────────────────────────────────────────────────────────

/**
 * Metering data from WebSocket or polling.
 * @typedef {Object} MeteringData
 * @property {Object<string, number>} rx - RX channel levels in dBFS (e.g., {"rx_0": -12.5})
 * @property {Object<string, number>} tx - TX channel levels in dBFS
 * @property {Object<string, number>} gr - Gain reduction values per processor (e.g., {"rx_0_cmp": -3.2})
 * @property {Object<string, number>} bus - Bus levels in dBFS
 * @property {Object<string, number>} peak - Peak hold values
 * @property {Object<string, number>} clip - Clip counters per channel
 */

// ─── WebSocket Messages ─────────────────────────────────────────────────────

/**
 * WebSocket hello message sent on connection.
 * @typedef {Object} WsHelloMessage
 * @property {string} type - Message type ("hello")
 * @property {string} version - API version
 * @property {number} rx_count - Number of RX channels
 * @property {number} tx_count - Number of TX channels
 * @property {number} zone_count - Number of zones
 * @property {Array<string>} solo_channels - Currently soloed channel IDs
 * @property {string|null} monitor_device - Monitor output device
 */

/**
 * WebSocket metering update message.
 * @typedef {Object} WsMeteringMessage
 * @property {string} type - Message type ("metering")
 * @property {Object<string, number>} rx - RX levels in dBFS
 * @property {Object<string, number>} tx - TX levels in dBFS
 * @property {Object<string, number>} gr - Gain reduction values
 * @property {Object<string, number>} bus - Bus levels in dBFS
 * @property {Object<string, number>} peak - Peak values
 * @property {Object<string, number>} clip - Clip counters
 */

/**
 * WebSocket output update message.
 * @typedef {Object} WsOutputUpdateMessage
 * @property {string} type - Message type ("output_update")
 * @property {string} id - Output ID (e.g., "tx_0")
 * @property {number|undefined} volume_db - New volume (if updated)
 * @property {boolean|undefined} muted - New mute state (if updated)
 */

/**
 * WebSocket scene loaded message.
 * @typedef {Object} WsSceneLoadedMessage
 * @property {string} type - Message type ("scene_loaded")
 * @property {string} scene_id - Scene identifier
 * @property {string} name - Scene name
 */

/**
 * WebSocket solo update message.
 * @typedef {Object} WsSoloUpdateMessage
 * @property {string} type - Message type ("solo_update")
 * @property {Array<string>} channels - Array of soloed channel IDs
 * @property {string|null} monitor_device - Monitor device name
 */

/**
 * WebSocket DSP update message (bus or input/output processor change).
 * @typedef {Object} WsDspUpdateMessage
 * @property {string} type - Message type ("bus_dsp_update", "input_dsp_update", etc.)
 * @property {string} id - Channel/bus ID
 * @property {string} block - DSP block key (e.g., "peq", "cmp")
 * @property {Object|undefined} params - New parameter values (if updated)
 */
