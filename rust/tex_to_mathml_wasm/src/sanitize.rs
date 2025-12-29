use html5ever::tendril::TendrilSink;
use html5ever::parse_document;
use markup5ever_rcdom::{Handle, NodeData, RcDom};
use std::collections::HashMap;

fn parse_to_dom(input: &str) -> RcDom {
    parse_document(RcDom::default(), Default::default()).one(input)
}

fn node_children(h: &Handle) -> Vec<Handle> {
    h.children.borrow().clone()
}

fn elem_tag_lower(h: &Handle) -> Option<String> {
    match &h.data {
        NodeData::Element { name, .. } => Some(name.local.to_string().to_ascii_lowercase()),
        _ => None,
    }
}

fn attrs_map(h: &Handle) -> HashMap<String, String> {
    match &h.data {
        NodeData::Element { attrs, .. } => attrs
            .borrow()
            .iter()
            .map(|a| (a.name.local.to_string(), a.value.to_string()))
            .collect(),
        _ => HashMap::new(),
    }
}

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

fn is_keep_tag(lower: &str) -> bool {
    matches!(
        lower,
        "div"
            | "p"
            | "br"
            | "hr"
            | "b"
            | "strong"
            | "i"
            | "em"
            | "u"
            | "s"
            | "sub"
            | "sup"
            | "pre"
            | "code"
            | "blockquote"
            | "ul"
            | "ol"
            | "li"
            | "table"
            | "thead"
            | "tbody"
            | "tr"
            | "th"
            | "td"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "a"
            | "img"
            | "math"
    )
}

fn is_drop_content_tag(lower: &str) -> bool {
    matches!(
        lower,
        "script" | "style" | "noscript" | "template" | "iframe" | "object" | "embed" | "svg"
    )
}

#[derive(Clone, Debug)]
enum OutNode {
    Element {
        tag: String,
        attrs: Vec<(String, String)>,
        children: Vec<OutNode>,
    },
    Text(String),
    Comment(String),
}

fn keep_attrs(tag: &str, attrs: &HashMap<String, String>) -> Vec<(String, String)> {
    let t = tag.to_ascii_lowercase();
    let mut out: Vec<(String, String)> = Vec::new();
    match t.as_str() {
        "a" => {
            if let Some(h) = attrs.get("href").and_then(|v| sanitize_href(v)) {
                out.push(("href".to_string(), h));
            }
            if let Some(v) = attrs.get("title") {
                out.push(("title".to_string(), v.to_string()));
            }
        }
        "img" => {
            for k in ["src", "alt", "title", "width", "height"] {
                if let Some(v) = attrs.get(k) {
                    out.push((k.to_string(), v.to_string()));
                }
            }
        }
        "td" | "th" => {
            for k in ["colspan", "rowspan"] {
                if let Some(v) = attrs.get(k) {
                    out.push((k.to_string(), v.to_string()));
                }
            }
        }
        "math" => {
            if let Some(v) = attrs.get("xmlns") {
                out.push(("xmlns".to_string(), v.to_string()));
            }
            if let Some(v) = attrs.get("display") {
                out.push(("display".to_string(), v.to_string()));
            }
        }
        _ => {}
    }
    out
}

fn find_first_math(node: &Handle) -> Option<Handle> {
    if let Some(tag) = elem_tag_lower(node) {
        if tag == "math" {
            return Some(node.clone());
        }
    }
    for c in node_children(node) {
        if let Some(m) = find_first_math(&c) {
            return Some(m);
        }
    }
    None
}

fn sanitize_children(children: &[Handle], in_math: bool, in_li: bool) -> Vec<OutNode> {
    let mut out: Vec<OutNode> = Vec::new();
    for c in children {
        out.extend(sanitize_node(c, in_math, in_li));
    }
    out
}

fn ends_with_space(nodes: &[OutNode]) -> bool {
    match nodes.last() {
        Some(OutNode::Text(t)) => t.chars().last().map(|c| c.is_whitespace()).unwrap_or(false),
        _ => false,
    }
}

fn has_katex_class(attrs: &HashMap<String, String>) -> bool {
    let Some(c) = attrs.get("class") else {
        return false;
    };
    let c = c.to_ascii_lowercase();
    c.split_whitespace()
        .any(|x| x == "katex" || x == "katex-display")
}

fn element_local_name(node: &Handle) -> Option<String> {
    match &node.data {
        NodeData::Element { name, .. } => Some(name.local.to_string()),
        _ => None,
    }
}

