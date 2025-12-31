mod ffi;
mod utils;
mod escape;
mod cache;
mod html;
mod service;
mod auth;
mod google;
mod bing;
mod yandex;
mod deepl;
mod libre;
mod ai;
mod custom;

use ffi::{read_utf8, set_error, write_out};
use std::collections::HashMap;
use std::sync::Mutex;
use lazy_static::lazy_static;
use std::sync::atomic::{AtomicU32, Ordering};

// Global service registry
lazy_static! {
    static ref SERVICE_REGISTRY: Mutex<HashMap<String, Box<dyn service::TranslationService + Send + Sync>>> = Mutex::new(HashMap::new());
}

// JavaScript bridge functions (imported from JS)
extern "C" {
    fn http_request(url_ptr: u32, url_len: u32, method_ptr: u32, method_len: u32, headers_ptr: u32, headers_len: u32, body_ptr: u32, body_len: u32, callback_id: u32);
    fn http_request_get_result(callback_id: u32, result_len_ptr: *mut u32) -> u32;
    fn cache_get(key_ptr: u32, key_len: u32, callback_id: u32);
    fn cache_get_result(callback_id: u32, result_len_ptr: *mut u32) -> u32;
    fn cache_set(key_ptr: u32, key_len: u32, value_ptr: u32, value_len: u32) -> u32;
}

// Initialize services
fn init_services() {
    let mut registry = SERVICE_REGISTRY.lock().unwrap();
    
    if !registry.contains_key("google") {
        registry.insert("google".to_string(), Box::new(google::GoogleService::new()));
    }
    if !registry.contains_key("bing") {
        registry.insert("bing".to_string(), Box::new(bing::BingService::new()));
    }
    if !registry.contains_key("yandex") {
        registry.insert("yandex".to_string(), Box::new(yandex::YandexService::new()));
    }
    if !registry.contains_key("deepl") {
        registry.insert("deepl".to_string(), Box::new(deepl::DeepLService::new(None)));
    }
    if !registry.contains_key("libre") {
        registry.insert("libre".to_string(), Box::new(libre::LibreService::new("".to_string(), None)));
    }
    if !registry.contains_key("chatgpt") {
        registry.insert("chatgpt".to_string(), Box::new(ai::ChatGPTService::new("".to_string())));
    }
    if !registry.contains_key("gemini") {
        registry.insert("gemini".to_string(), Box::new(ai::GeminiService::new("".to_string())));
    }
    if !registry.contains_key("pollinations") {
        registry.insert("pollinations".to_string(), Box::new(ai::PollinationsService::new(None, None)));
    }
    if !registry.contains_key("custom") {
        let custom_config = custom::CustomApiConfig {
            endpoint: "".to_string(),
            method: "POST".to_string(),
            headers: HashMap::new(),
            payload_format: custom::PayloadFormat {
                template: None,
                extra: HashMap::new(),
            },
        };
        registry.insert("custom".to_string(), Box::new(custom::CustomService::new(custom_config)));
    }
}

// Service configuration storage
struct ServiceConfig {
    api_keys: HashMap<String, String>,
    custom_services: HashMap<String, custom::CustomApiConfig>,
}

static SERVICE_CONFIG: Mutex<Option<ServiceConfig>> = Mutex::new(None);

fn init_config() {
    let mut config = SERVICE_CONFIG.lock().unwrap();
    if config.is_none() {
        *config = Some(ServiceConfig {
            api_keys: HashMap::new(),
            custom_services: HashMap::new(),
        });
    }
}

// Initialize services on first API call
#[no_mangle]
pub extern "C" fn translation_api_version() -> u32 {
    init_services();
    1
}

#[no_mangle]
pub extern "C" fn set_api_key(
    service_ptr: u32,
    service_len: u32,
    key_ptr: u32,
    key_len: u32,
) {
    init_config();
    let service = match read_utf8(service_ptr, service_len) {
        Ok(s) => s,
        Err(_) => return,
    };
    let key = match read_utf8(key_ptr, key_len) {
        Ok(s) => s,
        Err(_) => return,
    };
    
    let mut config = SERVICE_CONFIG.lock().unwrap();
    if let Some(ref mut cfg) = *config {
        cfg.api_keys.insert(service.to_string(), key.to_string());
    }
}

