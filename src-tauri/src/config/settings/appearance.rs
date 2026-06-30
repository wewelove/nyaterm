use super::super::{default_false, default_true};
use crate::utils::fonts::{
    DEFAULT_TERMINAL_FONT_FAMILY, DEFAULT_UI_FONT_FAMILY, normalize_terminal_font_family,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettings {
    #[serde(default = "default_app_theme")]
    pub theme: String,
    #[serde(default = "default_font")]
    pub font_family: String,
    #[serde(default = "default_ui_font")]
    pub ui_font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: f64,
    #[serde(default = "default_font_weight")]
    pub font_weight: u16,
    #[serde(default = "default_font_weight_bold")]
    pub font_weight_bold: u16,
    #[serde(default = "default_opacity")]
    pub background_opacity: f64,
    #[serde(default)]
    pub background_image_path: Option<String>,
    #[serde(default = "default_background_image_fit")]
    pub background_image_fit: String,
    #[serde(default = "default_background_image_opacity")]
    pub background_image_opacity: f64,
    #[serde(default = "default_cursor_style")]
    pub cursor_style: String,
    #[serde(default = "default_true")]
    pub cursor_blink: bool,
    #[serde(default = "default_ui_font_size")]
    pub ui_font_size: f64,
    #[serde(default)]
    pub terminal_theme: Option<String>,
    #[serde(default = "default_minimum_contrast_ratio")]
    pub minimum_contrast_ratio: f64,
    #[serde(default = "default_false")]
    pub panel_multi_open: bool,
}

fn default_app_theme() -> String {
    "github-dark".to_string()
}
fn default_font() -> String {
    DEFAULT_TERMINAL_FONT_FAMILY.to_string()
}
fn default_ui_font() -> String {
    DEFAULT_UI_FONT_FAMILY.to_string()
}
fn default_font_size() -> f64 {
    16.0
}
fn default_font_weight() -> u16 {
    400
}
fn default_font_weight_bold() -> u16 {
    700
}
fn default_opacity() -> f64 {
    1.0
}
fn default_background_image_fit() -> String {
    "cover".to_string()
}
fn default_background_image_opacity() -> f64 {
    0.45
}
fn default_cursor_style() -> String {
    "block".to_string()
}
fn default_ui_font_size() -> f64 {
    16.0
}
fn default_minimum_contrast_ratio() -> f64 {
    1.0
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: default_app_theme(),
            font_family: default_font(),
            ui_font_family: default_ui_font(),
            font_size: default_font_size(),
            font_weight: default_font_weight(),
            font_weight_bold: default_font_weight_bold(),
            background_opacity: default_opacity(),
            background_image_path: None,
            background_image_fit: default_background_image_fit(),
            background_image_opacity: default_background_image_opacity(),
            cursor_style: default_cursor_style(),
            cursor_blink: true,
            ui_font_size: default_ui_font_size(),
            terminal_theme: None,
            minimum_contrast_ratio: default_minimum_contrast_ratio(),
            panel_multi_open: false,
        }
    }
}

impl AppearanceSettings {
    pub fn normalize_terminal_font_family(&mut self) -> bool {
        let normalized = normalize_terminal_font_family(&self.font_family);
        if normalized == self.font_family.trim() {
            return false;
        }
        self.font_family = normalized;
        true
    }
}
