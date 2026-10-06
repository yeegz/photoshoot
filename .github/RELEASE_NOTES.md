Photoshoot 1.0.1 improves camera startup and recovery in the browser and Windows desktop app.

- Falls back to basic camera constraints when a device rejects preferred settings.
- Offers basic photo capture when WebGL2 is unavailable.
- Handles denied playback, disconnected cameras, slow acquisition and graphics-context loss with recovery messages.
- Prevents stale captures and mixed recording data when cameras or effects change.
- Cleans up recording tracks and face-tracking loops reliably.
- Updates Electron and build dependencies.

Download `Photoshoot-1.0.1-x64.exe` for the Windows 10/11 installer or `Photoshoot-1.0.1-portable.exe` for the portable app. SHA-256 hashes are in `SHA256SUMS.txt`.

These executables are unsigned, so Windows may show an unknown-publisher warning. No signed or notarised macOS release is included. Browser, Linux Electron and Windows Electron tests use a synthetic camera; physical-camera compatibility still depends on the device, driver and operating-system privacy settings.

[Open the browser app](https://photoshoot-yeegz.web.app/app/).
