use html5ever::parse_document;
use html5ever::tendril::TendrilSink;
use markup5ever_rcdom::{Handle, NodeData, RcDom};

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

fn is_wrapper(tag: &str) -> bool {
    matches!(tag.to_ascii_lowercase().as_str(), "html" | "head" | "body")
}

fn emit_start(out: &mut String, tag: &str, attrs: &[(String, String)]) {
    if is_wrapper(tag) {
        return;
    }
    out.push('<');
    out.push_str(tag);
    for (k, v) in attrs {
        out.push(' ');
        out.push_str(k);
        out.push_str("=\"");
        out.push_str(&esc_attr(v));
        out.push('"');
    }
    out.push('>');
}

fn emit_end(out: &mut String, tag: &str) {
    if is_wrapper(tag) {
        return;
    }
    out.push_str("</");
    out.push_str(tag);
    out.push('>');
}

#[derive(Clone)]
struct Frame {
    tag: String,
    attrs: Vec<(String, String)>,
}

struct State<'a> {
    start: &'a str,
    end: &'a str,
    stack: Vec<Frame>,
    out: String,
    capturing: bool,
    found_start: bool,
    found_end: bool,
    done: bool,
}

fn walk(node: &Handle, st: &mut State<'_>) {
    if st.done {
        return;
    }

    match &node.data {
        NodeData::Document => {
            for c in node.children.borrow().iter() {
                walk(c, st);
                if st.done {
                    return;
                }
            }
        }
        NodeData::Doctype { .. } | NodeData::ProcessingInstruction { .. } => {}
        NodeData::Text { contents } => {
            if st.capturing {
                st.out.push_str(&esc_text(&contents.borrow().to_string()));
            }
        }
        NodeData::Comment { contents } => {
            let c = contents.to_string();
            if !st.capturing && c == st.start {
                st.capturing = true;
                st.found_start = true;
                for f in &st.stack {
                    emit_start(&mut st.out, &f.tag, &f.attrs);
                }
                return;
            }
            if st.capturing && c == st.end {
                st.found_end = true;
                for f in st.stack.iter().rev() {
                    emit_end(&mut st.out, &f.tag);
                }
                st.capturing = false;
                st.done = true;
                return;
            }
            if st.capturing {
                st.out.push_str("<!--");
                st.out.push_str(&c);
                st.out.push_str("-->");
            }
        }
        NodeData::Element { name, attrs, .. } => {
            let tag = name.local.to_string();
            let attrs_vec = attrs
                .borrow()
                .iter()
                .map(|a| (a.name.local.to_string(), a.value.to_string()))
                .collect::<Vec<_>>();
            st.stack.push(Frame {
                tag: tag.clone(),
                attrs: attrs_vec.clone(),
            });

            if st.capturing {
                emit_start(&mut st.out, &tag, &attrs_vec);
            }

            for c in node.children.borrow().iter() {
                walk(c, st);
                if st.done {
                    break;
                }
            }

            if st.capturing {
                emit_end(&mut st.out, &tag);
            }

            st.stack.pop();
        }
    }
}

pub fn extract_fragment_by_comment_tokens(
    page_html: &str,
    start: &str,
    end: &str,
) -> Result<String, String> {
    if start.is_empty() || end.is_empty() {
        return Err("tokens must be start\\u001Fend".to_string());
    }

    let dom: RcDom = parse_document(RcDom::default(), Default::default()).one(page_html);
    let mut st = State {
        start,
        end,
        stack: Vec::new(),
        out: String::new(),
        capturing: false,
        found_start: false,
        found_end: false,
        done: false,
    };

    walk(&dom.document, &mut st);

    if !st.found_start {
        return Err("start marker not found".to_string());
    }
    if !st.found_end {
        return Err("end marker not found".to_string());
    }

    Ok(st.out)
}

