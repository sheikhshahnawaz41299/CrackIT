import { registerPlugin } from '@capacitor/core';
const CapacitorDownloader = registerPlugin('CapacitorDownloader', {
    web: () => import('./web').then((m) => new m.CapacitorDownloaderWeb()),
});
export * from './definitions';
export { CapacitorDownloader };
//# sourceMappingURL=index.js.map