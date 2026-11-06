/**
 * Presença do minimapa (ticket 27). Menu, inventário, diálogo, mapa aberto, cutscene e tela de
 * carregamento escondem o HUD: aí o rastreio pausa em vez de casar lixo, e retoma de onde parou
 * quando o minimapa volta. O sinal é o anel claro da borda (o mesmo da detecção), procurado com
 * uns px de folga em volta da região conhecida. Código puro: roda no Worker e no runner.
 */
import { ringNear, type Detection, type MinimapRegion } from "./minimap";
import type { ReadRect } from "./pipeline";

export interface PresenceOptions {
  /** Score do anel (0–1) a partir do qual o minimapa está à vista. */
  present: number;
  /** Abaixo disso conta como ausente; entre os dois mantém o estado (histerese). */
  absent: number;
  /** Frames seguidos abaixo de `absent` pra pausar (um frame ruim não pausa). */
  absentFrames: number;
  /** Folga da busca do anel, em fração do raio. */
  slack: number;
}

/** Nos prints: com minimapa, ≥ 0,67; nas telas sem ele simuladas pelo runner, ≤ 0,35. */
export const DEFAULT_PRESENCE: PresenceOptions = { present: 0.5, absent: 0.4, absentFrames: 2, slack: 0.06 };

/** Score do anel em volta de `reg` no frame (com a região ajustada, se precisou procurar). */
export function minimapPresence(read: ReadRect, frameW: number, frameH: number, reg: MinimapRegion, opt: PresenceOptions = DEFAULT_PRESENCE): Detection {
  const slack = Math.max(3, Math.round(reg.r * opt.slack));
  const m = slack + 3;
  const x = Math.max(0, Math.floor(reg.cx - reg.r - m));
  const y = Math.max(0, Math.floor(reg.cy - reg.r - m));
  const w = Math.min(frameW, Math.ceil(reg.cx + reg.r + m)) - x;
  const h = Math.min(frameH, Math.ceil(reg.cy + reg.r + m)) - y;
  return ringNear(read(x, y, w, h), x, y, reg, slack, opt.present);
}

/** Histerese: some com `absentFrames` frames seguidos fracos, volta com um frame forte. */
export class PresenceGate {
  visible = true;
  private weak = 0;

  constructor(private readonly opt: PresenceOptions = DEFAULT_PRESENCE) {}

  /** Devolve se o minimapa está à vista depois deste score. */
  update(score: number): boolean {
    if (score >= this.opt.present) {
      this.weak = 0;
      this.visible = true;
    } else if (score < this.opt.absent) {
      if (++this.weak >= this.opt.absentFrames) this.visible = false;
    } else this.weak = 0;
    return this.visible;
  }

  clear(): void {
    this.visible = true;
    this.weak = 0;
  }
}
