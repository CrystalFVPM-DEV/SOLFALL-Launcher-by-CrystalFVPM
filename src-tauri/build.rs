fn main() {
    // Compile-time configuration (CI / E2E kits). Rebuild when they change, otherwise cargo reuses a stale value.
    println!("cargo:rerun-if-env-changed=SOLFALL_LAUNCHER_BASE");
    println!("cargo:rerun-if-env-changed=SOLFALL_E2E_ALLOW_LOCALHOST");
    tauri_build::build()
}
