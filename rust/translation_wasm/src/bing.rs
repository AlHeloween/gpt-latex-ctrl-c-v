// Bing/Microsoft Translator service implementation

use crate::escape::escape_html;
use crate::service::{TranslationInfo, TranslationService};
use crate::utils::url_encode;
use serde_json::json;

pub struct BingService {
    api_key: Option<String>,
    region: Option<String>,
    use_edge_endpoint: bool,
    auth_helper: crate::auth::BingHelper,
}

impl BingService {
    pub fn new() -> Self {
        Self {
            api_key: None,
            region: None,
            use_edge_endpoint: true, // Use edge endpoint by default (TWP approach)
            auth_helper: crate::auth::BingHelper::new(),
        }
    }

    pub fn set_api_key(&mut self, key: String, region: Option<String>) {
        self.api_key = Some(key);
        self.region = region;
    }

    pub fn use_free_endpoint(&mut self) {
        self.use_edge_endpoint = false;
    }
}


fn map_language_code(lang: &str) -> String {
    // Language code mappings from TWP
    match lang {
        "auto" => "auto-detect".to_string(),
        "zh-CN" => "zh-Hans".to_string(),
        "zh-TW" => "zh-Hant".to_string(),
        "tl" => "fil".to_string(),
        "hmn" => "mww".to_string(),
        "ku" => "kmr".to_string(),
        "ckb" => "ku".to_string(),
        "mn" => "mn-Cyrl".to_string(),
        "no" => "nb".to_string(),
        "lg" => "lug".to_string(),
        "sr" => "sr-Cyrl".to_string(),
        "mni-Mtei" => "mni".to_string(),
        _ => lang.to_string(),
    }
}

impl TranslationService for BingService {
    fn service_name(&self) -> &str {
        "bing"
    }

    fn transform_request(&self, source_array: &[String]) -> String {
        // Wrap each text in <b{id}> tags
        source_array
            .iter()
            .enumerate()
            .map(|(i, text)| {
                let id = i + 10;
                format!("<b{}>{}</b{}>", id, escape_html(text), id)
            })
            .collect::<Vec<_>>()
            .join("")
    }

    fn parse_response(&self, response: &str) -> Result<Vec<(String, Option<String>)>, String> {
        use serde_json::Value;
        
        let json: Value = serde_json::from_str(response)
            .map_err(|e| format!("JSON parse error: {}", e))?;

        let mut results = Vec::new();
        
        if let Some(array) = json.as_array() {
            for item in array {
                if let Some(obj) = item.as_object() {
                    if let Some(translations) = obj.get("translations").and_then(|v| v.as_array()) {
                        if let Some(trans) = translations.get(0) {
                            if let Some(text) = trans.get("text").and_then(|v| v.as_str()) {
                                let detected = obj
                                    .get("detectedLanguage")
                                    .and_then(|v| v.get("language"))
                                    .and_then(|v| v.as_str())
                                    .map(|s| s.to_string());
                                results.push((text.to_string(), detected));
                            }
                        }
                    }
                }
            }
        }

        Ok(results)
    }

    fn transform_response(&self, result: &str, dont_sort: bool) -> Vec<String> {
        // Parse HTML response with <b{id}> tags
        use html5ever::parse_document;
        use html5ever::tendril::TendrilSink;
        use markup5ever_rcdom::{Handle, NodeData, RcDom};

        let dom = parse_document(RcDom::default(), Default::default()).one(result);
        let mut results: Vec<(usize, String)> = Vec::new();
        let mut current_text = String::new();

        fn walk(node: &Handle, results: &mut Vec<(usize, String)>, current_text: &mut String, dont_sort: bool) {
            match &node.data {
                NodeData::Text { contents } => {
                    current_text.push_str(&contents.borrow().to_string());
                }
                NodeData::Element { name, .. } => {
                    let tag = name.local.to_string();
                    if tag.starts_with('b') && tag.len() > 1 {
                        if let Ok(id) = tag[1..].parse::<usize>() {
                            let text = current_text.clone();
                            if dont_sort {
                                results.push((results.len(), text));
                            } else {
                                results.push((id.saturating_sub(10), text));
                            }
                            current_text.clear();
                        }
                    }
                    for child in node.children.borrow().iter() {
                        walk(child, results, current_text, dont_sort);
                    }
                }
                _ => {
                    for child in node.children.borrow().iter() {
                        walk(child, results, current_text, dont_sort);
                    }
                }
            }
        }

        walk(&dom.document, &mut results, &mut current_text, dont_sort);

        if !dont_sort {
            results.sort_by_key(|(idx, _)| *idx);
        }

        results.into_iter().map(|(_, text)| text).collect()
    }

    fn get_extra_parameters(
        &self,
        source_lang: &str,
        target_lang: &str,
        _requests: &[TranslationInfo],
    ) -> String {
        let source = map_language_code(source_lang);
        let target = map_language_code(target_lang);
        
        let mut params = format!("&to={}", url_encode(&target));
        if source != "auto-detect" {
            params.push_str(&format!("&from={}", url_encode(&source)));
        }
        params.push_str("&includeSentenceLength=true");
        params
    }

    fn get_request_body(
        &self,
        _source_lang: &str,
        _target_lang: &str,
        requests: &[TranslationInfo],
    ) -> Option<String> {
        let body: Vec<serde_json::Value> = requests
            .iter()
            .map(|r| json!({ "text": r.original_text }))
            .collect();
        Some(json!(body).to_string())
    }

    fn get_extra_headers(&self) -> Vec<(String, String)> {
        let mut headers = vec![("Content-Type".to_string(), "application/json".to_string())];
        
        if let Some(ref api_key) = self.api_key {
            headers.push(("Ocp-Apim-Subscription-Key".to_string(), api_key.clone()));
            if let Some(ref region) = self.region {
                headers.push(("Ocp-Apim-Subscription-Region".to_string(), region.clone()));
            }
        } else if self.use_edge_endpoint {
            // Try to get auth from helper for free endpoint
            if let Some(auth) = self.auth_helper.get_auth() {
                headers.push(("Authorization".to_string(), format!("Bearer {}", auth)));
            }
        }
        
        headers
    }

    fn get_base_url(&self) -> String {
        if self.use_edge_endpoint {
            "https://api-edge.cognitive.microsofttranslator.com/translate?api-version=3.0".to_string()
        } else if self.api_key.is_some() {
            "https://api.cognitive.microsofttranslator.com/translate?api-version=3.0".to_string()
        } else {
            "https://api.translator.microsoft.com/translate?api-version=3.0".to_string()
        }
    }

    fn get_method(&self) -> &str {
        "POST"
    }
}

impl Default for BingService {
    fn default() -> Self {
        Self::new()
    }
}

