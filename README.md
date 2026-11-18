<p align="center">
  <img src="src/assets/logo.png" alt="SOLFALL" width="384">
</p>

# SOLFALL Launcher

An **unofficial** desktop launcher for Solfall, made by **CrystalFVPM**.

[Solfall](https://solfall.online) is a 2D space MMO that you play in the browser. The launcher opens the game in
its own window, shows the latest news and keeps itself up to date. Ships cross the background now and then; turn that
off (or everything that moves) in **Settings → Performance**.

**[Download the latest version](https://github.com/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/releases/latest)**
· **[Join the Discord](https://discord.gg/scyet8grSR)**

## Installation

Download the file for your system from the
[latest release](https://github.com/CrystalFVPM-DEV/SOLFALL-Launcher-by-CrystalFVPM/releases/latest).
You only need one file. The `.sig` and `latest.json` files are for the auto-updater.

| System | File |
|---|---|
| Windows 10/11 (64-bit) | `SOLFALL-Launcher_0.4.0_Windows_x64-setup.exe` |
| macOS 10.15 or newer (Apple Silicon and Intel) | `SOLFALL-Launcher_0.4.0_macOS-universal.dmg` |
| Linux (any distro) | `SOLFALL-Launcher_0.4.0_Linux_x86_64.AppImage` |
| Debian / Ubuntu | `SOLFALL-Launcher_0.4.0_Linux_amd64.deb` |

### Windows
Download `SOLFALL-Launcher_0.4.0_Windows_x64-setup.exe`, run it and follow the installer. If SmartScreen
says "Windows protected your PC", click **More info → Run anyway**.

### macOS (Apple Silicon and Intel, macOS 10.15 or newer)
1. Open `SOLFALL-Launcher_0.4.0_macOS-universal.dmg` and drag **SolfallLauncher.app** onto **Applications**.
2. The app isn't notarized by Apple, so macOS blocks it the first time. **Quick method:** open Terminal and run
   ```
   xattr -dr com.apple.quarantine "/Applications/SolfallLauncher.app"
   ```
   then open the app.
3. **Without Terminal:** try to open the app once, then go to **System Settings → Privacy & Security** and click
   **Open Anyway**. On macOS 14 or earlier, right-click the app → **Open** also works.

After that it works like any other app in Applications, the Dock and Launchpad, and it updates itself.
The steps are the same on Intel and Apple Silicon (it's one universal app).

### Linux
**AppImage:**
```
chmod +x SOLFALL-Launcher_0.4.0_Linux_x86_64.AppImage
./SOLFALL-Launcher_0.4.0_Linux_x86_64.AppImage
```
If it doesn't start, install FUSE: `sudo apt install libfuse2` (Ubuntu 22.04) or `sudo apt install libfuse2t64` (Ubuntu 24.04 and newer).

**.deb (Debian / Ubuntu):**
```
sudo apt install ./SOLFALL-Launcher_0.4.0_Linux_amd64.deb
```

## For developers
Building, CI, release signing, content and known limitations: [docs/DEVELOPERS.md](docs/DEVELOPERS.md).

## Credits
Launcher code © CrystalFVPM, licensed under the [Apache-2.0](LICENSE) license.
Please keep the attribution to CrystalFVPM when you reuse it.

Solfall assets, logo and music are property of their owners and used with permission; not covered by the Apache-2.0 license.
