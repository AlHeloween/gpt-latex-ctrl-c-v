use pulldown_cmark::{html, Options, Parser};

use crate::entities::decode_entities;

fn sanitize_href(href: &str) -> Option<String> {
    let h = href.trim();
    if h.is_empty() {
        return None;
    }
    let low = h.to_ascii_lowercase();
    if low.starts_with("javascript:") || low.starts_with("data:") || low.starts_with("vbscript:") {
        return None;
    }
    Some(h.to_string())
}

fn md_escape_text(s: &str) -> String {
    // Minimal escaping for link text.
    s.replace('[', "\\[").replace(']', "\\]")
}

fn md_format_link(text: &str, href: &str) -> String {
    // Markdown: if URL contains whitespace or parentheses, wrap it in <...> to reduce breakage.
    let needs_angle = href
        .chars()
        .any(|c| c.is_whitespace() || c == '(' || c == ')');
    if needs_angle {
        format!("[{}](<{}>)", md_escape_text(text), href)
    } else {
        format!("[{}]({})", md_escape_text(text), href)
    }
}

pub fn markdown_to_html_string(md: &str) -> String {
    let mut opts = Options::empty();
    opts.insert(Options::ENABLE_TABLES);
    opts.insert(Options::ENABLE_STRIKETHROUGH);
    opts.insert(Options::ENABLE_TASKLISTS);
    opts.insert(Options::ENABLE_FOOTNOTES);
    let parser = Parser::new_ext(md, opts);
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out
}

