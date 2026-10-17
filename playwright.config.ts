import { defineConfig, type Project } from '@playwright/test';

const fakeCamera = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];

// Windows PCs with a working GPU run WebGL through ANGLE's Direct3D 11 backend
// with GPU compositing — a path macOS and the GPU-less Linux/Windows CI runners
// never take. This project forces that exact path onto Windows' software WARP
// adapter (headed: GPU compositing needs a real window) so the CI Windows job
// renders the viewfinder the way a real Windows laptop does. It guards the
// "camera live but viewfinder and photos are black" regression that only
// reproduced there.
const windowsDirect3D11: Project = {
  name: 'win-d3d11',
  use: {
    channel: 'msedge',
    headless: false,
    launchOptions: { args: [...fakeCamera, '--use-angle=d3d11-warp', '--ignore-gpu-blocklist'] },
  },
};

// Point the browser specs at a deployed site instead of a local build, e.g.
//   PHOTOSHOOT_BASE_URL=https://photoshoot-yeegz.web.app npx playwright test test/browser/viewfinder.spec.ts
// (used by the "Probe live site on Windows" workflow).
const liveSite = process.env.PHOTOSHOOT_BASE_URL;

export default defineConfig({
  testDir: './test/browser',
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: liveSite ?? 'http://localhost:4178',
    launchOptions: { args: fakeCamera },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: liveSite
    ? undefined
    : {
        command: 'npm run build:web && node web/serve.mjs',
        url: 'http://localhost:4178/app/',
        reuseExistingServer: false,
      },
  projects: [{ name: 'chromium' }, ...(process.platform === 'win32' ? [windowsDirect3D11] : [])],
});
