import { describe, expect, it } from "vitest";
import { JumpGate, MotionFilter } from "./motion";

/** Ruído pseudoaleatório determinístico em [-a, a]. */
function noise(seed: number) {
  let s = seed;
  return (a: number) => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (s / 2147483648 - 0.5) * 2 * a;
  };
}

describe("MotionFilter", () => {
  it("andando em linha reta com ruído: erro menor que o da medição e sem atraso", () => {
    const f = new MotionFilter();
    const rnd = noise(7);
    const v: [number, number] = [60, -25]; // px/s
    let errRaw = 0;
    let errOut = 0;
    let bias = 0;
    let n = 0;
    for (let i = 0; i < 100; i++) {
      const t = i * 100;
      const truth: [number, number] = [500 + (v[0] * t) / 1000, 400 + (v[1] * t) / 1000];
      const z: [number, number] = [truth[0] + rnd(4), truth[1] + rnd(4)];
      const out = f.update(z, t, 4);
      if (i < 30) continue; // convergência
      errRaw += Math.hypot(z[0] - truth[0], z[1] - truth[1]);
      errOut += Math.hypot(out[0] - truth[0], out[1] - truth[1]);
      // atraso apareceria como erro sempre do mesmo lado (atrás do movimento)
      bias += ((out[0] - truth[0]) * v[0] + (out[1] - truth[1]) * v[1]) / Math.hypot(...v);
      n++;
    }
    expect(errOut / n).toBeLessThan((errRaw / n) * 0.7);
    expect(Math.abs(bias / n)).toBeLessThan(0.5);
  });

  it("intervalos irregulares (frames pulados) seguem a trajetória", () => {
    const f = new MotionFilter();
    const ts = [0, 100, 200, 300, 400, 900, 1000, 1100, 2100, 2200, 2300];
    let out: [number, number] = [0, 0];
    for (const t of ts) out = f.update([100 + 0.05 * t, 200], t, 2);
    expect(Math.hypot(out[0] - (100 + 0.05 * 2300), out[1] - 200)).toBeLessThan(1.5);
  });

  it("reset pula direto pro ponto novo", () => {
    const f = new MotionFilter();
    f.update([10, 10], 0, 2);
    f.update([12, 10], 100, 2);
    f.reset([3000, 1500], 200);
    expect(f.position).toEqual([3000, 1500]);
    const out = f.update([3001, 1500], 300, 2);
    expect(Math.hypot(out[0] - 3001, out[1] - 1500)).toBeLessThan(1);
  });
});

describe("JumpGate", () => {
  const opt = { maxSpeed: 150, jumpSlack: 40, confirmRepeats: 3, agree: 20 };

  it("sem posição anterior ou com Find me/teleporte confirmado, aceita e recomeça", () => {
    const g = new JumpGate(opt);
    expect(g.check([5000, 5000], null, 0, false, true)).toBe("reset");
    expect(g.check([5000, 5000], [100, 100], 100, true, false)).toBe("reset");
  });

  it("dentro do alcance aceita; salto local além da velocidade máxima é descartado", () => {
    const g = new JumpGate(opt);
    expect(g.check([150, 100], [100, 100], 100, false, false)).toBe("ok"); // 50 ≤ 40 + 15
    expect(g.check([200, 100], [100, 100], 100, false, false)).toBe("reject"); // 100 > 55
    expect(g.check([200, 100], [100, 100], 1000, false, false)).toBe("ok"); // 100 ≤ 190
  });

  it("salto da busca global sem ícone só vale repetido no mesmo lugar", () => {
    const g = new JumpGate(opt);
    expect(g.check([3000, 3000], [100, 100], 2000, false, true)).toBe("reject");
    expect(g.check([3005, 2998], [100, 100], 4000, false, true)).toBe("reject");
    expect(g.check([3002, 3001], [100, 100], 6000, false, true)).toBe("reset");
  });

  it("resultados globais em lugares diferentes não se confirmam", () => {
    const g = new JumpGate(opt);
    expect(g.check([3000, 3000], [100, 100], 2000, false, true)).toBe("reject");
    expect(g.check([5000, 800], [100, 100], 4000, false, true)).toBe("reject");
    expect(g.check([3000, 3000], [100, 100], 6000, false, true)).toBe("reject");
  });
});
