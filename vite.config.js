import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/* /admin gets its own copy of the page that names the admin app manifest from the start.
   iPhone «Add to Home Screen» reads the manifest from the page as it was served, so a manifest
   swapped in later by script would install the public site instead of the admin. */
function adminPage() {
  let outDir = 'dist';
  return {
    name: 'domch-admin-page',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const html = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      const swaps = [
        [/<title>[^<]*<\/title>/, '<title>ДОМЧ Удирдлага</title>'],
        // no automatic zoom when a field is tapped (people can still pinch to zoom)
        [/<meta name="viewport" content="[^"]*">/, '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">'],
        [/<link rel="manifest" href="[^"]*">/, '<link rel="manifest" href="/admin.webmanifest">'],
        [/<meta name="theme-color" content="[^"]*">/, '<meta name="theme-color" content="#024B42">'],
        [/<meta name="apple-mobile-web-app-title" content="[^"]*">/,
          '<meta name="apple-mobile-web-app-title" content="ДОМЧ Удирдлага">\n    <meta name="apple-mobile-web-app-capable" content="yes">\n    <meta name="mobile-web-app-capable" content="yes">\n    <meta name="robots" content="noindex">'],
        [/<link rel="canonical"[^>]*>\n?\s*/, ''],
      ];
      let out = html;
      for (const [re, value] of swaps) {
        if (!re.test(out)) throw new Error(`admin page: pattern not found ${re}`);
        out = out.replace(re, value);
      }
      writeFileSync(resolve(outDir, 'admin.html'), out);
    },
  };
}

export default defineConfig({
  plugins: [react(), adminPage()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
});