pub fn html_to_markdown_text(input: &str) -> String {
    // Conservative HTML -> Markdown converter, tuned for our clipboard payloads/examples.
    // Determinism goals:
    // - Preserve fenced code blocks and inline code
    // - Preserve links
    // - Preserve LaTeX from data-math attributes when present
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

    let mut out = String::with_capacity(input.len() / 2);
    let mut i: usize = 0;
    let b = input.as_bytes();

    let mut pre_depth: u32 = 0;
    let mut code_depth: u32 = 0;
    let mut list_stack: Vec<(bool, u32)> = Vec::new(); // (ordered, next_index)
    let mut link_stack: Vec<Option<String>> = Vec::new();
    let mut skip_depth: u32 = 0; // used for "math span" content skipping
    let mut link_text_stack: Vec<String> = Vec::new();

    fn attr_val(raw: &str, name: &str) -> Option<String> {
        let low = raw.to_ascii_lowercase();
        let needle = format!("{name}=");
        let idx = low.find(&needle)?;
        let after = &raw[idx + needle.len()..].trim_start();
        if after.starts_with('"') {
            let rest = &after[1..];
            let end = rest.find('"')?;
            return Some(rest[..end].to_string());
        }
        if after.starts_with('\'') {
            let rest = &after[1..];
            let end = rest.find('\'')?;
            return Some(rest[..end].to_string());
        }
        None
    }

    while i < b.len() {
        let lt_rel = match b[i..].iter().position(|&c| c == b'<') {
            Some(p) => p,
            None => {
                if skip_depth == 0 {
                    if let Some(buf) = link_text_stack.last_mut() {
                        buf.push_str(&input[i..]);
                    } else {
                        out.push_str(&input[i..]);
                    }
                }
                break;
            }
        };
        let lt = i + lt_rel;
        if skip_depth == 0 {
            if let Some(buf) = link_text_stack.last_mut() {
                buf.push_str(&input[i..lt]);
            } else {
                out.push_str(&input[i..lt]);
            }
        }
        i = lt;

        if b[i..].starts_with(b"<!--") {
            if let Some(end) = input[i + 4..].find("-->") {
                i = i + 4 + end + 3;
                continue;
            }
        }

        let Some(gt) = find_tag_end(input, i) else {
            if skip_depth == 0 {
                out.push('<');
            }
            i += 1;
            continue;
        };
        let raw = &input[i + 1..gt];
        let raw_trim = raw.trim();
        let is_end = raw_trim.starts_with('/');
        let tag = raw_trim.trim_start_matches('/').trim();
        if tag.is_empty() {
            i = gt + 1;
            continue;
        }
        let name_end = tag
            .find(|c: char| c.is_whitespace() || c == '/')
            .unwrap_or(tag.len());
        let (name, rest) = tag.split_at(name_end);
        let lower = name.to_ascii_lowercase();
        let self_close = raw_trim.ends_with('/');

        // Generic subtree skipping: once enabled, we keep a simple depth counter until the matching end tag.
        if skip_depth > 0 {
            if is_end {
                skip_depth = skip_depth.saturating_sub(1);
            } else if !self_close {
                skip_depth += 1;
            }
            i = gt + 1;
            continue;
        }

        // MathML blocks: prefer TeX from <annotation encoding="application/x-tex">.
        if !is_end && lower == "math" {
            let math_open = &input[i..=gt];
            let display_block = math_open.to_ascii_lowercase().contains("display=\"block\"");
            if let Some(close_rel) = input[gt + 1..].to_ascii_lowercase().find("</math>") {
                let close_i = gt + 1 + close_rel;
                let inner = &input[gt + 1..close_i];
                let inner_low = inner.to_ascii_lowercase();
                if let Some(a_i) = inner_low.find("<annotation") {
                    let ann = &inner[a_i..];
                    let ann_low = ann.to_ascii_lowercase();
                    if ann_low.contains("encoding=\"application/x-tex\"")
                        || ann_low.contains("encoding='application/x-tex'")
                    {
                        if let Some(gt2) = ann.find('>') {
                            if let Some(end_ann) = ann_low.find("</annotation>") {
                                let tex_raw = &ann[gt2 + 1..end_ann];
                                let tex = decode_entities(tex_raw).trim().to_string();
                                if !tex.is_empty() {
                                    if display_block {
                                        if !out.ends_with("\n\n") {
                                            out.push('\n');
                                            out.push('\n');
                                        }
                                        out.push_str("$$");
                                        out.push_str(&tex);
                                        out.push_str("$$");
                                        out.push('\n');
                                        out.push('\n');
                                    } else {
                                        out.push('$');
                                        out.push_str(&tex);
                                        out.push('$');
                                    }
                                }
                            }
                        }
                    }
                }
                i = close_i + "</math>".len();
                continue;
            }
        }

        // Skip heavy wrappers; content may be huge and not useful for Markdown export.
        if !is_end && (lower == "mjx-container" || lower == "mjx-assistive-mml") {
            skip_depth = 1;
            i = gt + 1;
            continue;
        }

        match (is_end, lower.as_str()) {
            (false, "br") => out.push('\n'),
            (false, "p") | (false, "div") => {
                if !out.ends_with("\n\n") {
                    if !out.ends_with('\n') {
                        out.push('\n');
                    }
                    out.push('\n');
                }
            }
            (true, "p") | (true, "div") => {
                if !out.ends_with("\n\n") {
                    out.push('\n');
                    out.push('\n');
                }
            }
            (false, "h1")
            | (false, "h2")
            | (false, "h3")
            | (false, "h4")
            | (false, "h5")
            | (false, "h6") => {
                let level = lower[1..2].parse::<usize>().unwrap_or(1);
                if !out.ends_with("\n\n") {
                    if !out.ends_with('\n') {
                        out.push('\n');
                    }
                    out.push('\n');
                }
                out.push_str(&"#".repeat(level));
                out.push(' ');
            }
            (true, "h1")
            | (true, "h2")
            | (true, "h3")
            | (true, "h4")
            | (true, "h5")
            | (true, "h6") => {
                if !out.ends_with("\n\n") {
                    out.push('\n');
                    out.push('\n');
                }
            }
            (false, "strong") | (false, "b") => out.push_str("**"),
            (true, "strong") | (true, "b") => out.push_str("**"),
            (false, "em") | (false, "i") => out.push('*'),
            (true, "em") | (true, "i") => out.push('*'),
            (false, "ul") => list_stack.push((false, 1)),
            (true, "ul") => {
                list_stack.pop();
                if !out.ends_with('\n') {
                    out.push('\n');
                }
            }
            (false, "ol") => list_stack.push((true, 1)),
            (true, "ol") => {
                list_stack.pop();
                if !out.ends_with('\n') {
                    out.push('\n');
                }
            }
            (false, "li") => {
                if !out.ends_with('\n') {
                    out.push('\n');
                }
                let indent = "  ".repeat(list_stack.len().saturating_sub(1));
                out.push_str(&indent);
                if let Some((ordered, n)) = list_stack.last_mut() {
                    if *ordered {
                        out.push_str(&format!("{n}. "));
                        *n += 1;
                    } else {
                        out.push_str("- ");
                    }
                } else {
                    out.push_str("- ");
                }
            }
            (true, "li") => {
                if !out.ends_with('\n') {
                    out.push('\n');
                }
            }
            (false, "pre") => {
                if !out.ends_with('\n') {
                    out.push('\n');
                }
                out.push_str("```");
                out.push('\n');
                pre_depth += 1;
            }
            (true, "pre") => {
                if pre_depth > 0 {
                    pre_depth -= 1;
                }
                if !out.ends_with('\n') {
                    out.push('\n');
                }
                out.push_str("```");
                out.push('\n');
            }
            (false, "code") => {
                if pre_depth == 0 {
                    out.push('`');
                }
                code_depth += 1;
            }
            (true, "code") => {
                if code_depth > 0 {
                    code_depth -= 1;
                }
                if pre_depth == 0 {
                    out.push('`');
                }
            }
            (false, "a") => {
                let href = attr_val(rest, "href")
                    .map(|v| decode_entities(&v))
                    .and_then(|v| sanitize_href(&v));
                link_stack.push(href);
                link_text_stack.push(String::new());
            }
            (true, "a") => {
                let href = link_stack.pop().flatten();
                let text_raw = link_text_stack.pop().unwrap_or_default();
                let text = decode_entities(&text_raw);
                if let Some(href) = href {
                    out.push_str(&md_format_link(text.trim(), &href));
                } else {
                    out.push_str(text.trim());
                }
            }
            (false, "span") => {
                let dm = attr_val(rest, "data-math").map(|v| decode_entities(&v));
                if let Some(tex) = dm {
                    let class = attr_val(rest, "class").unwrap_or_default();
                    let display = class.to_ascii_lowercase().contains("math-block");
                    if display {
                        if !out.ends_with("\n\n") {
                            out.push('\n');
                            out.push('\n');
                        }
                        out.push_str("$$");
                        out.push_str(&tex);
                        out.push_str("$$");
                        out.push('\n');
                        out.push('\n');
                    } else {
                        out.push('$');
                        out.push_str(&tex);
                        out.push('$');
                    }
                    // Skip the rendered subtree inside this math span.
                    skip_depth = 1;
                }
            }
            _ => {}
        }

        // This keeps escaping/link formatting deterministic.
        i = gt + 1;
    }

    decode_entities(out.trim().replace("\r\n", "\n").as_str())
}
