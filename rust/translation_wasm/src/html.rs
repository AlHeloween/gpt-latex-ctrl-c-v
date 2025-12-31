// HTML-aware translation processing
// Ports TWP's HTML wrapping and parsing logic

use crate::escape::{escape_html, unescape_html};
use html5ever::parse_document;
use html5ever::tendril::TendrilSink;
use markup5ever_rcdom::{Handle, NodeData, RcDom};

pub fn wrap_html_for_translation(html: &str) -> String {
    // For Google's HTML translation endpoint, wrap text in <pre> with <a i={index}> markers
    let dom = parse_document(RcDom::default(), Default::default()).one(html);
    let mut out = String::new();
    let mut index = 0;

    fn walk(node: &Handle, out: &mut String, index: &mut usize) {
        match &node.data {
            NodeData::Text { contents } => {
                let text = contents.borrow().to_string();
                if !text.trim().is_empty() {
                    let escaped = escape_html(&text);
                    out.push_str(&format!("<a i={}>{}</a>", *index, escaped));
                    *index += 1;
                }
            }
            NodeData::Element { name, attrs, .. } => {
                let tag = name.local.to_string();
                out.push('<');
                out.push_str(&tag);
                
                // Preserve attributes
                for attr in attrs.borrow().iter() {
                    out.push(' ');
                    out.push_str(&attr.name.local.to_string());
                    out.push_str("=\"");
                    out.push_str(&escape_html(&attr.value.to_string()));
                    out.push('"');
                }
                
                out.push('>');
                
                for child in node.children.borrow().iter() {
                    walk(child, out, index);
                }
                
                out.push_str("</");
                out.push_str(&tag);
                out.push('>');
            }
            _ => {
                for child in node.children.borrow().iter() {
                    walk(child, out, index);
                }
            }
        }
    }

    // Find body or use document root
    fn find_body(dom: &RcDom) -> Option<Handle> {
        fn find_elem(node: &Handle, name: &str) -> Option<Handle> {
            if let NodeData::Element { name: q, .. } = &node.data {
                if q.local.to_string().eq_ignore_ascii_case(name) {
                    return Some(node.clone());
                }
            }
            for c in node.children.borrow().iter() {
                if let Some(x) = find_elem(c, name) {
                    return Some(x);
                }
            }
            None
        }
        find_elem(&dom.document, "body")
    }

    if let Some(body) = find_body(&dom) {
        out.push_str("<pre>");
        walk(&body, &mut out, &mut index);
        out.push_str("</pre>");
    }

    out
}

pub fn parse_google_html_response(response: &str) -> Result<Vec<String>, String> {
    // Parse Google's HTML translation response format
    // Response format: [[["translated", ...], ["detected_lang"]]]
    // For HTML endpoint, response contains <b> tags with translated text and <i> tags with original
    
    let mut results = Vec::new();
    
    // Extract text from <a i={index}> tags
    let re = regex::Regex::new(r"<a\s+i=(\d+)>([^<]*)</a>").unwrap();
    let mut matches: Vec<(usize, String)> = Vec::new();
    
    for cap in re.captures_iter(response) {
        let index: usize = cap[1].parse().unwrap_or(0);
        let text = unescape_html(&cap[2]);
        matches.push((index, text));
    }
    
    // Sort by index and extract text
    matches.sort_by_key(|(idx, _)| *idx);
    for (_, text) in matches {
        results.push(text);
    }
    
    if results.is_empty() {
        // Fallback: try to extract from <b> tags (sentence markers)
        let b_re = regex::Regex::new(r"<b>([^<]*)</b>").unwrap();
        for cap in b_re.captures_iter(response) {
            results.push(unescape_html(&cap[1]));
        }
    }
    
    Ok(results)
}

pub fn parse_google_json_response(response: &str) -> Result<(Vec<String>, Option<String>), String> {
    // Parse Google's JSON translation response
    // Format: [[["translated", null, null, 0]], ["detected_lang"]]
    use serde_json::Value;
    
    let json: Value = serde_json::from_str(response)
        .map_err(|e| format!("JSON parse error: {}", e))?;
    
    let mut translations = Vec::new();
    let mut detected_lang = None;
    
    if let Some(array) = json.as_array() {
        if let Some(trans_array) = array.get(0).and_then(|v| v.as_array()) {
            for item in trans_array {
                if let Some(inner) = item.as_array() {
                    if let Some(text) = inner.get(0).and_then(|v| v.as_str()) {
                        translations.push(text.to_string());
                    }
                }
            }
        }
        
        if let Some(detected) = array.get(1).and_then(|v| v.as_array()) {
            if let Some(lang) = detected.get(0).and_then(|v| v.as_str()) {
                detected_lang = Some(lang.to_string());
            }
        }
    }
    
    Ok((translations, detected_lang))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wrap_html() {
        let html = "<p>Hello <b>world</b></p>";
        let wrapped = wrap_html_for_translation(html);
        assert!(wrapped.contains("<pre>"));
        assert!(wrapped.contains("<a i="));
    }
}

