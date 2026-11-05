/**
 * Suavização da posição exibida (ticket 26): Kalman de velocidade constante, um por eixo.
 * Escolhido no lugar da média exponencial porque não atrasa com o jogador andando (a média
 * fica sempre alguns frames atrás), aceita intervalos irregulares entre frames (frames pulados,
 * aba em segundo plano) e pesa cada medição pelo erro esperado (confiança da fusão).
 * Só a posição EXIBIDA passa pelo filtro; a busca usa a medição crua (sem atraso realimentado).
 */

export interface MotionOptions {
  /** Ruído de aceleração (px/s²): quanto a velocidade pode mudar entre frames. */
  accel: number;
}

export const DEFAULT_MOTION: MotionOptions = { accel: 60 };

class Axis {
  x = 0;
  v = 0;
  // covariância [[pxx, pxv], [pxv, pvv]]
  pxx = 1e6;
  pxv = 0;
  pvv = 1e6;

  reset(x: number): void {
    this.x = x;
    this.v = 0;
    this.pxx = 1;
    this.pxv = 0;
    this.pvv = 400;
  }

  predict(dt: number, q: number): void {
    this.x += this.v * dt;
    const { pxx, pxv, pvv } = this;
    // P = F P Fᵀ + Q, com F = [[1, dt], [0, 1]] e Q de aceleração branca
    this.pxx = pxx + 2 * dt * pxv + dt * dt * pvv + (q * dt ** 4) / 4;
    this.pxv = pxv + dt * pvv + (q * dt ** 3) / 2;
    this.pvv = pvv + q * dt * dt;
  }

  update(z: number, r: number): void {
    const s = this.pxx + r;
    const kx = this.pxx / s;
    const kv = this.pxv / s;
    const y = z - this.x;
    this.x += kx * y;
    this.v += kv * y;
    const { pxx, pxv, pvv } = this;
    this.pxx = (1 - kx) * pxx;
    this.pxv = (1 - kx) * pxv;
    this.pvv = pvv - kv * pxv;
  }
}

export class MotionFilter {
  private readonly ax = new Axis();
  private readonly ay = new Axis();
  private t: number | null = null;

  constructor(private readonly opt: MotionOptions = DEFAULT_MOTION) {}

  get position(): [number, number] | null {
    return this.t === null ? null : [this.ax.x, this.ay.x];
  }

  /** Recomeça (teleporte, Find me, troca de mapa). */
  reset(p: [number, number], t: number): void {
    this.ax.reset(p[0]);
    this.ay.reset(p[1]);
    this.t = t;
  }

  clear(): void {
    this.t = null;
  }

  /** Nova medição em `t` (ms) com erro esperado `sigma` (px). Devolve a posição suavizada. */
  update(p: [number, number], t: number, sigma: number): [number, number] {
    if (this.t === null) {
      this.reset(p, t);
      return p;
    }
    const dt = Math.max(0, Math.min(2, (t - this.t) / 1000));
    this.t = t;
    const q = this.opt.accel ** 2;
    this.ax.predict(dt, q);
    this.ay.predict(dt, q);
    this.ax.update(p[0], sigma * sigma);
    this.ay.update(p[1], sigma * sigma);
    return [this.ax.x, this.ay.x];
  }
}

export interface JumpOptions {
  /** Velocidade máxima plausível (px/s do zoom máximo; ~1 px ≈ 1 m, 150 cobre corrida, planar e gancho). */
  maxSpeed: number;
  /** Folga fixa (px) pro erro da medição e frames muito próximos. */
  jumpSlack: number;
  /** Quantas buscas globais seguidas no mesmo lugar confirmam um salto sem ícone. */
  confirmRepeats: number;
  /** Distância (px) pra duas buscas globais contarem como o mesmo lugar. */
  agree: number;
}

export const DEFAULT_JUMP: JumpOptions = { maxSpeed: 150, jumpSlack: 40, confirmRepeats: 3, agree: 20 };

/** "ok" = dentro do alcance; "reset" = salto legítimo (o filtro recomeça); "reject" = salto impossível. */
export type JumpVerdict = "ok" | "reset" | "reject";

/**
 * Barra saltos (ticket 26): a posição nova só vale a até `jumpSlack + maxSpeed × tempo desde a
 * última aceita`. Passam direto o teleporte confirmado pela busca guiada (ícone sob a seta) e o
 * Find me (`trusted`); a busca global repetida `confirmRepeats` vezes no mesmo lugar também.
 */
export class JumpGate {
  private hit: { px: [number, number]; count: number } | null = null;

  constructor(private readonly opt: JumpOptions = DEFAULT_JUMP) {}

  clear(): void {
    this.hit = null;
  }

  /** `prev` = última posição aceita (null = nenhuma); `dtMs` = tempo desde ela. */
  check(px: [number, number], prev: [number, number] | null, dtMs: number, trusted: boolean, global: boolean): JumpVerdict {
    if (!prev || trusted) {
      this.hit = null;
      return "reset";
    }
    const allowed = this.opt.jumpSlack + (this.opt.maxSpeed * Math.max(0, dtMs)) / 1000;
    if (Math.hypot(px[0] - prev[0], px[1] - prev[1]) <= allowed) {
      this.hit = null;
      return "ok";
    }
    if (!global) return "reject";
    const h = this.hit;
    this.hit = h && Math.hypot(h.px[0] - px[0], h.px[1] - px[1]) <= this.opt.agree ? { px, count: h.count + 1 } : { px, count: 1 };
    if (this.hit.count < this.opt.confirmRepeats) return "reject";
    this.hit = null;
    return "reset";
  }
}
