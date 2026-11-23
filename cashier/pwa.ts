import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

export function pwa(): Plugin {
  let output: string
  return {
    name: 'salebase-pwa',
    apply: 'build',
    configResolved(config) { output = resolve(config.root, config.build.outDir) },
    async closeBundle() {
      async function files(directory: string, prefix = ''): Promise<string[]> {
        const entries = await readdir(directory, { withFileTypes: true })

        return (await Promise.all(entries.map(entry => entry.isDirectory()
          ? files(resolve(directory, entry.name), `${prefix}${entry.name}/`)
          : [`${prefix}${entry.name}`]))).flat()
      }

      const assets = (await files(output)).filter(file => file !== 'sw.js' && !file.endsWith('.map') && !file.startsWith('_')).sort()

      const hash = createHash('sha256')

      for (const file of assets) { 
        hash.update(file); 
        hash.update(await readFile(resolve(output, file))) 
      }

      const cache = `salebase-shell-${hash.digest('hex').slice(0, 16)}`

      await writeFile(resolve(output, 'sw.js'), `
        const CACHE = ${JSON.stringify(cache)};
        const ASSETS = ${JSON.stringify(assets.map(file => '/' + file))};

        self.addEventListener('install', event => {
          event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
            ASSETS.map(url => new Request(url, { cache: 'reload' }))
          )));
        });

        self.addEventListener('message', event => {
          if (event.data === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
        });

        self.addEventListener('activate', event => {
          event.waitUntil(caches.keys().then(keys => Promise.all(
            keys.filter(key => key.startsWith('salebase-shell-') && key !== CACHE)
              .map(key => caches.delete(key))
          )).then(() => self.clients.claim()));
        });

        self.addEventListener('fetch', event => {
          const request = event.request;
          const url = new URL(request.url);

          if (request.method !== 'GET' || url.origin !== self.location.origin) return;
          
          if (request.mode === 'navigate') {
            event.respondWith((async () => {
              let response;
              let networkError;
              try {
                response = await fetch(request, { cache: 'no-cache' });
                if (response.status < 500) return response;
              } catch (error) {
                networkError = error;
              }
              const cache = await caches.open(CACHE);
              const offlineShell = await cache.match('/index.html');
              if (offlineShell) return offlineShell;
              if (response) return response;
              throw networkError;
            })());
          } else if (ASSETS.includes(url.pathname)) {
            event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname))
              .then(response => response || fetch(request)));
          }
        });
        `)
    },
  }
}
