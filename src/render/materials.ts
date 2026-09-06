import * as THREE from "three";

const cache = new Map<string, THREE.MeshStandardMaterial>();

/** Shared, light-reactive art materials. All colors are authored for this game. */
export function material(
  color: number,
  roughness = 0.55,
  metalness = 0.05,
  emissive = 0,
  opacity = 1,
): THREE.MeshStandardMaterial {
  const key = `${color}/${roughness}/${metalness}/${emissive}/${opacity}`;
  let result = cache.get(key);
  if (!result) {
    result = new THREE.MeshStandardMaterial({
      color,
      roughness,
      metalness,
      emissive: emissive ? color : 0,
      emissiveIntensity: emissive,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity >= 0.5,
      side: THREE.DoubleSide,
    });
    cache.set(key, result);
  }
  return result;
}

export const ART = {
  ink: material(0x062d39, 0.34),
  eye: material(0x06171e, 0.08, 0.16),
  white: material(0xeafaf2, 0.42),
  pearl: material(0xd6f5db, 0.22, 0.25),
  gold: material(0xf4b84a, 0.28, 0.58),
  bronze: material(0x887352, 0.56, 0.38),
  metal: material(0x547c83, 0.4, 0.6),
  rubber: material(0x183c4b, 0.74),
  glass: material(0x87e1e6, 0.14, 0.3, 0.12, 0.22),
  glow: material(0x80f9e4, 0.3, 0.08, 1.5),
};
