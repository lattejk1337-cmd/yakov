import { generateMaterial } from './textures.js';

self.onmessage = (e) => {
  const { id, size } = e.data;
  const { albedo, normal } = generateMaterial(id, size);
  self.postMessage({ id, albedo: albedo.buffer, normal: normal.buffer }, [albedo.buffer, normal.buffer]);
};
