# Arquitetura

## Visão geral

```
PC de quem transmite                                    PC de quem assiste
┌──────────────────────────────────┐                    ┌──────────────────────┐
│ main: escolhe tela/janela        │                    │                      │
│   + áudio do sistema (Windows)   │                    │                      │
│ renderer:                        │                    │ renderer:            │
│   Broadcaster                    │  convite / resposta │   Receiver           │
│   ├─ RTCPeerConnection #1 ───────┼─── (por mensagem) ─┼─► RTCPeerConnection  │
│   ├─ RTCPeerConnection #2 ──► …  │                    │   └─ <video>         │
│   └─ …  (uma por espectador)     │ ══ vídeo direto ══►│                      │
└──────────────────────────────────┘    (DTLS-SRTP)     └──────────────────────┘
```

- **Mídia:** WebRTC, cifrado de ponta a ponta pelo próprio protocolo (DTLS-SRTP).
- **Topologia:** mesh. Quem transmite abre uma conexão por espectador.
- **Travessia de NAT:** STUN público (Google e Cloudflare), que só informa o endereço público de cada PC. Não há relay.
- **Sinalização:** manual. O convite (oferta SDP) e a resposta são comprimidos e trocados como texto.

## Processos do Electron

| Processo | Arquivo | Responsabilidade |
|---|---|---|
| Principal | `src/main/index.ts` | Janela, permissões, lista de telas/janelas, entrega da captura com áudio |
| Preload | `src/preload/index.ts` | Expõe só `listSources`, `selectSource` e `platform` para a interface |
| Interface | `src/renderer/src/` | React, WebRTC, códigos, estatísticas |

A interface roda com `contextIsolation`, `sandbox` e sem acesso ao Node. Só as permissões de captura de tela, mídia, cópia para a área de transferência e tela cheia são aceitas; as demais são negadas. Navegação e abertura de novas janelas são bloqueadas.

## Camadas da interface

| Pasta | Sabe sobre | Não sabe sobre |
|---|---|---|
| `rtc/` | WebRTC, qualidade, estatísticas | Como o convite chega até o outro PC |
| `signaling/` | Formato dos códigos (`AQ1.C.…` / `AQ1.R.…`) | WebRTC além do SDP |
| `views/` | Fluxo das telas | Detalhes de rede |

Para passar para a opção B (relay e sinalização numa VPS) ou C (rede privada), basta trocar `signaling/` e acrescentar servidores TURN em `rtc/peer.ts`. A captura, a codificação e a interface de vídeo continuam iguais.

## Formato dos códigos

```
AQ1 . C . <SDP comprimido com deflate-raw, em base64url>
 │    └─ C = convite (offer), R = resposta (answer)
 └─ versão do formato; versões diferentes são recusadas com uma mensagem clara
```

Como não há servidor para mandar endereços aos poucos, o app espera a coleta de candidatos ICE terminar (até 5 s) antes de gerar o código.

## Qualidade

As predefinições ficam em `rtc/presets.ts`:

| Predefinição | Captura | Banda por espectador (início / piso / teto) |
|---|---|---|
| Jogo | até 1080p, 60 fps | 6 / 1,5 / 16 Mbps |
| Vídeo | até 1080p, 30 fps | 4 / 1 / 8 Mbps |
| Código e texto | resolução nativa, 15 fps | 2,5 / 0,8 / 4 Mbps |

Quem transmite escolhe também:

- **Prioridade** quando falta banda ou placa de vídeo: *Nitidez* (mantém a resolução e perde fps, padrão), *Equilíbrio* ou *Fluidez* (mantém os fps e reduz a resolução). Vale na hora.
- **Codec:** automático (H.264, depois VP9), H.264, VP9 ou AV1. Vale para os próximos espectadores, porque trocar exige renegociar a conexão.

O início e o piso de banda são aplicados com os parâmetros `x-google-*-bitrate` na resposta recebida (`rtc/sdp.ts`); sem eles, o WebRTC começa em ~300 kbps e demora a subir.

### Por que a imagem ficava borrada (v0.1)

A predefinição de jogo mantinha os fps a qualquer custo. Com conteúdo pesado, o WebRTC reduzia a resolução de 1080p para 720p e a imagem ficava borrada. Num teste com conteúdo sintético difícil, a v0.2 com *Nitidez* manteve 1920×1080 a 11–12 Mbps.

### Diagnóstico

O botão "Copiar diagnóstico" (dos dois lados) gera um texto com a configuração, a rota, a resolução capturada e a enviada, a banda estimada, o codec, e quanto tempo a qualidade ficou limitada pela banda ou pela CPU/GPU. Do lado de quem assiste, mostra perda de pacotes, jitter, quadros descartados e travamentos.

## Segurança

O app parte do princípio de que o código pode ser lido por qualquer pessoa: não existe senha, chave nem credencial dentro dele. Na opção A, quem decide é quem transmite: a conexão só acontece quando essa pessoa cola a resposta, então ter só o convite não basta para assistir. Cada convite atende um único espectador e deixa de valer quando é usado ou quando o espectador é removido.
