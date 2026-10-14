# Arquitetura (v0.3)

## Visão geral

```
                    Cloudflare Worker (um Durable Object por grupo)
                    quem está online · salas · repasse de sinais cifrados
                        ▲              ▲              ▲
                    WebSocket      WebSocket      WebSocket
                        │              │              │
   ┌────────────────────┴──┐   ┌───────┴─────────┐   ┌┴────────────────┐
   │ Miguel                │   │ Bia             │   │ Rafa            │
   │ transmite Valorant    │◄═►│ transmite       │◄═►│ só assiste      │
   │ assiste Bia           │   │ Minecraft       │   │                 │
   └───────────────────────┘   └─────────────────┘   └─────────────────┘
              ╚═══════════ uma conexão WebRTC por par (mesh) ═══════════╝
```

- **Sinalização:** servidor de salas no Cloudflare Workers ([server/](../server)). Só presença, salas e repasse de sinais; o conteúdo dos sinais vai cifrado com a chave do grupo.
- **Mídia:** WebRTC direto entre os PCs, cifrado (DTLS-SRTP). Uma conexão por par de pessoas na mesma sala.
- **Quem envia o quê:** cada um envia vídeo só para quem clicou em "Assistir". Qualquer um pode começar ou parar de transmitir a qualquer momento; a conexão é renegociada sozinha ("perfect negotiation").
- **Travessia de NAT:** STUN público (Google e Cloudflare). Sem relay por enquanto.

## Código do grupo

`AQG-` + 26 caracteres (128 bits aleatórios, base32 de Crockford). Dele saem, por HKDF-SHA-256:

| Derivado | Para quê | Quem vê |
|---|---|---|
| id do grupo (128 bits) | endereço `/g/<id>/ws` no servidor | servidor |
| senha de entrada (256 bits) | o servidor guarda só o hash | servidor (hash) |
| chave AES-GCM (256 bits) | cifra os sinais entre os PCs, amarrados a quem envia e a quem recebe | só os PCs do grupo |

O código fica guardado cifrado pelo Windows (DPAPI, via `safeStorage` do Electron).

## Processos

| Processo | Arquivo | Responsabilidade |
|---|---|---|
| Principal | `src/main/index.ts` | Janela, permissões, lista de telas/janelas, código do grupo cifrado |
| Principal | `src/main/audio.ts` | Roda o `aquarium-audio.exe` e repassa o PCM à página por `MessagePort` |
| Preload | `src/preload/index.ts` | Expõe só a API do `AquariumApi` (sem acesso ao Node) |
| Interface | `src/renderer/src/` | React, WebRTC, salas, interface Palco |
| Módulo de áudio | `native/audio/aquarium-audio.cpp` | Captura de áudio por programa (veja a [decisão 0003](decisions/0003-audio-por-programa.md)) |

A interface roda com `contextIsolation`, `sandbox` e sem Node. Permissões aceitas: captura de tela, mídia, cópia para a área de transferência e tela cheia. Navegação e novas janelas são bloqueadas. A política de conteúdo só permite conexões com o servidor local e `*.workers.dev`.

## Camadas da interface

| Pasta | Faz | Não sabe |
|---|---|---|
| `group/` | Código do grupo e chaves | Rede |
| `signaling/rooms.ts` | Conexão com o servidor, reconexão, cifra dos sinais | WebRTC |
| `signaling/manual.ts` | Convite/resposta por texto (modo sem servidor) | Servidor |
| `rtc/room-session.ts` | Uma conexão por pessoa da sala, assistir/transmitir, renegociação | Interface |
| `rtc/governor.ts` | Limite automático de banda por espectador | WebRTC |
| `audio/` | Trilha de áudio a partir do PCM do módulo | Programas capturados |
| `ui/` | Interface "Palco" | Detalhes de rede |

## Qualidade

| Predefinição | Captura | Banda por espectador (início / piso / teto) |
|---|---|---|
| Jogo | até 1080p, 60 fps | 6 / 1,5 / 16 Mbps |
| Vídeo | até 1080p, 30 fps | 4 / 1 / 8 Mbps |
| Código e texto | resolução nativa, 15 fps | 2,5 / 0,8 / 4 Mbps |

- **Quando faltar banda:** Nitidez (padrão; mantém a resolução), Equilíbrio ou Fluidez (mantém os fps).
- **Limite de banda:** Automático (padrão) ou fixo em 6/10/16 Mbps. No automático, a cada 2 s o teto cai 25% se a latência subir mais que o dobro da mínima (ou 40 ms), a perda passar de 5% ou o jitter passar de 60 ms; com ~6 s estável, sobe 15%. Isso evita os travamentos vistos no teste com a Bahia (jitter de 155 ms).
- **Codec de vídeo:** automático (H.264, depois VP9), H.264, VP9 ou AV1.
- **Áudio:** Opus estéreo a 128 kbps.
- Início e piso de banda vão nos parâmetros `x-google-*-bitrate` do SDP recebido (`rtc/sdp.ts`).

## Diagnóstico

"Copiar diagnóstico", no menu do botão direito de qualquer transmissão, gera um texto com a rota (direta/relay, IPv4/IPv6, latência), a resolução e os fps enviados e recebidos, a banda estimada, o codec, e quanto tempo a qualidade ficou limitada pela banda ou pela CPU/GPU.
