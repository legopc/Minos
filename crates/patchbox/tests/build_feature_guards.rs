use std::fs;
use std::path::{Path, PathBuf};

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("workspace root")
        .to_path_buf()
}

#[test]
fn deploy_scripts_use_patchbox_inferno_feature_proxy() {
    let root = repo_root();
    let checked_files = [
        "scripts/deploy.sh",
        "scripts/install-arch.sh",
        "deploy/BUILD.md",
    ];

    for rel in checked_files {
        let path = root.join(rel);
        let contents = fs::read_to_string(&path).expect("read build/deploy file");
        assert!(
            contents.contains("patchbox/inferno"),
            "{} must build with patchbox/inferno so the patchbox binary disables simulated meters",
            rel
        );
        assert!(
            !contents.contains("patchbox-dante/inferno"),
            "{} must not build with patchbox-dante/inferno directly; that leaves the patchbox binary's simulated meter task enabled",
            rel
        );
    }
}

#[test]
fn patchbox_inferno_feature_enables_dante_dependency() {
    let manifest = fs::read_to_string(repo_root().join("crates/patchbox/Cargo.toml"))
        .expect("read patchbox manifest");
    assert!(
        manifest.contains("inferno = ['patchbox-dante/inferno']")
            || manifest.contains("inferno = [\"patchbox-dante/inferno\"]"),
        "patchbox/inferno must remain the public feature that enables the Dante dependency"
    );
}

#[test]
fn simulated_meters_are_explicitly_opt_in() {
    let manifest = fs::read_to_string(repo_root().join("crates/patchbox/Cargo.toml"))
        .expect("read patchbox manifest");
    assert!(
        manifest.contains("sim-meters = []"),
        "simulated meter generation must be an explicit feature"
    );

    let main_rs = fs::read_to_string(repo_root().join("crates/patchbox/src/main.rs"))
        .expect("read patchbox main");
    assert!(
        main_rs.contains("#[cfg(all(feature = \"sim-meters\", not(feature = \"inferno\")))]"),
        "simulated meter task must not be enabled merely because patchbox/inferno is absent"
    );
}

#[test]
fn patchbox_systemd_unit_restarts_after_clean_app_restart() {
    let install_script = fs::read_to_string(repo_root().join("scripts/install-arch.sh"))
        .expect("read install script");
    let patchbox_unit = install_script
        .split("Description=Minos Dante Patchbay")
        .nth(1)
        .expect("patchbox service unit section");

    assert!(
        patchbox_unit.contains("Restart=always"),
        "patchbox service must restart after app-requested clean exits"
    );
    assert!(
        patchbox_unit.contains("SuccessExitStatus=0"),
        "patchbox service must document that app-requested restart exits cleanly"
    );
}
