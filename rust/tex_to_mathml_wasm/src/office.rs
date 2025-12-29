pub fn html_to_office_html(input: &str) -> String {
    // "Transition table" (HTML -> Office-friendly HTML):
    // - Normalize semantic tags to stable equivalents
    // - Add minimal inline styles for predictable Word paste
    //
    // NOTE: This is intentionally conservative: it avoids rewriting existing style attributes or
    // touching msEquation conditional comments (OMML) which must stay byte-identical.
    fn find_tag_end(s: &str, lt: usize) -> Option<usize> {
        let bytes = s.as_bytes();
        let mut i = lt;
        let mut in_s = false;
        let mut in_d = false;
        while i < bytes.len() {
            let c = bytes[i] as char;
            match c {
                '\'' if !in_d => in_s = !in_s,
                '"' if !in_s => in_d = !in_d,
                '>' if !in_s && !in_d => return Some(i),
                _ => {}
            }
            i += 1;
        }
        None
    }

    let mut out = String::with_capacity(input.len() + (input.len() / 10));
    let mut i: usize = 0;
    let bytes = input.as_bytes();

    while i < bytes.len() {
        let lt_rel = match bytes[i..].iter().position(|&c| c == b'<') {
            Some(p) => p,
            None => {
                out.push_str(&input[i..]);
                break;
            }
        };
        let lt = i + lt_rel;
        out.push_str(&input[i..lt]);
        i = lt;

        // Preserve comments verbatim (especially Office conditional comments).
        if bytes[i..].starts_with(b"<!--") {
            if let Some(end) = input[i + 4..].find("-->") {
                let j = i + 4 + end + 3;
                out.push_str(&input[i..j]);
                i = j;
                continue;
            }
        }

        let Some(gt) = find_tag_end(input, i) else {
            out.push('<');
            i += 1;
            continue;
        };
        let raw = &input[i + 1..gt];
        let raw_trim = raw.trim();
        let is_end = raw_trim.starts_with('/');
        let tag = raw_trim.trim_start_matches('/').trim();
        if tag.is_empty() {
            out.push_str(&input[i..=gt]);
            i = gt + 1;
            continue;
        }
        let name_end = tag
            .find(|c: char| c.is_whitespace() || c == '/')
            .unwrap_or(tag.len());
        let (name, rest) = tag.split_at(name_end);
        let lower = name.to_ascii_lowercase();

        let mapped = match lower.as_str() {
            "strong" => "b",
            "em" => "i",
            _ => name,
        };

        if is_end {
            out.push_str("</");
            out.push_str(mapped);
            out.push('>');
            i = gt + 1;
            continue;
        }

        let self_close = raw_trim.ends_with('/');
        let mut extra_style: Option<&'static str> = None;

        match lower.as_str() {
            "code" => extra_style = Some("font-family:Consolas, 'Courier New', monospace; background:#f5f5f5; padding:0 2px; border-radius:2px;"),
            "pre" => extra_style = Some("font-family:Consolas, 'Courier New', monospace; background:#f5f5f5; padding:8px; border-radius:4px; white-space:pre-wrap;"),
            "a" => extra_style = Some("color:#1155cc; text-decoration:underline;"),
            "blockquote" => extra_style = Some("border-left:3px solid #ccc; margin:0 0 0 0; padding-left:12px; color:#555;"),
            "table" => extra_style = Some("border-collapse:collapse;"),
            "th" | "td" => extra_style = Some("border:1px solid #ddd; padding:4px 6px;"),
            "ul" | "ol" => extra_style = Some("margin:0 0 0 0; padding-left:40px;"),
            "li" => extra_style = Some("margin:0 0 0 0;"),
            "img" => extra_style = Some("max-width:100%; height:auto; vertical-align:middle;"),
            _ => {}
        }

        out.push('<');
        out.push_str(mapped);

        let rest_str = rest.to_string();
        let has_style = rest_str.to_ascii_lowercase().contains(" style=");
        out.push_str(rest_str.as_str());
        if let Some(style) = extra_style {
            if !has_style {
                out.push_str(" style=\"");
                out.push_str(style);
                out.push('"');
            }
        }
        if self_close {
            out.push_str("/>");
        } else {
            out.push('>');
        }
        i = gt + 1;
    }

    out
}
