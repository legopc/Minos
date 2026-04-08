fn main() {
    // A-01: Link libpam at build time.
    // libpam0g is present but libpam0g-dev may not be (no .so symlink).
    // Point the linker to our local libs/ dir which has a libpam.so -> libpam.so.0 symlink.
    let manifest = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    println!("cargo:rustc-link-search=native={manifest}/libs");
    println!("cargo:rustc-link-lib=pam");
}
