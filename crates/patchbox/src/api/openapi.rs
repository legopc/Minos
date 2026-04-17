use utoipa::openapi::security::{HttpAuthScheme, HttpBuilder, SecurityScheme};
use utoipa::{Modify, OpenApi};

pub struct SecurityAddon;

impl Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        let components = openapi.components.get_or_insert_with(Default::default);
        components.add_security_scheme(
            "bearer_auth",
            SecurityScheme::Http(
                HttpBuilder::new()
                    .scheme(HttpAuthScheme::Bearer)
                    .bearer_format("JWT")
                    .build(),
            ),
        );
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Patchbox API",
        version = env!("CARGO_PKG_VERSION"),
        description = "Dante patchbox HTTP API"
    ),
    modifiers(&SecurityAddon),
    paths(
        crate::api::routes::system::get_health,
        crate::api::routes::system::get_system,
        crate::api::routes::system::get_solo,
        crate::api::routes::system::put_solo,
        crate::api::routes::system::get_monitor,
        crate::api::routes::system::put_monitor,
        crate::api::routes::system::get_config_backup_download,
        crate::api::routes::inputs::get_channels,
        crate::api::routes::inputs::get_channel,
        crate::api::routes::inputs::put_channel,
        crate::api::routes::outputs::get_outputs,
        crate::api::routes::outputs::get_output_resource,
        crate::api::routes::outputs::put_output_resource,
        crate::api::routes::buses::get_buses,
        crate::api::routes::buses::get_bus,
        crate::api::routes::buses::put_bus,
        crate::api::routes::buses::post_bus,
        crate::api::routes::buses::delete_bus,
        crate::api::routes::zones::get_zones_list,
        crate::api::routes::zones::post_zone,
        crate::api::routes::zones::put_zone_resource,
        crate::api::routes::zones::delete_zone_resource,
        crate::api::routes::routing::get_routes,
        crate::api::routes::routing::post_route,
        crate::api::routes::routing::delete_route,
        crate::api::routes::scenes::list_scenes,
        crate::api::routes::scenes::save_scene,
        crate::api::routes::scenes::load_scene,
        crate::auth_api::login,
        crate::auth_api::refresh_token,
    ),
    components(
        schemas(
            patchbox_core::config::EqBandType,
            patchbox_core::config::EqBand,
            patchbox_core::config::EqConfig,
            patchbox_core::config::FilterConfig,
            patchbox_core::config::GateConfig,
            patchbox_core::config::CompressorConfig,
            patchbox_core::config::DelayConfig,
            patchbox_core::config::AecConfig,
            patchbox_core::config::AutomixerChannelConfig,
            patchbox_core::config::FeedbackSuppressorConfig,
            patchbox_core::config::DynamicEqBandType,
            patchbox_core::config::DynamicEqBandConfig,
            patchbox_core::config::DynamicEqConfig,
            patchbox_core::config::AutomixerGroupConfig,
            patchbox_core::config::LimiterConfig,
            patchbox_core::config::ZoneConfig,
            patchbox_core::config::InternalBusConfig,
            patchbox_core::config::VcaGroupType,
            patchbox_core::config::VcaGroupConfig,
            patchbox_core::config::StereoLinkConfig,
            patchbox_core::config::SignalGenType,
            patchbox_core::config::SignalGeneratorConfig,
            patchbox_core::config::InputChannelDsp,
            patchbox_core::config::OutputChannelDsp,
            patchbox_core::dsp::DspBlockAny,
            crate::api::GainBody,
            crate::api::EnabledBody,
            crate::api::MutedBody,
            crate::api::PolarityBody,
            crate::api::routes::inputs::ChannelResponse,
            crate::api::routes::inputs::UpdateChannelRequest,
            crate::api::routes::outputs::OutputResponse,
            crate::api::routes::outputs::UpdateOutputRequest,
            crate::api::routes::buses::BusResponse,
            crate::api::routes::buses::CreateBusRequest,
            crate::api::routes::buses::UpdateBusRequest,
            crate::api::routes::zones::CreateZoneRequest,
            crate::api::routes::zones::UpdateZoneRequest,
            crate::api::routes::routing::RouteResponse,
            crate::api::routes::routing::CreateRouteRequest,
            crate::api::routes::routing::MatrixState,
            crate::api::routes::scenes::SaveSceneRequest,
            crate::api::routes::scenes::UpdateSceneRequest,
            crate::scenes::Scene,
            crate::api::routes::system::HealthDante,
            crate::api::routes::system::HealthPtp,
            crate::api::routes::system::HealthAudio,
            crate::api::routes::system::HealthZone,
            crate::api::routes::system::HealthConfig,
            crate::api::routes::system::HealthDsp,
            crate::api::routes::system::HealthStorage,
            crate::api::routes::system::HealthResponse,
            crate::api::routes::system::SystemResponse,
            crate::api::routes::system::SoloRequest,
            crate::api::routes::system::SoloResponse,
            crate::api::routes::system::MonitorRequest,
            crate::api::routes::system::MonitorResponse,
            crate::api::ErrorResponse,
            crate::auth_api::LoginRequest,
            crate::auth_api::LoginResponse,
            crate::auth_api::RefreshTokenResponse,
        )
    ),
    tags(
        (name = "health", description = "Health and status"),
        (name = "channels", description = "Input channels"),
        (name = "outputs", description = "Output channels"),
        (name = "buses", description = "Internal submix buses"),
        (name = "zones", description = "Zone groups"),
        (name = "routing", description = "Signal routing"),
        (name = "scenes", description = "Scene management"),
        (name = "auth", description = "Authentication"),
        (name = "system", description = "System info and monitor"),
    )
)]
pub struct ApiDoc;