fn sanitize_node(node: &Handle, in_math: bool, in_li: bool) -> Vec<OutNode> {
    match &node.data {
        NodeData::Text { contents } => vec![OutNode::Text(contents.borrow().to_string())],
        NodeData::Comment { contents } => vec![OutNode::Comment(contents.to_string())],
        NodeData::Document => sanitize_children(&node_children(node), in_math, in_li),
        NodeData::Doctype { .. } | NodeData::ProcessingInstruction { .. } => Vec::new(),
        NodeData::Element { .. } => {
            let tag_lower = elem_tag_lower(node).unwrap_or_default();

            if in_math {
                let attrs = attrs_map(node)
                    .into_iter()
                    .map(|(k, v)| (k, v))
                    .collect::<Vec<_>>();
                return vec![OutNode::Element {
                    tag: element_local_name(node).unwrap_or_default(),
                    attrs,
                    children: sanitize_children(&node_children(node), true, in_li),
                }];
            }

            if is_drop_content_tag(&tag_lower) {
                return Vec::new();
            }

            let attrs = attrs_map(node);

            if tag_lower == "span" && has_katex_class(&attrs) {
                if let Some(m) = find_first_math(node) {
                    return sanitize_node(&m, false, in_li);
                }
            }

            if tag_lower == "math" {
                return vec![OutNode::Element {
                    tag: "math".to_string(),
                    attrs: keep_attrs("math", &attrs),
                    children: sanitize_children(&node_children(node), true, in_li),
                }];
            }

            let now_in_li = in_li || tag_lower == "li";
            if now_in_li && (tag_lower == "p" || tag_lower == "div") {
                let mut kids = sanitize_children(&node_children(node), false, true);
                if !ends_with_space(&kids) {
                    kids.push(OutNode::Text(" ".to_string()));
                }
                return kids;
            }

            if !is_keep_tag(&tag_lower) {
                return sanitize_children(&node_children(node), false, now_in_li);
            }

            let tag = element_local_name(node).unwrap_or_default();
            vec![OutNode::Element {
                tag: tag.clone(),
                attrs: keep_attrs(&tag, &attrs),
                children: sanitize_children(&node_children(node), false, now_in_li),
            }]
        }
    }
}

fn esc_text(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
    }
    out
}

fn esc_attr(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(ch),
        }
    }
    out
}

fn is_void(tag: &str) -> bool {
    matches!(
        tag.to_ascii_lowercase().as_str(),
        "br" | "hr" | "img" | "meta" | "link" | "input"
    )
}

fn serialize_node(out: &mut String, n: &OutNode) {
    match n {
        OutNode::Text(t) => out.push_str(&esc_text(t)),
        OutNode::Comment(c) => {
            out.push_str("<!--");
            out.push_str(c);
            out.push_str("-->");
        }
        OutNode::Element { tag, attrs, children } => {
            out.push('<');
            out.push_str(tag);
            for (k, v) in attrs {
                out.push(' ');
                out.push_str(k);
                out.push_str("=\"");
                out.push_str(&esc_attr(v));
                out.push('"');
            }
            if is_void(tag) {
                out.push_str("/>");
                return;
            }
            out.push('>');
            for c in children {
                serialize_node(out, c);
            }
            out.push_str("</");
            out.push_str(tag);
            out.push('>');
        }
    }
}

fn serialize_nodes(nodes: &[OutNode]) -> String {
    let mut out = String::new();
    for n in nodes {
        serialize_node(&mut out, n);
    }
    out
}

fn find_body_children(dom: &RcDom) -> Option<Vec<Handle>> {
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

    let body = find_elem(&dom.document, "body")?;
    let out = body.children.borrow().clone();
    Some(out)
}

pub fn sanitize_for_office(input: &str) -> String {
    let dom = parse_to_dom(input);
    let children = find_body_children(&dom).unwrap_or_else(|| dom.document.children.borrow().clone());
    let sanitized = sanitize_children(&children, false, false);
    serialize_nodes(&sanitized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_unknown_tags_but_keeps_content() {
        let html = "<div>Hello<x-foo>World</x-foo><p>Ok</p></div>";
        let out = sanitize_for_office(html);
        assert!(out.contains("HelloWorld"));
        assert!(!out.to_ascii_lowercase().contains("x-foo"));
        assert!(out.contains("<p>Ok</p>"));
    }



    #[test]
    fn does_not_panic_on_unicode_text() {
        let html = "<div>ϕ(h,r,t)=Sim(Tr(h),t)</div>";
        let out = sanitize_for_office(html);
        assert!(out.contains("ϕ"));
    }

    #[test]
    fn does_not_drop_plain_quotes_or_words() {
        let html = r#"<div>2.2 The Dynamic Substrate: Dual Phasers (P_d) " So phases missing.</div>"#;
        let out = sanitize_for_office(html);
        assert!(out.contains("Dual Phasers"));
        assert!(out.contains("So phases missing"));
    }
}