#[no_mangle]
pub extern "C" fn set_custom_service(config_ptr: u32, config_len: u32) {
    init_config();
    let config_str = match read_utf8(config_ptr, config_len) {
        Ok(s) => s,
        Err(_) => return,
    };
    
    match serde_json::from_str::<custom::CustomApiConfig>(config_str) {
        Ok(custom_config) => {
            let mut cfg = SERVICE_CONFIG.lock().unwrap();
            if let Some(ref mut c) = *cfg {
                // Use service name from config or generate one
                let service_name = "custom".to_string(); // Could be extracted from config
                c.custom_services.insert(service_name, custom_config);
            }
        }
        Err(_) => {}
    }
}

#[no_mangle]
pub extern "C" fn clear_translation_cache() {
    // Cache clearing will be handled via JavaScript bridge
    // This is a placeholder
}

#[no_mangle]
pub extern "C" fn remove_translations_with_error() {
    let mut manager = service::ServiceManager::new();
    manager.remove_translations_with_error();
}

// Translation functions - these prepare requests and parse responses
// JavaScript handles the async HTTP part

#[no_mangle]
pub extern "C" fn translate_text(
    service_ptr: u32,
    service_len: u32,
    source_lang_ptr: u32,
    source_lang_len: u32,
    target_lang_ptr: u32,
    target_lang_len: u32,
    text_ptr: u32,
    text_len: u32,
) -> u32 {
    init_services();
    init_config();
    
    let service_name = match read_utf8(service_ptr, service_len) {
        Ok(s) => s,
        Err(_) => {
            set_error(1, "Invalid service parameter");
            return 0;
        }
    };
    
    let source_lang = match read_utf8(source_lang_ptr, source_lang_len) {
        Ok(s) => s,
        Err(_) => {
            set_error(1, "Invalid source_lang parameter");
            return 0;
        }
    };
    
    let target_lang = match read_utf8(target_lang_ptr, target_lang_len) {
        Ok(s) => s,
        Err(_) => {
            set_error(1, "Invalid target_lang parameter");
            return 0;
        }
    };
    
    let text = match read_utf8(text_ptr, text_len) {
        Ok(s) => s,
        Err(_) => {
            set_error(1, "Invalid text parameter");
            return 0;
        }
    };
    
    // Get service from registry
    let registry = SERVICE_REGISTRY.lock().unwrap();
    let service = match registry.get(service_name) {
        Some(s) => s,
        None => {
            set_error(1, &format!("Unknown service: {}", service_name));
            return 0;
        }
    };
    
    // Prepare request using service
    let source_array = vec![text.to_string()];
    let transformed = service.transform_request(&source_array);
    let transformed_text = transformed.clone();
    let requests = vec![service::TranslationInfo {
        original_text: transformed,
        translated_text: None,
        detected_language: None,
        status: service::TranslationStatus::Translating,
    }];
    
    let extra_params = service.get_extra_parameters(source_lang, target_lang, &requests);
    let request_body = service.get_request_body(source_lang, target_lang, &requests);
    let extra_headers = service.get_extra_headers();
    let base_url = service.get_base_url();
    let method = service.get_method();
    
    // Build full URL
    let url = if extra_params.is_empty() {
        base_url
    } else {
        format!("{}{}", base_url, extra_params)
    };
    
    // Check cache first
    let cache_key = cache::get_cache_key(service_name, source_lang, target_lang, &transformed_text);
    let cache_key_bytes = cache_key.as_bytes();
    let cache_key_ptr = ffi::alloc(cache_key_bytes.len() as u32);
    unsafe {
        std::ptr::copy_nonoverlapping(cache_key_bytes.as_ptr(), cache_key_ptr as *mut u8, cache_key_bytes.len());
    }
    
    use std::sync::atomic::{AtomicU32, Ordering};
    static CACHE_CALLBACK_ID: AtomicU32 = AtomicU32::new(1);
    let cache_callback_id = CACHE_CALLBACK_ID.fetch_add(1, Ordering::Relaxed);
    
    unsafe {
        cache_get(cache_key_ptr, cache_key_bytes.len() as u32, cache_callback_id);
    }
    ffi::dealloc(cache_key_ptr, cache_key_bytes.len() as u32);
    
    // Poll for cache result
    let mut cache_result_len = 0u32;
    let mut cache_attempts = 0;
    let cache_result_ptr = loop {
        unsafe {
            let ptr = cache_get_result(cache_callback_id, &mut cache_result_len);
            if ptr != 0 {
                break ptr;
            }
        }
        cache_attempts += 1;
        if cache_attempts > 100 {
            break 0; // Timeout, proceed with HTTP request
        }
        // Simple busy-wait (in WASM, we can't use threads, so this is acceptable)
        // JavaScript will complete the async operation quickly
        unsafe {
            // Use a simple loop to wait (WASM doesn't have sleep)
            for _ in 0..1000 {
                std::hint::spin_loop();
            }
        }
    };
    
    // If cache hit, return cached result
    if cache_result_ptr != 0 {
        let cache_result_bytes = unsafe {
            std::slice::from_raw_parts(cache_result_ptr as *const u8, cache_result_len as usize)
        };
        if let Ok(cache_result_str) = String::from_utf8(cache_result_bytes.to_vec()) {
            if let Ok(cache_entry) = serde_json::from_str::<cache::CacheEntry>(&cache_result_str) {
                ffi::dealloc(cache_result_ptr, cache_result_len);
                return write_out(&cache_entry.translated_text);
            }
        }
        ffi::dealloc(cache_result_ptr, cache_result_len);
    }
    
    // No cache hit, make HTTP request via bridge
    let url_bytes = url.as_bytes();
    let method_bytes = method.as_bytes();
    let headers_json = serde_json::to_string(&extra_headers).unwrap_or_else(|_| "[]".to_string());
    let headers_bytes = headers_json.as_bytes();
    let body_bytes = request_body.as_ref().map(|s| s.as_bytes()).unwrap_or(&[]);
    
    // Allocate memory for HTTP request
    let url_ptr = ffi::alloc(url_bytes.len() as u32);
    let method_ptr = ffi::alloc(method_bytes.len() as u32);
    let headers_ptr = ffi::alloc(headers_bytes.len() as u32);
    let body_ptr = if request_body.is_some() { ffi::alloc(body_bytes.len() as u32) } else { 0 };
    
    unsafe {
        std::ptr::copy_nonoverlapping(url_bytes.as_ptr(), url_ptr as *mut u8, url_bytes.len());
        std::ptr::copy_nonoverlapping(method_bytes.as_ptr(), method_ptr as *mut u8, method_bytes.len());
        std::ptr::copy_nonoverlapping(headers_bytes.as_ptr(), headers_ptr as *mut u8, headers_bytes.len());
        if request_body.is_some() {
            std::ptr::copy_nonoverlapping(body_bytes.as_ptr(), body_ptr as *mut u8, body_bytes.len());
        }
    }
    
    // Generate callback ID for HTTP request
    static HTTP_CALLBACK_ID: AtomicU32 = AtomicU32::new(1);
    let http_callback_id = HTTP_CALLBACK_ID.fetch_add(1, Ordering::Relaxed);
    
    // Call HTTP bridge
    unsafe {
        http_request(
            url_ptr, url_bytes.len() as u32,
            method_ptr, method_bytes.len() as u32,
            headers_ptr, headers_bytes.len() as u32,
            body_ptr, body_bytes.len() as u32,
            http_callback_id,
        );
    }
    
    // Clean up request memory
    ffi::dealloc(url_ptr, url_bytes.len() as u32);
    ffi::dealloc(method_ptr, method_bytes.len() as u32);
    ffi::dealloc(headers_ptr, headers_bytes.len() as u32);
    if request_body.is_some() {
        ffi::dealloc(body_ptr, body_bytes.len() as u32);
    }
    
    // Poll for HTTP result
    let mut http_result_len = 0u32;
    let mut http_attempts = 0;
    let http_result_ptr = loop {
        unsafe {
            let ptr = http_request_get_result(http_callback_id, &mut http_result_len);
            if ptr != 0 {
                break ptr;
            }
        }
        http_attempts += 1;
        if http_attempts > 1000 {
            set_error(1, "HTTP request timeout");
            return 0;
        }
        // Simple busy-wait (WASM doesn't have threads)
        unsafe {
            for _ in 0..1000 {
                std::hint::spin_loop();
            }
        }
    };
    
    // Read HTTP response
    let http_result_bytes = unsafe {
        std::slice::from_raw_parts(http_result_ptr as *const u8, http_result_len as usize)
    };
    let http_result_str = match String::from_utf8(http_result_bytes.to_vec()) {
        Ok(s) => s,
        Err(_) => {
            ffi::dealloc(http_result_ptr, http_result_len);
            set_error(1, "Invalid UTF-8 in HTTP response");
            return 0;
        }
    };
    ffi::dealloc(http_result_ptr, http_result_len);
    
    let http_result: serde_json::Value = match serde_json::from_str(&http_result_str) {
        Ok(v) => v,
        Err(e) => {
            set_error(1, &format!("Failed to parse HTTP response: {}", e));
            return 0;
        }
    };
    
    // Check if HTTP request was successful
    if !http_result.get("ok").and_then(|v| v.as_bool()).unwrap_or(false) {
        let error_msg = http_result.get("statusText").and_then(|v| v.as_str()).unwrap_or("HTTP request failed");
        set_error(1, error_msg);
        return 0;
    }
    
    let response_text = http_result.get("text").and_then(|v| v.as_str()).unwrap_or("");
    
    // Parse response using service
    match service.parse_response(response_text) {
        Ok(results) => {
            if let Some((translated, detected_lang)) = results.first() {
                let transformed = service.transform_response(translated, false);
                if let Some(result) = transformed.first() {
                    // Store in cache
                    let cache_entry = cache::CacheEntry {
                        translated_text: result.clone(),
                        detected_language: detected_lang.clone().unwrap_or_else(|| "unknown".to_string()),
                    };
                    let cache_entry_json = serde_json::to_string(&cache_entry).unwrap_or_else(|_| "{}".to_string());
                    let cache_entry_bytes = cache_entry_json.as_bytes();
                    let cache_key_ptr2 = ffi::alloc(cache_key_bytes.len() as u32);
                    let cache_entry_ptr = ffi::alloc(cache_entry_bytes.len() as u32);
                    unsafe {
                        std::ptr::copy_nonoverlapping(cache_key_bytes.as_ptr(), cache_key_ptr2 as *mut u8, cache_key_bytes.len());
                        std::ptr::copy_nonoverlapping(cache_entry_bytes.as_ptr(), cache_entry_ptr as *mut u8, cache_entry_bytes.len());
                    }
                    unsafe {
                        cache_set(cache_key_ptr2, cache_key_bytes.len() as u32, cache_entry_ptr, cache_entry_bytes.len() as u32);
                    }
                    ffi::dealloc(cache_key_ptr2, cache_key_bytes.len() as u32);
                    ffi::dealloc(cache_entry_ptr, cache_entry_bytes.len() as u32);
                    
                    write_out(result)
                } else {
                    set_error(1, "No translation result");
                    0
                }
            } else {
                set_error(1, "Empty translation results");
                0
            }
        }
        Err(e) => {
            set_error(1, &e);
            0
        }
    }
}

