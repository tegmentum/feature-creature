#![no_std]
#![no_main]

// Feature registry and embedded probe bytes, generated from features.toml.
include!(concat!(env!("OUT_DIR"), "/probes.rs"));

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

// Sole host capability: ask the engine to validate a Wasm module.
#[link(wasm_import_module = "engine")]
extern "C" {
    fn validate(ptr: *const u8, len: usize) -> i32;
}

// Statically reserved output buffer. Sized for FEATURE_COUNT rounded up to
// bytes with headroom for growth. Hosts that prefer their own buffer can
// pass any writable pointer into the exported memory.
const RESULT_CAP: usize = 64;
static mut RESULT_BUFFER: [u8; RESULT_CAP] = [0; RESULT_CAP];

#[no_mangle]
pub extern "C" fn feature_count() -> u32 {
    FEATURE_COUNT as u32
}

#[no_mangle]
pub extern "C" fn result_buffer() -> u32 {
    core::ptr::addr_of!(RESULT_BUFFER) as u32
}

#[no_mangle]
pub extern "C" fn result_capacity() -> u32 {
    RESULT_CAP as u32
}

/// Probe every known feature and write a little-endian bitmap into
/// `[out_ptr, out_ptr + needed)` where `needed = ceil(FEATURE_COUNT / 8)`.
/// Returns `needed` on success, or `-1` if `out_cap < needed`.
#[no_mangle]
pub extern "C" fn detect(out_ptr: u32, out_cap: u32) -> i32 {
    let needed = FEATURE_COUNT.div_ceil(8);
    if (out_cap as usize) < needed {
        return -1;
    }
    let out = unsafe { core::slice::from_raw_parts_mut(out_ptr as *mut u8, needed) };
    for b in out.iter_mut() {
        *b = 0;
    }
    for (i, probe) in PROBES.iter().enumerate() {
        let ok = unsafe { validate(probe.bytes.as_ptr(), probe.bytes.len()) } != 0;
        if ok {
            out[i / 8] |= 1 << (i % 8);
        }
    }
    needed as i32
}
