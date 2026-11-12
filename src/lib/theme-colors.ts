// Map libraries (MapLibre, Google) take colours as plain strings, not CSS
// variables, so read the current theme's tokens from the page when drawing.
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function mapColors() {
  return {
    pin: token('--color-sprout-deep', '#067647'),
    pinStroke: token('--color-surface', '#ffffff'),
    selected: token('--color-forest', '#053B2B'),
    verified: token('--color-lime', '#B6F04A'),
    cluster: token('--color-forest', '#053B2B'),
    clusterHalo: token('--color-sprout', '#12B76A'),
    background: token('--color-map', '#e8f3ec'),
  };
}
