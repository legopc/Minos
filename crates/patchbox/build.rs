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
}
