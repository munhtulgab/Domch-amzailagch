import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const write = (outDir, name, html, swaps) => {
  let out = html;
  for (const [re, value] of swaps) {
    if (!re.test(out)) throw new Error(`${name}: pattern not found ${re}`);
    out = out.replace(re, value);
  }
  writeFileSync(resolve(outDir, name), out);
};

/* /admin gets its own copy of the page that names the admin app manifest from the start.
   iPhone «Add to Home Screen» reads the manifest from the page as it was served, so a manifest
   swapped in later by script would install the public site instead of the admin.
   /demo gets a dark first paint, the condensed display face and its own title. */
function extraPages() {
  let outDir = 'dist';
  return {
    name: 'domch-extra-pages',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const html = readFileSync(resolve(outDir, 'index.html'), 'utf8');
      write(outDir, 'admin.html', html, [
        [/<title>[^<]*<\/title>/, '<title>ДОМЧ Удирдлага</title>'],
        // no automatic zoom when a field is tapped (people can still pinch to zoom)
        [/<meta name="viewport" content="[^"]*">/, '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">'],
        [/<link rel="manifest" href="[^"]*">/, '<link rel="manifest" href="/admin.webmanifest">'],
        [/<meta name="theme-color" content="[^"]*">/, '<meta name="theme-color" content="#024B42">'],
        [/<meta name="apple-mobile-web-app-title" content="[^"]*">/,
          '<meta name="apple-mobile-web-app-title" content="ДОМЧ Удирдлага">\n    <meta name="apple-mobile-web-app-capable" content="yes">\n    <meta name="mobile-web-app-capable" content="yes">\n    <meta name="robots" content="noindex">'],
        [/<link rel="canonical"[^>]*>\n?\s*/, ''],
      ]);
      write(outDir, 'demo.html', html, [
        [/<html lang="mn">/, '<html lang="mn" class="dm-on">'],
        [/<title>[^<]*<\/title>/, '<title>ДОМЧ — Зүгээр л ам зайлагч биш</title>'],
        [/<meta name="theme-color" content="[^"]*">/, '<meta name="theme-color" content="#030405">\n    <meta name="robots" content="noindex">'],
        [/<link rel="canonical"[^>]*>\n?\s*/, ''],
        [/<meta property="og:url" content="[^"]*">/, '<meta property="og:url" content="https://domch.gem.mn/demo">'],
        [/family=Unbounded:wght@500;600&display=swap/, 'family=Unbounded:wght@500;600&family=Oswald:wght@500;600;700&display=swap'],
      ]);
    },
  };
}

export default defineConfig({
  plugins: [react(), extraPages()],
  server: {
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 900,
  },
});
