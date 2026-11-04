import L from "leaflet";
import { apply, fitAffine, type FitResult } from "./affine";
import type { MapInfo } from "./maps";
import type { MapView } from "./mapView";
import {
  asMapDataV1,
  downloadMapData,
  loadMapData,
  saveMapData,
  type CalibrationPoint,
  type MapDataV1,
} from "./mapData";
import { loadRefs, type GameRef } from "./refs";

/** Resíduo (px no zoom máximo) acima do qual o ponto é destacado como suspeito. */
const WARN_PX = 24;

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));

/**
 * Painel de calibração jogo→pixel do mapa ativo. Fluxo: escolher uma referência do
 * WutheringData (ou digitar X/Y) → clicar no mapa onde ela fica. Com 3+ pontos mostra a afim,
 * o resíduo de cada ponto e onde as outras referências cairiam.
 */
export class CalibrationPanel {
  readonly root: HTMLElement;
  private info: MapInfo | null = null;
  private data: MapDataV1 = asMapDataV1(null);
  private refs: GameRef[] = [];
  private fit: FitResult | null = null;
  private dirty = false;
  private open = false;
  private loadSeq = 0;

  private readonly pointsLayer = L.layerGroup();
  private readonly predictedLayer = L.layerGroup();
  private readonly refInput = h("input", { type: "search", placeholder: "Buscar teleporte ou Nexus…" });
  private readonly refList = h("datalist", { id: "calib-refs" });
  private readonly gameX = h("input", { type: "number", placeholder: "X do jogo" });
  private readonly gameY = h("input", { type: "number", placeholder: "Y do jogo" });
  private readonly hint = h("p", { className: "calib-hint" });
  private readonly table = h("tbody");
  private readonly stats = h("p", { className: "calib-stats" });
  private readonly status = h("p", { className: "calib-status", role: "status" } as Partial<HTMLParagraphElement>);
  private readonly showPredicted = h("input", { type: "checkbox", checked: true });
  private readonly saveBtn = h("button", { type: "button", textContent: "Salvar" });

