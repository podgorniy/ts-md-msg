#![deny(clippy::all)]

#[macro_use]
extern crate napi_derive;

use napi::bindgen_prelude::*;
use pulldown_cmark::{html, Options, Parser, Event};

#[napi(object)]
pub struct MarkdownOptions {
    pub enable_tables: Option<bool>,
    pub enable_footnotes: Option<bool>,
    pub enable_strikethrough: Option<bool>,
    pub enable_tasklists: Option<bool>,
    pub enable_smart_punctuation: Option<bool>,
    pub enable_heading_attributes: Option<bool>,
    pub enable_yaml_style_metadata_blocks: Option<bool>,
    pub enable_pluses_delimited_metadata_blocks: Option<bool>,
    pub enable_old_footnotes: Option<bool>,
    pub enable_math: Option<bool>,
    pub enable_gfm: Option<bool>,
}

fn map_options(opts: Option<MarkdownOptions>) -> Options {
    let mut options = Options::empty();
    if let Some(o) = opts {
        if o.enable_tables.unwrap_or(false) { options.insert(Options::ENABLE_TABLES); }
        if o.enable_footnotes.unwrap_or(false) { options.insert(Options::ENABLE_FOOTNOTES); }
        if o.enable_strikethrough.unwrap_or(false) { options.insert(Options::ENABLE_STRIKETHROUGH); }
        if o.enable_tasklists.unwrap_or(false) { options.insert(Options::ENABLE_TASKLISTS); }
        if o.enable_smart_punctuation.unwrap_or(false) { options.insert(Options::ENABLE_SMART_PUNCTUATION); }
        if o.enable_heading_attributes.unwrap_or(false) { options.insert(Options::ENABLE_HEADING_ATTRIBUTES); }
        if o.enable_yaml_style_metadata_blocks.unwrap_or(false) { options.insert(Options::ENABLE_YAML_STYLE_METADATA_BLOCKS); }
        if o.enable_pluses_delimited_metadata_blocks.unwrap_or(false) { options.insert(Options::ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS); }
        if o.enable_old_footnotes.unwrap_or(false) { options.insert(Options::ENABLE_OLD_FOOTNOTES); }
        if o.enable_math.unwrap_or(false) { options.insert(Options::ENABLE_MATH); }
        if o.enable_gfm.unwrap_or(false) { options.insert(Options::ENABLE_GFM); }
    }
    options
}

#[napi]
pub fn render_html(markdown: String, options: Option<MarkdownOptions>) -> String {
    let opts = map_options(options);
    let parser = Parser::new_ext(&markdown, opts);
    let mut html_output = String::new();
    html::push_html(&mut html_output, parser);
    html_output
}

#[napi]
pub fn parse(markdown: String, options: Option<MarkdownOptions>) -> Result<String> {
    let opts = map_options(options);
    let parser = Parser::new_ext(&markdown, opts);
    let events: Vec<Event> = parser.collect();
    serde_json::to_string(&events).map_err(|e| Error::from_reason(e.to_string()))
}
