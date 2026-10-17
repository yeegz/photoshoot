Photoshoot 1.0.2 fixes the black viewfinder on Windows.

- Fixes the black camera preview, black effect thumbnails and black captures on Windows PCs with a working GPU, where the app reported "Camera live" while every canvas stayed black. The WebGL context asked for Chromium's low-latency (`desynchronized`) canvas hint, which macOS ignores but Windows honours; on the Direct3D 11 path with GPU compositing it presents an empty buffer. The hint is gone.
- Every Windows build is now rendered on the Direct3D 11 + GPU-compositing path before it is published, and real pixels are read back from the live preview, an effect and a saved photo.
- The camera startup work from 16 October ships in the Windows app for the first time: Windows Hello IR and depth sensors are skipped, every camera is tried before giving up, and Windows privacy and busy-camera guidance is shown.
- The web app reports its real version.

Download `Photoshoot-1.0.2-x64.exe` for the Windows 10/11 installer or `Photoshoot-1.0.2-portable.exe` for the portable app. SHA-256 hashes are in `SHA256SUMS.txt`.

These executables are unsigned, so Windows may show an unknown-publisher warning (choose More info, then Run anyway). No signed or notarised macOS release is included.

[Open the browser app](https://photoshoot-yeegz.web.app/app/).
