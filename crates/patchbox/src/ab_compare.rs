use crate::scenes::{RecallScope, Scene};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AbSlot {
    #[default]
    A,
    B,
}

impl AbSlot {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::A => "a",
            Self::B => "b",
        }
    }

    pub fn other(self) -> Self {
        match self {
            Self::A => Self::B,
            Self::B => Self::A,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum MorphDirection {
    AToB,
    BToA,
}

impl MorphDirection {
    pub fn target_slot(self) -> AbSlot {
        match self {
            Self::AToB => AbSlot::B,
            Self::BToA => AbSlot::A,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct AbSlotData {
    pub source: String,
    pub snapshot: Scene,
    pub captured_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
pub struct MorphState {
    pub direction: MorphDirection,
    pub duration_ms: u32,
    pub elapsed_ms: u32,
    #[serde(default)]
    pub scope: RecallScope,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, utoipa::ToSchema)]
pub struct AbCompareState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot_a: Option<AbSlotData>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot_b: Option<AbSlotData>,
    #[serde(default)]
    pub active: AbSlot,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub morph: Option<MorphState>,
}

impl AbCompareState {
    pub fn slot(&self, slot: AbSlot) -> Option<&AbSlotData> {
        match slot {
            AbSlot::A => self.slot_a.as_ref(),
            AbSlot::B => self.slot_b.as_ref(),
        }
    }

    pub fn set_slot(&mut self, slot: AbSlot, data: Option<AbSlotData>) {
        match slot {
            AbSlot::A => self.slot_a = data,
            AbSlot::B => self.slot_b = data,
        }
    }
}
