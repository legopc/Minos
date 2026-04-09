fn main() {
    // Link libpam by full path to avoid versioned symbol resolution issues
    println!("cargo:rustc-link-arg=/usr/lib/x86_64-linux-gnu/libpam.so.0");
}
