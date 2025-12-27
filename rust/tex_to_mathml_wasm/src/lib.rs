use latex2mathml::{latex_to_mathml, DisplayStyle};

static mut LAST_LEN: u32 = 0;
static mut LAST_ERR_PTR: u32 = 0;
static mut LAST_ERR_LEN: u32 = 0;
static mut LAST_ERR_CODE: u32 = 0;

#[no_mangle]
pub extern "C" fn api_version() -> u32 {
    1
}

#[no_mangle]
pub extern "C" fn last_len() -> u32 {
    unsafe { LAST_LEN }
}

#[no_mangle]
pub extern "C" fn last_err_ptr() -> u32 {
    unsafe { LAST_ERR_PTR }
}

#[no_mangle]
pub extern "C" fn last_err_len() -> u32 {
    unsafe { LAST_ERR_LEN }
}

#[no_mangle]
pub extern "C" fn last_err_code() -> u32 {
    unsafe { LAST_ERR_CODE }
}

#[no_mangle]
pub extern "C" fn clear_last_error() {
    unsafe {
        LAST_ERR_PTR = 0;
        LAST_ERR_LEN = 0;
        LAST_ERR_CODE = 0;
    }
}

#[no_mangle]
pub extern "C" fn alloc(size: u32) -> u32 {
    let mut buf = Vec::<u8>::with_capacity(size as usize);
    let ptr = buf.as_mut_ptr() as u32;
    std::mem::forget(buf);
    ptr
}

#[no_mangle]
pub extern "C" fn dealloc(ptr: u32, size: u32) {
    if ptr == 0 || size == 0 {
        return;
    }
    unsafe {
        let _ = Vec::<u8>::from_raw_parts(ptr as *mut u8, size as usize, size as usize);
    }
}

fn set_error(code: u32, message: &str) {
    unsafe {
        LAST_ERR_CODE = code;
        LAST_LEN = 0;
        // Note: the caller is responsible for deallocating LAST_ERR_PTR with LAST_ERR_LEN.
        let bytes = message.as_bytes();
        let mut out = Vec::<u8>::with_capacity(bytes.len());
        out.extend_from_slice(bytes);
        LAST_ERR_LEN = out.len() as u32;
        LAST_ERR_PTR = out.as_mut_ptr() as u32;
        std::mem::forget(out);
    }
}

#[no_mangle]
pub extern "C" fn tex_to_mathml(ptr: u32, len: u32, display: u32) -> u32 {
    if ptr == 0 || len == 0 {
        set_error(1, "empty input");
        return 0;
    }

    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len as usize) };
    let latex = match std::str::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => {
            set_error(2, "input is not valid UTF-8");
            return 0;
        }
    };

    let style = if display != 0 {
        DisplayStyle::Block
    } else {
        DisplayStyle::Inline
    };

    match latex_to_mathml(latex, style) {
        Ok(mathml) => {
            if mathml.contains("[PARSE ERROR:") {
                set_error(4, "parse error: unsupported LaTeX command or token");
                return 0;
            }
            unsafe {
                LAST_ERR_CODE = 0;
                LAST_ERR_PTR = 0;
                LAST_ERR_LEN = 0;
            }
            let bytes = mathml.as_bytes();
            let mut out = Vec::<u8>::with_capacity(bytes.len());
            out.extend_from_slice(bytes);
            unsafe {
                LAST_LEN = out.len() as u32;
            }
            let out_ptr = out.as_mut_ptr() as u32;
            std::mem::forget(out);
            out_ptr
        }
        Err(e) => {
            set_error(3, &format!("{}", e));
            0
        }
    }
}
