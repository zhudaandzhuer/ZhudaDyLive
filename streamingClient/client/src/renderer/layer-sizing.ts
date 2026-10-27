import type { SceneLayer } from '@zhuda/contracts';

type Size = { width: number; height: number };
export function layerViewport(layer: Pick<SceneLayer, 'width' | 'height' | 'contentSize'>) {
  const size = layer.contentSize ?? layer;
  return {
    width: size.width,
    height: size.height,
    scale: layer.contentSize ? Math.min(layer.width / size.width, layer.height / size.height) : 1,
  };
}
export function scaleLayerSize(size: Size, factor: number): Size {
  const bounded = Math.max(
    Math.max(16 / size.width, 16 / size.height),
    Math.min(Math.min(8192 / size.width, 8192 / size.height), factor),
  );
  return { width: size.width * bounded, height: size.height * bounded };
}
export function resizeLayerSize(
  layer: Pick<SceneLayer, 'width' | 'height' | 'contentSize'>,
  dx: number,
  dy: number,
): Size {
  if (layer.contentSize)
    return scaleLayerSize(
      layer,
      1 + (dx * layer.width + dy * layer.height) / (layer.width ** 2 + layer.height ** 2),
    );
  return {
    width: Math.max(16, Math.min(8192, layer.width + dx)),
    height: Math.max(16, Math.min(8192, layer.height + dy)),
  };
}
