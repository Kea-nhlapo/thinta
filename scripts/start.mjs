// Production server for Railway (or any Node host): Vite's preview server serves the built app from dist/ and
// mounts every API route from vite.config.mjs (translation, voices, lessons, Thinta, Fika) in one Node process.
// Run `npm run build` first. Keys come from the host's environment variables.
import { preview } from 'vite';

const server = await preview({
  preview: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 8765,
    strictPort: true,
    // The host gives the app its own domain; Vite would otherwise refuse requests for names it doesn't know.
    allowedHosts: true,
  },
});
server.printUrls();
