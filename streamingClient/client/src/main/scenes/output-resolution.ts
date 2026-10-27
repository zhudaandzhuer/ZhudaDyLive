type Size = { width: number; height: number };

/** Scene pixels are capture pixels; native window sizes are device-independent units. */
export function sceneOutputGeometry(scene: Size, displayScale: number) {
  const density = Number.isFinite(displayScale) && displayScale > 0 ? displayScale : 1;
  return {
    // Round up so fractional Windows scaling cannot clip the final scene pixel.
    width: Math.ceil(scene.width / density),
    height: Math.ceil(scene.height / density),
    zoomFactor: 1 / density,
  };
}
