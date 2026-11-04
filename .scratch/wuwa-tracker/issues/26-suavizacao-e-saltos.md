# 26: Suavização e saltos

**What to build:** A posição exibida é suave e não pula para lugares impossíveis, exceto teleporte confirmado pela camada de referências.

**Blocked by:** 25 (Loop ao vivo a 10 Hz no mapa web)

**Status:** ready-for-agent

- [ ] Kalman ou média exponencial (escolha justificada)
- [ ] Descarte de saltos acima de velocidade máxima
- [ ] Salto grande aceito quando a camada de referências confirma
