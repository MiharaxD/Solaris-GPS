import type { MapInfo } from "./maps";

/** "simulacrum-nexus-mengzhou" → "Simulacrum Nexus Mengzhou" */
export function mapLabel(name: string): string {
  return name
    .split("-")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Dropdown com os mapas do maps.json. Chama `onChange` com o `name` escolhido. */
export function createMapPicker(
  host: HTMLElement,
  maps: readonly MapInfo[],
  selected: string,
  onChange: (name: string) => void,
): HTMLSelectElement {
  const select = document.createElement("select");
  select.className = "map-picker";
  select.setAttribute("aria-label", "Mapa");
  for (const m of maps) {
    const opt = document.createElement("option");
    opt.value = m.name;
    opt.textContent = mapLabel(m.name);
    select.append(opt);
  }
  select.value = selected;
  select.addEventListener("change", () => onChange(select.value));
  host.append(select);
  return select;
}
