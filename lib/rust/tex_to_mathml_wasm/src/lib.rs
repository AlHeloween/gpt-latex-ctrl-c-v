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
pub extern "C" fn html_to_office_with_mathml(ptr: u32, len: u32) -> u32 {
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

    match pipeline::html_to_office_with_mathml(s) {
        Ok(out) => write_out(&out),
        Err(msg) => {
            set_error(4, &msg);
            0
        }
    }
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
pub extern "C" fn markdown_to_office_with_mathml(ptr: u32, len: u32) -> u32 {
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

    match pipeline::markdown_to_office_with_mathml(s) {
        Ok(out) => write_out(&out),
        Err(msg) => {
            set_error(4, &msg);
            0
        }
    }
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

