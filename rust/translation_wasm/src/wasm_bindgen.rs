// wasm-bindgen exports for async translation operations

use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

#[wasm_bindgen]
pub struct TranslationWasm {
    // Service instances will be managed here
}

#[wasm_bindgen]
impl TranslationWasm {
    #[wasm_bindgen(constructor)]
    pub fn new() -> TranslationWasm {
        TranslationWasm
    }

    #[wasm_bindgen]
    pub async fn translate_text(
        &self,
        service: String,
        source_lang: String,
        target_lang: String,
        text: String,
    ) -> Result<String, JsValue> {
        // This will call the appropriate service
        // For now, return error as this requires full implementation
        Err(JsValue::from_str("Translation not fully implemented yet"))
    }

    #[wasm_bindgen]
    pub async fn translate_html(
        &self,
        _service: String,
        _source_lang: String,
        _target_lang: String,
        _html: String,
        _dont_sort: bool,
    ) -> Result<JsValue, JsValue> {
        // This will call the appropriate service with HTML processing
        Err(JsValue::from_str("Translation not fully implemented yet"))
    }
}