// Parse HTTP response and return translated text
#[no_mangle]
pub extern "C" fn parse_translation_response(
    service_ptr: u32,
    service_len: u32,
    response_ptr: u32,
    response_len: u32,
) -> u32 {
    init_services();
    
    let service_name = match read_utf8(service_ptr, service_len) {
        Ok(s) => s,
        Err(_) => {
            set_error(1, "Invalid service parameter");
            return 0;
        }
    };
    
    let response = match read_utf8(response_ptr, response_len) {
        Ok(s) => s,
        Err(_) => {
            set_error(1, "Invalid response parameter");
            return 0;
        }
    };
    
    // Get service from registry
    let registry = SERVICE_REGISTRY.lock().unwrap();
    let service = match registry.get(service_name) {
        Some(s) => s,
        None => {
            set_error(1, &format!("Unknown service: {}", service_name));
            return 0;
        }
    };
    
    // Parse response
    match service.parse_response(response) {
        Ok(results) => {
            if let Some((translated, _)) = results.first() {
                let transformed = service.transform_response(translated, false);
                if let Some(result) = transformed.first() {
                    write_out(result)
                } else {
                    set_error(1, "No translation result");
                    0
                }
            } else {
                set_error(1, "Empty translation results");
                0
            }
        }
        Err(e) => {
            set_error(1, &e);
            0
        }
    }
}

// Legacy function stubs for compatibility
#[no_mangle]
pub extern "C" fn translate_html(
    service_ptr: u32,
    service_len: u32,
    source_lang_ptr: u32,
    source_lang_len: u32,
    target_lang_ptr: u32,
    target_lang_len: u32,
    html_ptr: u32,
    html_len: u32,
    _dont_sort_ptr: u32,
    _dont_sort_len: u32,
) -> u32 {
    // For HTML, treat as text for now (HTML-aware translation can be added later)
    translate_text(service_ptr, service_len, source_lang_ptr, source_lang_len, target_lang_ptr, target_lang_len, html_ptr, html_len)
}

#[no_mangle]
pub extern "C" fn translate_single_text(
    service_ptr: u32,
    service_len: u32,
    source_lang_ptr: u32,
    source_lang_len: u32,
    target_lang_ptr: u32,
    target_lang_len: u32,
    text_ptr: u32,
    text_len: u32,
) -> u32 {
    translate_text(service_ptr, service_len, source_lang_ptr, source_lang_len, target_lang_ptr, target_lang_len, text_ptr, text_len)
}
