// HTML escaping/unescaping utilities, ported from TWP's Utils.escapeHTML and Utils.unescapeHTML

pub fn escape_html(unsafe_text: &str) -> String {
    // TWP's escapeHTML preserves certain markers for Bing dictionary feature
    let bing_mark_front = "<mstrans:dictionary translation=\"";
    let bing_mark_second = "\"></mstrans:dictionary>";
    
    let mut text = unsafe_text.to_string();
    
    // Replace markers with placeholders
    text = text.replace(bing_mark_front, "@-/629^*");
    text = text.replace(bing_mark_second, "^$537+*");
    
    // Escape HTML entities
    text = text.replace('&', "&amp;");
    text = text.replace('<', "&lt;");
    text = text.replace('>', "&gt;");
    text = text.replace('"', "&quot;");
    text = text.replace('\'', "&#39;");
    
    // Restore markers
    text = text.replace("@-/629^*", bing_mark_front);
    text = text.replace("^$537+*", bing_mark_second);
    
    text
}

pub fn unescape_html(escaped: &str) -> String {
    escaped
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_escape_html() {
        assert_eq!(escape_html("a & b"), "a &amp; b");
        assert_eq!(escape_html("<tag>"), "&lt;tag&gt;");
        assert_eq!(escape_html("\"quote\""), "&quot;quote&quot;");
    }

    #[test]
    fn test_unescape_html() {
        assert_eq!(unescape_html("a &amp; b"), "a & b");
        assert_eq!(unescape_html("&lt;tag&gt;"), "<tag>");
        assert_eq!(unescape_html("&quot;quote&quot;"), "\"quote\"");
    }
}

