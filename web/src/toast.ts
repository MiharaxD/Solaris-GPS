/** Aviso curto no rodapé (resultado de atalho, desfazer…). Um por vez; some sozinho. */
let box: HTMLDivElement | null = null;
let timer = 0;

export function toast(text: string, kind: "ok" | "warn" = "ok", ms = 2600): void {
  if (!box) {
    box = document.createElement("div");
    box.className = "toast";
    box.setAttribute("role", "status");
    document.body.append(box);
  }
  box.textContent = text;
  box.dataset.kind = kind;
  box.classList.remove("show");
  void box.offsetWidth; // reinicia a animação
  box.classList.add("show");
  clearTimeout(timer);
  timer = window.setTimeout(() => box?.classList.remove("show"), ms);
}
