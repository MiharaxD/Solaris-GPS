/**
 * Imagens em memória do pipeline do tracker. Código puro (sem DOM): roda no Web Worker e no
 * runner de fixtures em Node.
 */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Gray {
  width: number;
  height: number;
  data: Float32Array;
}

/** Recorte retangular (cópia), cortado nas bordas da imagem. */
export function subImage(img: Rgba, x: number, y: number, w: number, h: number): Rgba {
  const x0 = Math.max(0, Math.floor(x));
  const y0 = Math.max(0, Math.floor(y));
  const x1 = Math.min(img.width, Math.floor(x + w));
  const y1 = Math.min(img.height, Math.floor(y + h));
  const ow = Math.max(0, x1 - x0);
  const oh = Math.max(0, y1 - y0);
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let row = 0; row < oh; row++) {
    const src = ((y0 + row) * img.width + x0) * 4;
    out.set(img.data.subarray(src, src + ow * 4), row * ow * 4);
  }
  return { width: ow, height: oh, data: out };
}

/** Luminância (0–255), reduzida por média em blocos f×f. */
export function toGray(img: Rgba, f = 1): Gray {
  const w = Math.floor(img.width / f);
  const h = Math.floor(img.height / f);
  const out = new Float32Array(w * h);
  const d = img.data;
  const inv = 1 / (f * f);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        let i = ((y * f + dy) * img.width + x * f) * 4;
        for (let dx = 0; dx < f; dx++, i += 4) s += 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
      }
      out[y * w + x] = s * inv;
    }
  }
  return { width: w, height: h, data: out };
}

/** Reamostra (bilinear) pra um tamanho novo. Usado pra simular outras resoluções. */
export function resize(img: Rgba, w: number, h: number): Rgba {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy);
    const y1 = Math.min(img.height - 1, y0 + 1);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx);
      const x1 = Math.min(img.width - 1, x0 + 1);
      const tx = fx - x0;
      for (let c = 0; c < 4; c++) {
        const a = img.data[(y0 * img.width + x0) * 4 + c]!;
        const b = img.data[(y0 * img.width + x1) * 4 + c]!;
        const cc = img.data[(y1 * img.width + x0) * 4 + c]!;
        const dd = img.data[(y1 * img.width + x1) * 4 + c]!;
        out[(y * w + x) * 4 + c] = (a * (1 - tx) + b * tx) * (1 - ty) + (cc * (1 - tx) + dd * tx) * ty;
      }
    }
  }
  return { width: w, height: h, data: out };
}

/** Cola uma imagem pequena num frame liso (`w`×`h`) em (x, y). Usado pra testar recortes do minimapa. */
export function embedInFrame(img: Rgba, w = 2560, h = 1440, x = 40, y = 40, rgb: [number, number, number] = [30, 45, 40]): Rgba {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = 255;
  }
  for (let row = 0; row < img.height && y + row < h; row++) {
    const n = Math.min(img.width, w - x);
    data.set(img.data.subarray(row * img.width * 4, row * img.width * 4 + n * 4), ((y + row) * w + x) * 4);
  }
  return { width: w, height: h, data };
}
