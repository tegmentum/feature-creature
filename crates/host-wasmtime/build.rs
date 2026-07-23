// Extract the resolved wasmtime version from Cargo.lock and expose it as
// $WASMTIME_VERSION for main.rs to consume via env!(). Avoids either a
// hardcoded string that rots on dep bumps or a new build dependency.

use std::{env, fs, path::PathBuf};

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let mut dir = manifest_dir.as_path();
    let lockfile = loop {
        let candidate = dir.join("Cargo.lock");
        if candidate.is_file() {
            break candidate;
        }
        match dir.parent() {
            Some(p) => dir = p,
            None => panic!(
                "could not locate Cargo.lock from {}",
                manifest_dir.display()
            ),
        }
    };
    println!("cargo:rerun-if-changed={}", lockfile.display());

    let text = fs::read_to_string(&lockfile).expect("read Cargo.lock");
    let version = find_pkg_version(&text, "wasmtime")
        .unwrap_or_else(|| panic!("wasmtime package not found in {}", lockfile.display()));
    println!("cargo:rustc-env=WASMTIME_VERSION={version}");
}

fn find_pkg_version(lockfile: &str, name: &str) -> Option<String> {
    let needle = format!("name = \"{name}\"");
    for block in lockfile.split("[[package]]") {
        let mut lines = block.lines().map(str::trim);
        let mut hit = false;
        let mut version = None;
        for line in &mut lines {
            if line == needle {
                hit = true;
            } else if let Some(rest) = line.strip_prefix("version = \"") {
                version = rest.strip_suffix('"').map(str::to_owned);
            }
            if hit && version.is_some() {
                return version;
            }
        }
    }
    None
}
