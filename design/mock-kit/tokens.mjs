// Reads the app's color tokens from ios/Shared/BrandPalette.swift, so mocks
// always use the colors the app ships. An override file (JSON) can replace
// any token to try a palette before changing Swift:
//   { "name": "Orange accent", "light": { "accent": "#c22d0c" }, "dark": { ... } }
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const paletteSource = path.resolve(here, '../../ios/Shared/BrandPalette.swift');

const hex = (n) => '#' + n.toLowerCase().padStart(6, '0');

/** { light: {token: '#rrggbb'}, dark: {...} } from BrandPalette.swift. */
export function readPalette(source = paletteSource) {
  const swift = readFileSync(source, 'utf8');
  const light = {}, dark = {};
  for (const m of swift.matchAll(/static let (\w+) = dynamic\(light: 0x([0-9A-Fa-f]{6}), dark: 0x([0-9A-Fa-f]{6})\)/g)) {
    light[m[1]] = hex(m[2]); dark[m[1]] = hex(m[3]);
  }
  for (const m of swift.matchAll(/static let (\w+) = fixed\(0x([0-9A-Fa-f]{6})\)/g)) {
    light[m[1]] = dark[m[1]] = hex(m[2]);
  }
  const cat = swift.match(/static let categorical: \[Color\] = \[([\s\S]*?)\]/);
  if (cat) {
    [...cat[1].matchAll(/dynamic\(light: 0x([0-9A-Fa-f]{6}), dark: 0x([0-9A-Fa-f]{6})\)/g)].forEach((m, i) => {
      light[`cat${i + 1}`] = hex(m[1]); dark[`cat${i + 1}`] = hex(m[2]);
    });
  }
  for (const required of ['bg', 'surface', 'surface2', 'text', 'muted', 'accent', 'signal']) {
    if (!light[required]) throw new Error(`BrandPalette.swift has no ${required} token; update tokens.mjs`);
  }
  return { light, dark };
}

/** The palette with an override file's tokens applied. */
export function applyOverride(palette, override = {}) {
  return {
    light: { ...palette.light, ...(override.light ?? {}) },
    dark: { ...palette.dark, ...(override.dark ?? {}) },
  };
}

const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
const vars = (t) => Object.entries(t).map(([k, v]) => `  --${kebab(k)}: ${v};`).join('\n');

/** CSS custom properties for one appearance, on :root. */
export function cssFor(tokens) {
  return `:root {\n${vars(tokens)}\n}\n`;
}
