fn main() {
    // Locate libpam — path differs between distros:
    //   Arch:          /usr/lib/libpam.so.0
    //   Debian/Ubuntu: /usr/lib/x86_64-linux-gnu/libpam.so.0
    let candidates = [
        "/usr/lib/libpam.so.0",
        "/usr/lib/x86_64-linux-gnu/libpam.so.0",
        "/usr/lib64/libpam.so.0",
    ];
    let path = candidates
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .expect("libpam.so.0 not found — install pam");
    println!("cargo:rustc-link-arg={path}");

    track_web_assets();
    build_docs();
}

fn track_web_assets() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let web_dir = std::path::Path::new(&manifest_dir)
        .join("../../web")
        .canonicalize()
        .expect("web/ directory not found relative to crates/patchbox/");

    println!("cargo:rerun-if-changed={}", web_dir.join("src").display());
}

fn build_docs() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let docs_dir = std::path::Path::new(&manifest_dir)
        .join("../../docs")
        .canonicalize()
        .expect("docs/ directory not found relative to crates/patchbox/");

    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed={}", docs_dir.join("src").display());
    println!(
        "cargo:rerun-if-changed={}",
        docs_dir.join("book.toml").display()
    );

    let status = std::process::Command::new("mdbook")
        .arg("build")
        .arg(&docs_dir)
        .status()
        .unwrap_or_else(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                panic!("mdbook not found — install with: cargo install mdbook");
            }
            panic!("failed to run mdbook: {e}");
        });

    assert!(status.success(), "mdbook build failed");
}
