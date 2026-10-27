export type ChainTheme = 'classic' | 'monochrome' | 'plush';
export function chainTheme(id?: string): ChainTheme {
  return id === 'monochrome' || id === 'plush' ? id : 'classic';
}
export const chainMaterials = {
  classic: {
    textures: ['chain-steel.png'],
    aspect: 128 / 72,
    shades: [0.52, 0.8, 1.25],
    flash: '#fff9e5',
    melt: '#ff993e',
    spark: '#ffdeb0',
  },
  monochrome: {
    textures: ['chain-silver.png', 'chain-black.png'],
    aspect: 128 / 72,
    shades: [1, 1, 0.86, 1.08],
    flash: '#ffffff',
    melt: '#ffb269',
    spark: '#ecf6ff',
  },
  plush: {
    textures: ['chain-plush.png'],
    aspect: 256 / 72,
    shades: [0.94, 1, 1.06],
    flash: '#fff8ff',
    melt: '#ffb2d6',
    spark: '#ffe3f3',
  },
} as const;
