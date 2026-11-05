# 22: Heading pela seta

**What to build:** Detecto a direção do jogador comparando a seta no centro do minimapa com o sprite rotacionado de 0 a 359°.

**Blocked by:** 17

**Status:** em andamento (falta direção anotada nos fixtures)

- [x] Ângulo 0–359 por frame (o cone de visão é da câmera, não do jogador: não usar como direção). Pelo eixo de simetria da silhueta da seta, sem sprite.
- [ ] Erro angular medido nos fixtures com direção anotada. Nenhum print tem direção; conferência indireta: parado, o cone aponta pra frente, e seta e cone ficam a ≤ 9,5° onde o cone foi bem detectado; 1440p e 1080p diferem ≤ 2°.
- [x] Tempo por frame reportado (1–9 ms no runner, ~2 ms no navegador)