  constructor(private readonly view: MapView) {
    this.refInput.setAttribute("list", this.refList.id);
    const close = h("button", { type: "button", className: "calib-close", textContent: "✕", title: "Fechar" });
    close.addEventListener("click", () => this.toggle(false));
    const download = h("button", { type: "button", textContent: "Baixar JSON", className: "secondary" });
    download.addEventListener("click", () => this.info && downloadMapData(this.info.name, this.serialize()));
    this.saveBtn.addEventListener("click", () => void this.save());
    this.showPredicted.addEventListener("change", () => this.renderPredicted());
    for (const el of [this.refInput, this.gameX, this.gameY]) el.addEventListener("input", () => this.renderHint());

    this.root = h(
      "aside",
      { className: "calib-panel", hidden: true },
      h("header", {}, h("h2", { textContent: "Calibração" }), close),
      h("label", { className: "calib-field" }, "Referência", this.refInput, this.refList),
      h("div", { className: "calib-manual" }, h("span", { textContent: "ou coordenada:" }), this.gameX, this.gameY),
      this.hint,
      h(
        "table",
        { className: "calib-table" },
        h("thead", {}, h("tr", {}, h("th", { textContent: "#" }), h("th", { textContent: "Ponto" }),
          h("th", { textContent: "Erro (px)" }), h("th"))),
        this.table,
      ),
      this.stats,
      h("label", { className: "calib-check" }, this.showPredicted, "Mostrar onde as outras referências cairiam"),
      h("div", { className: "calib-actions" }, this.saveBtn, download),
      this.status,
    );

    view.leaflet.on("click", (e) => {
      if (this.open) this.addPointAt(e.latlng);
    });
    window.addEventListener("beforeunload", (e) => {
      if (this.dirty) e.preventDefault();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.hidden = !this.open;
    this.view.leaflet.getContainer().classList.toggle("calibrating", this.open);
    if (this.open) {
      this.pointsLayer.addTo(this.view.leaflet);
      this.predictedLayer.addTo(this.view.leaflet);
      this.render();
    } else {
      this.pointsLayer.remove();
      this.predictedLayer.remove();
    }
  }

  /** Pergunta antes de descartar pontos não salvos. false = não trocar de mapa. */
  canLeave(): boolean {
    return !this.dirty || !this.info || confirm(`Há pontos de calibração não salvos em ${this.info.name}. Descartar?`);
  }

  /** Troca de mapa: carrega data/maps e as referências daquele mapa. */
  async setMap(info: MapInfo): Promise<void> {
    const seq = ++this.loadSeq;
    this.info = info;
    this.dirty = false;
    this.data = asMapDataV1(null);
    this.refs = [];
    this.render();
    try {
      const [raw, refs] = await Promise.all([loadMapData(info.name), loadRefs(info.name)]);
      if (seq !== this.loadSeq) return;
      this.data = asMapDataV1(raw);
      this.refs = refs;
      this.setStatus(raw ? `Carregado data/maps/${info.name}.json` : "Sem calibração salva para este mapa.");
    } catch (e) {
      if (seq !== this.loadSeq) return;
      this.setStatus(`Não consegui ler os dados do mapa (${(e as Error).message}).`);
      this.refs = await loadRefs(info.name);
    }
    this.render();
  }

  private get points(): CalibrationPoint[] {
    return this.data.calibration?.points ?? [];
  }

  private pendingGame(): { game: [number, number]; ref?: GameRef } | null {
    const label = this.refInput.value.trim();
    if (label) {
      const ref = this.refs.find((r) => r.label === label);
      return ref ? { game: [ref.x, ref.y], ref } : null;
    }
    const x = this.gameX.valueAsNumber;
    const y = this.gameY.valueAsNumber;
    return Number.isFinite(x) && Number.isFinite(y) ? { game: [x, y] } : null;
  }

  private addPointAt(latlng: L.LatLng): void {
    const pending = this.pendingGame();
    if (!pending) {
      this.setStatus("Escolha uma referência (ou digite X e Y) antes de clicar no mapa.");
      return;
    }
    const p = this.view.toPixel(latlng);
    const point: CalibrationPoint = {
      id: crypto.randomUUID(),
      game: pending.game,
      px: [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10],
      ...(pending.ref ? { refId: pending.ref.id } : {}),
    };
    this.data.calibration = { ...this.data.calibration, points: [...this.points, point] };
    this.refInput.value = "";
    this.gameX.value = "";
    this.gameY.value = "";
    this.dirty = true;
    this.render();
  }

  private removePoint(id: string): void {
    this.data.calibration = { ...this.data.calibration, points: this.points.filter((p) => p.id !== id) };
    this.dirty = true;
    this.render();
  }

  private movePoint(id: string, latlng: L.LatLng): void {
    const p = this.view.toPixel(latlng);
    const pt = this.points.find((q) => q.id === id);
    if (!pt) return;
    pt.px = [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
    this.dirty = true;
    this.render();
  }

  private serialize(): MapDataV1 {
    const cal = { ...this.data.calibration, points: this.points };
    if (this.fit) {
      cal.affine = [...this.fit.affine];
      cal.rms = Math.round(this.fit.rms * 100) / 100;
    } else {
      delete cal.affine;
      delete cal.rms;
    }
    return { ...this.data, version: 1, calibration: cal };
  }

  private async save(): Promise<void> {
    if (!this.info) return;
    const name = this.info.name;
    this.saveBtn.disabled = true;
    try {
      const path = await saveMapData(name, this.serialize());
      if (this.info?.name === name) this.dirty = false;
      this.setStatus(`Salvo em ${path}.`);
    } catch (e) {
      this.setStatus(`Não salvou (${(e as Error).message}). Use "Baixar JSON".`);
    } finally {
      this.saveBtn.disabled = false;
      this.renderStats();
    }
  }

  private setStatus(msg: string): void {
    this.status.textContent = msg;
  }

  private render(): void {
    this.fit = fitAffine(this.points);
    this.renderRefList();
    this.renderHint();
    this.renderTable();
    this.renderStats();
    this.renderMarkers();
    this.renderPredicted();
  }

  private renderRefList(): void {
    const used = new Set(this.points.map((p) => p.refId));
    this.refList.replaceChildren(
      ...this.refs.filter((r) => !used.has(r.id)).map((r) => h("option", { value: r.label })),
    );
    this.refInput.disabled = this.refs.length === 0;
    this.refInput.placeholder = this.refs.length
      ? `Buscar entre ${this.refs.length} teleportes/Nexus…`
      : "Sem referências para este mapa (use X/Y)";
  }

  private renderHint(): void {
    const pending = this.pendingGame();
    const n = this.points.length;
    this.hint.textContent = pending
      ? `Agora clique no mapa onde fica ${pending.ref ? pending.ref.label : "esse ponto"}.`
      : n < 3
        ? `Escolha uma referência e clique onde ela fica no mapa. Faltam ${3 - n} ponto(s) para a afim.`
        : "Adicione mais pontos espalhados para reduzir o erro, ou arraste um ponto para ajustar.";
  }

  /** Rótulo vem das referências locais (não é salvo em data/maps, que vai pro repositório). */
  private pointLabel(p: CalibrationPoint): string {
    const ref = p.refId ? this.refs.find((r) => r.id === p.refId) : undefined;
    return ref?.label ?? p.label ?? `(${fmt(p.game[0])}, ${fmt(p.game[1])})`;
  }

  private renderTable(): void {
    this.table.replaceChildren(
      ...this.points.map((p, i) => {
        const res = this.fit?.residuals[i];
        const del = h("button", { type: "button", className: "link", textContent: "remover" });
        del.addEventListener("click", () => this.removePoint(p.id));
        const resCell = h("td", { textContent: res === undefined ? "—" : fmt(res) });
        if (res !== undefined && res > WARN_PX) resCell.className = "warn";
        return h(
          "tr",
          {},
          h("td", { textContent: String(i + 1) }),
          h("td", { textContent: this.pointLabel(p), title: `px ${p.px.join(", ")}` }),
          resCell,
          h("td", {}, del),
        );
      }),
    );
  }

  private renderStats(): void {
    const n = this.points.length;
    this.stats.textContent = this.fit
      ? `${n} pontos · erro médio (RMS) ${fmt(this.fit.rms)} px · máx ${fmt(this.fit.max)} px${this.dirty ? " · não salvo" : ""}`
      : `${n} ponto(s)${this.dirty ? " · não salvo" : ""}`;
  }

  private renderMarkers(): void {
    this.pointsLayer.clearLayers();
    if (!this.info) return;
    this.points.forEach((p, i) => {
      const res = this.fit?.residuals[i];
      const icon = L.divIcon({
        className: `calib-pt${res !== undefined && res > WARN_PX ? " warn" : ""}`,
        html: `<span>${i + 1}</span>`,
        iconSize: [22, 22],
      });
      const m = L.marker(this.view.toLatLng({ x: p.px[0], y: p.px[1] }), { icon, draggable: true });
      m.bindTooltip(this.pointLabel(p), { direction: "top", offset: [0, -10] });
      m.on("dragend", () => this.movePoint(p.id, m.getLatLng()));
      m.addTo(this.pointsLayer);
      // vetor de erro: do clique até onde a afim prevê
      if (this.fit) {
        const [x, y] = apply(this.fit.affine, p.game);
        L.polyline([m.getLatLng(), this.view.toLatLng({ x, y })], { className: "calib-err", interactive: false })
          .addTo(this.pointsLayer);
      }
    });
  }

  private renderPredicted(): void {
    this.predictedLayer.clearLayers();
    if (!this.fit || !this.showPredicted.checked || !this.info) return;
    const used = new Set(this.points.map((p) => p.refId));
    for (const r of this.refs) {
      if (used.has(r.id)) continue;
      const [x, y] = apply(this.fit.affine, [r.x, r.y]);
      L.circleMarker(this.view.toLatLng({ x, y }), {
        radius: r.kind === "nexus" ? 6 : 4,
        className: `calib-pred ${r.kind}`,
        interactive: true,
      })
        .bindTooltip(r.label)
        .on("click", (e) => {
          // atalho: clicar num previsto seleciona a referência (o próximo clique posiciona)
          L.DomEvent.stopPropagation(e);
          this.refInput.value = r.label;
          this.renderHint();
        })
        .addTo(this.predictedLayer);
    }
  }
}
