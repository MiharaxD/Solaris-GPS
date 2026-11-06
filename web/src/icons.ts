/**
 * Ícones próprios do Solaris GPS, no vocabulário do dossiê visual: glifos de traço único claro
 * sobre um selo escuro, com a cor só no anel (categoria ou raridade). Teleporte e Nexus seguem a
 * silhueta dos ícones do minimapa (branco com contorno ciano), sem selo.
 * Tudo é SVG inline: nada é baixado em runtime.
 */

export type MarkerIcon = "beacon" | "nexus" | "chest" | "casket" | "plant" | "ore" | "collectible" | "personal" | "dot";

/** Glifos de sistema (barra de ferramentas): traço único, cor do texto atual. */
export type UiIcon = "markers" | "layers" | "crosshair" | "camera" | "radar" | "logo" | "close" | "search";

const INK = "#EDEFF2";
const CYAN = "#3FD3F2";
const DEEP = "#071820";

/** Glifos dos selos (grade 32×32, área útil 9–23). */
const GLYPHS: Record<Exclude<MarkerIcon, "beacon" | "nexus">, string> = {
  chest: `<path d="M9.5 15h13v7.5h-13z M9.5 15v-2.2a3 3 0 0 1 3-3h7a3 3 0 0 1 3 3V15 M16 13.5v3.5"/>`,
  casket: `<path d="M9.5 12.5h13 M10.5 12.5l1.3 10h8.4l1.3-10 M12 9.5h8 M12.8 17.6c1.1-1.4 2.1-1.4 3.2 0s2.1 1.4 3.2 0"/>`,
  plant: `<path d="M16 23.5v-8 M16 17c-3.8 0-6-2.4-6-6 3.8 0 6 2.4 6 6z M16 15c0-3.4 2.4-5.8 6-5.8 0 3.4-2.4 5.8-6 5.8z"/>`,
  ore: `<path d="M13.5 23.5l-2.8-8.2 4.3-6.3 4.3 6.3-2.1 8.2z M15 9v14.5 M18.6 23.5l1.4-6 2.6 2.4-.9 3.6z"/>`,
  collectible: `<path d="M16 8.5c.7 4.4 2.9 6.8 7.5 7.5-4.6.7-6.8 3.1-7.5 7.5-.7-4.4-2.9-6.8-7.5-7.5 4.6-.7 6.8-3.1 7.5-7.5z"/>`,
  personal: `<path d="M16 24s-5.8-6-5.8-10.2a5.8 5.8 0 0 1 11.6 0C21.8 18 16 24 16 24z"/><circle cx="16" cy="13.8" r="2"/>`,
  dot: `<circle cx="16" cy="16" r="3" fill="${INK}"/>`,
};

/** Teleporte (beacon): pilha vertical do minimapa — cabeça, haste, anel e base. */
const BEACON_PARTS = `
  <rect x="11" y="2.5" width="10" height="8.5" rx="1.6"/>
  <rect x="14.4" y="11" width="3.2" height="9"/>
  <rect x="12" y="19.5" width="8" height="3.2" rx="1"/>
  <path d="M13.2 22.7h5.6l2.2 6.3H11z"/>`;
const BEACON_DETAIL = `<rect x="13.6" y="5.4" width="4.8" height="2.6" rx=".6" fill="${CYAN}" stroke="none"/>`;

/** Nexus: anel aberto em cima e embaixo, núcleo azul e o pilar em "I" atravessando. */
const NEXUS_RING = `<path d="M11.2 6.2A11 11 0 0 0 11.2 25.8 M20.8 6.2A11 11 0 0 1 20.8 25.8"/>`;
const NEXUS_PILLAR = `<path d="M10.5 3.5h11v3.4h-3.6v18.2h3.6v3.4h-11v-3.4h3.6V6.9h-3.6z"/>`;

function svg(body: string, size = 32): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}">${body}</svg>`;
}

