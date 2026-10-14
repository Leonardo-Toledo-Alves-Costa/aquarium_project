# 0001 · Conexão direta com códigos trocados por mensagem (opção A)

- **Data:** 2026-10-14
- **Situação:** aceita, em teste

## Contexto

O grupo quer substituir o compartilhamento de tela do Discord por algo interno, sem domínio e sem servidor exposto na internet. O uso é jogos, código e vídeos, normalmente com 1 pessoa transmitindo para até 4.

Conexões P2P esbarram no NAT dos roteadores. O WebRTC atravessa a maioria deles com STUN e hole punching, mas não atravessa CGNAT simétrico, que alguns provedores brasileiros usam. Foram avaliadas três opções:

| | A · Direto | B · Relay próprio | C · Rede privada |
|---|---|---|---|
| Servidor nosso | nenhum | 1 VPS | nenhum |
| Algo exposto na internet | não | sim | não |
| CGNAT simétrico | não conecta | conecta | conecta, às vezes lento |
| Como os PCs se encontram | código por mensagem | automático | automático |

## Decisão

Começar pela opção A: WebRTC em mesh, STUN público e sinalização manual por códigos.

## Consequências

- Zero infraestrutura e nada exposto na internet.
- Quem estiver atrás de CGNAT simétrico não vai conseguir conectar. O teste da prova de conceito ([poc-resultados.md](../poc-resultados.md)) vai dizer se isso afeta alguém.
- Trocar dois códigos por espectador é trabalhoso. Se o grupo adotar o app, a sinalização automática (B ou C) vira prioridade.
- A sinalização fica isolada em `src/renderer/src/signaling/`, para que a troca para B ou C não mexa no resto.
