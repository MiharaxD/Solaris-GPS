/**
 * "Onde estou": região do mapa (só nos mapas com regiões, como o Overworld). A escolha limita a
 * busca do tracker no mapa inteiro, que fica mais rápida e erra menos; fica salva por mapa.
 */
import type { Region } from "./regions";
import { loadPref, savePref } from "./storage";

const prefKey = (map: string) => `tracker.region.${map}`;

export class RegionPicker {
  readonly root = document.createElement("select");
  private map = "";
  private regions: readonly Region[] = [];

  constructor(private readonly onPick: (region: Region | null, byUser: boolean) => void) {
    this.root.className = "map-picker region-picker";
    this.root.title = "Região onde você está: o tracker procura só nela (troque se for pra outra região)";
    this.root.setAttribute("aria-label", "Região onde você está");
    this.root.hidden = true;
    this.root.addEventListener("change", () => {
      savePref(prefKey(this.map), this.root.value);
      this.onPick(this.current(), true);
    });
  }

  /** Regiões do mapa ativo (vazio = esconde o seletor e libera o mapa inteiro). */
  setRegions(map: string, regions: readonly Region[]): void {
    const changedMap = map !== this.map;
    const before = this.root.value;
    this.map = map;
    this.regions = regions;
    this.root.hidden = regions.length === 0;
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Região: todas";
    const opts: HTMLElement[] = [all];
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const r of regions) {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = r.label;
      if (!r.group) {
        opts.push(opt);
        continue;
      }
      let g = groups.get(r.group);
      if (!g) {
        g = document.createElement("optgroup");
        g.label = r.group;
        groups.set(r.group, g);
        opts.push(g);
      }
      g.append(opt);
    }
    this.root.replaceChildren(...opts);
    const want = changedMap ? (loadPref(prefKey(map)) ?? "") : before;
    this.root.value = regions.some((r) => r.id === want) ? want : "";
    this.onPick(this.current(), false);
  }

  current(): Region | null {
    return this.regions.find((r) => r.id === this.root.value) ?? null;
  }
}
