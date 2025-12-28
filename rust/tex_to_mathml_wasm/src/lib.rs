mod entities;
mod ffi;
mod json;
mod markdown;
mod normalize;
mod office;
mod pipeline;
mod sanitize;
mod tex;

use crate::ffi::{read_utf8, set_error, write_out};
use html5ever::tendril::TendrilSink;
use html5ever::parse_document;
use markup5ever_rcdom::{NodeData, RcDom};

#[no_mangle]
pub extern "C" fn api_version() -> u32 {
    3
}

#[no_mangle]
pub extern "C" fn tex_to_mathml(ptr: u32, len: u32, display: u32) -> u32 {
    let latex = match read_utf8(ptr, len) {
        Ok(s) => s,
        Err(1) => {
            set_error(1, "empty input");
            return 0;
        }
        Err(_) => {
            set_error(2, "input is not valid UTF-8");
            return 0;
        }
    };

    match tex::tex_to_mathml(latex, display != 0) {
        Ok(mathml) => write_out(&mathml),
        Err(msg) => {
            set_error(3, &msg);
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn html_to_office(ptr: u32, len: u32) -> u32 {
    let s = match read_utf8(ptr, len) {
        Ok(s) => s,
        Err(1) => {
            set_error(1, "empty input");
            return 0;
        }
        Err(_) => {
            set_error(2, "input is not valid UTF-8");
            return 0;
        }
    };
    let out = office::html_to_office_html(s);
    write_out(&out)
}

#[no_mangle]
pub extern "C" fn html_to_markdown(ptr: u32, len: u32) -> u32 {
    let s = match read_utf8(ptr, len) {
        Ok(s) => s,
        Err(1) => {
            set_error(1, "empty input");
            return 0;
        }
        Err(_) => {
            set_error(2, "input is not valid UTF-8");
            return 0;
        }
    };
    let out = markdown::html_to_markdown_text(s);
    write_out(&out)
}

#[no_mangle]
pub extern "C" fn markdown_to_html(ptr: u32, len: u32) -> u32 {
    let s = match read_utf8(ptr, len) {
        Ok(s) => s,
        Err(1) => {
            set_error(1, "empty input");
            return 0;
        }
        Err(_) => {
            set_error(2, "input is not valid UTF-8");
            return 0;
        }
    };
    let out = markdown::markdown_to_html_string(s);
    write_out(&out)
}

#[no_mangle]
pub extern "C" fn html_to_office_prepared(ptr: u32, len: u32) -> u32 {
    let s = match read_utf8(ptr, len) {
        Ok(s) => s,
        Err(1) => {
            set_error(1, "empty input");
            return 0;
        }
        Err(_) => {
            set_error(2, "input is not valid UTF-8");
            return 0;
        }
    };
    let prepared = pipeline::html_to_office_prepared(s);
    let out = json::prepared_office_to_json(&prepared);
    write_out(&out)
}

#[no_mangle]
pub extern "C" fn markdown_to_office_prepared(ptr: u32, len: u32) -> u32 {
    let s = match read_utf8(ptr, len) {
        Ok(s) => s,
        Err(1) => {
            set_error(1, "empty input");
            return 0;
        }
        Err(_) => {
            set_error(2, "input is not valid UTF-8");
            return 0;
        }
    };
    let prepared = pipeline::markdown_to_office_prepared(s);
    let out = json::prepared_office_to_json(&prepared);
    write_out(&out)
}

#[no_mangle]
pub extern "C" fn office_apply_mathml(
    html_ptr: u32,
    html_len: u32,
    joined_ptr: u32,
    joined_len: u32,
) -> u32 {
    let html = match read_utf8(html_ptr, html_len) {
        Ok(s) => s,
        Err(1) => {
            set_error(1, "empty html");
            return 0;
        }
        Err(_) => {
            set_error(2, "html is not valid UTF-8");
            return 0;
        }
    };
    let joined = match read_utf8(joined_ptr, joined_len) {
        Ok(s) => s,
        Err(1) => {
            set_error(1, "empty mathml");
            return 0;
        }
        Err(_) => {
            set_error(2, "mathml is not valid UTF-8");
            return 0;
        }
    };

    match pipeline::office_apply_mathml(html, joined) {
        Ok(out) => write_out(&out),
        Err(msg) => {
            set_error(4, &msg);
            0
        }
    }
}

#[no_mangle]
pub extern "C" fn wrap_html_for_clipboard(
    fragment_ptr: u32,
    fragment_len: u32,
    base_ptr: u32,
    base_len: u32,
) -> u32 {
    let fragment = match read_utf8(fragment_ptr, fragment_len) {
        Ok(s) => s,
        Err(1) => {
            set_error(1, "empty fragment");
            return 0;
        }
        Err(_) => {
            set_error(2, "fragment is not valid UTF-8");
            return 0;
        }
    };
    let base_url = match read_utf8(base_ptr, base_len) {
        Ok(s) => s,
        Err(1) => "",
        Err(_) => {
            set_error(2, "base_url is not valid UTF-8");
            return 0;
        }
    };
    let out = office::wrap_html_for_clipboard(&fragment, base_url);
    write_out(&out)
}

#[no_mangle]
pub extern "C" fn extract_fragment_by_comment_tokens(
    page_ptr: u32,
    page_len: u32,
    tokens_ptr: u32,
    tokens_len: u32,
) -> u32 {
    let page = match read_utf8(page_ptr, page_len) {
        Ok(s) => s,
        Err(1) => {
            set_error(1, "empty page_html");
            return 0;
        }
        Err(_) => {
            set_error(2, "page_html is not valid UTF-8");
            return 0;
        }
    };

    let tokens = match read_utf8(tokens_ptr, tokens_len) {
        Ok(s) => s,
        Err(1) => {
            set_error(1, "empty tokens");
            return 0;
        }
        Err(_) => {
            set_error(2, "tokens is not valid UTF-8");
            return 0;
        }
    };

    let mut it = tokens.split('\u{001F}');
    let start = it.next().unwrap_or("");
    let end = it.next().unwrap_or("");
    if start.is_empty() || end.is_empty() {
        set_error(3, "tokens must be start\\u001Fend");
        return 0;
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

    fn walk(node: &markup5ever_rcdom::Handle, st: &mut State<'_>) {
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

    let dom: RcDom = parse_document(RcDom::default(), Default::default()).one(page);
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
        set_error(4, "start marker not found");
        return 0;
    }
    if !st.found_end {
        set_error(5, "end marker not found");
        return 0;
    }

    write_out(&st.out)
}