/** SVG completo do ícone de marcador. `color` pinta o anel do selo (ignorada em beacon/nexus). */
export function markerSvg(icon: MarkerIcon, color: string, size = 32): string {
  if (icon === "beacon") {
    return svg(
      `<g stroke="${DEEP}" stroke-width="4" stroke-linejoin="round" fill="${DEEP}">${BEACON_PARTS}</g>` +
        `<g stroke="${CYAN}" stroke-width="1.6" stroke-linejoin="round" fill="#FFFFFF">${BEACON_PARTS}</g>${BEACON_DETAIL}`,
      size,
    );
  }
  if (icon === "nexus") {
    return svg(
      `<g fill="none" stroke-linecap="round"><g stroke="${DEEP}" stroke-width="7.4">${NEXUS_RING}</g>` +
        `<g stroke="${CYAN}" stroke-width="5">${NEXUS_RING}</g><g stroke="#FFFFFF" stroke-width="2">${NEXUS_RING}</g></g>` +
        `<circle cx="16" cy="16" r="6.4" fill="${DEEP}"/><circle cx="16" cy="16" r="5" fill="#2E9BE6" stroke="${CYAN}" stroke-width="1.2"/>` +
        `<g stroke-linejoin="round"><path stroke="${DEEP}" stroke-width="3.6" fill="${DEEP}" d="M10.5 3.5h11v3.4h-3.6v18.2h3.6v3.4h-11v-3.4h3.6V6.9h-3.6z"/>` +
        `<g fill="#FFFFFF" stroke="${CYAN}" stroke-width="1.3">${NEXUS_PILLAR}</g></g>`,
      size,
    );
  }
  // Selo: disco escuro translúcido, anel na cor do código e glifo claro de traço único.
  return svg(
    `<circle cx="16" cy="16" r="13.6" fill="${DEEP}" fill-opacity=".55"/>` +
      `<circle cx="16" cy="16" r="12.4" fill="#12161E" fill-opacity=".94" stroke="${color}" stroke-width="2.2"/>` +
      `<circle cx="16" cy="16" r="9.6" fill="${color}" fill-opacity=".14"/>` +
      `<g fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[icon]}</g>`,
    size,
  );
}

export function svgUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

/** <img> pequeno com o ícone (listas do painel). */
export function markerIconEl(icon: MarkerIcon, color: string, size = 18): HTMLImageElement {
  const img = document.createElement("img");
  img.className = "mk-icon";
  img.src = svgUrl(markerSvg(icon, color, 64));
  img.width = size;
  img.height = size;
  img.alt = "";
  img.decoding = "async";
  return img;
}

const UI: Record<UiIcon, string> = {
  markers: `<path d="M12 21s-5-5.2-5-8.8a5 5 0 0 1 10 0C17 15.8 12 21 12 21z"/><circle cx="12" cy="12.2" r="1.7"/><path d="M17.5 5.5l1.2-1.2 M19 9h1.6"/>`,
  layers: `<path d="M12 4l8.5 4.5L12 13 3.5 8.5z M3.5 12.2L12 16.7l8.5-4.5 M3.5 15.9L12 20.4l8.5-4.5"/>`,
  crosshair: `<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5 M12 16.5v5 M2.5 12h5 M16.5 12h5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`,
  camera: `<path d="M3.5 8.5h3.2L8.4 6h7.2l1.7 2.5h3.2v10h-17z"/><circle cx="12" cy="13.3" r="3.3"/>`,
  radar: `<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12l6-6"/><circle cx="12" cy="12" r="1" fill="currentColor"/>`,
  logo: `<path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z"/><path d="M8.2 12.6c1.3-1.8 2.5-1.8 3.8 0s2.5 1.8 3.8 0" /><path d="M12 6.8v2.4"/>`,
  close: `<path d="M6.5 6.5l11 11 M17.5 6.5l-11 11"/>`,
  search: `<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/>`,
};

/** SVG inline de um glifo de sistema (currentColor, traço 1,6 px). */
export function uiIcon(name: UiIcon, size = 16): SVGSVGElement {
  const tpl = document.createElement("template");
  tpl.innerHTML = `<svg class="ui-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${UI[name]}</svg>`;
  return tpl.content.firstElementChild as SVGSVGElement;
}

const RASTER = 64;
const sprites = new Map<string, HTMLCanvasElement | null>();

/**
 * Bitmap 64×64 do ícone, pronto pro drawImage do canvas de marcadores. Na primeira chamada
 * devolve null e avisa `onReady` quando o SVG terminar de decodificar.
 */
export function markerSprite(icon: MarkerIcon, color: string, onReady: () => void): HTMLCanvasElement | null {
  const key = `${icon}|${color}`;
  if (sprites.has(key)) return sprites.get(key) ?? null;
  sprites.set(key, null);
  const img = new Image(RASTER, RASTER);
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = c.height = RASTER;
    c.getContext("2d")?.drawImage(img, 0, 0, RASTER, RASTER);
    sprites.set(key, c);
    onReady();
  };
  img.src = svgUrl(markerSvg(icon, color, RASTER));
  return null;
}
