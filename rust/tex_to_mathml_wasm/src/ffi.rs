static mut LAST_LEN: u32 = 0;
static mut LAST_ERR_PTR: u32 = 0;
static mut LAST_ERR_LEN: u32 = 0;
static mut LAST_ERR_CODE: u32 = 0;

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

pub fn set_error(code: u32, message: &str) {
    unsafe {
        LAST_ERR_CODE = code;
        LAST_LEN = 0;
        let bytes = message.as_bytes();
        let mut out = Vec::<u8>::with_capacity(bytes.len());
        out.extend_from_slice(bytes);
        LAST_ERR_LEN = out.len() as u32;
        LAST_ERR_PTR = out.as_mut_ptr() as u32;
        std::mem::forget(out);
    }
}

pub fn read_utf8(ptr: u32, len: u32) -> Result<&'static str, u32> {
    if ptr == 0 || len == 0 {
        return Err(1);
    }
    let bytes = unsafe { std::slice::from_raw_parts(ptr as *const u8, len as usize) };
    std::str::from_utf8(bytes).map_err(|_| 2)
}

pub fn write_out(text: &str) -> u32 {
    unsafe {
        LAST_ERR_CODE = 0;
        LAST_ERR_PTR = 0;
        LAST_ERR_LEN = 0;
    }
    let bytes = text.as_bytes();
    let mut out = Vec::<u8>::with_capacity(bytes.len());
    out.extend_from_slice(bytes);
    unsafe {
        LAST_LEN = out.len() as u32;
    }
    let out_ptr = out.as_mut_ptr() as u32;
    std::mem::forget(out);
    out_ptr
}
