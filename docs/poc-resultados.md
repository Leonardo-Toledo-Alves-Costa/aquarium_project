# Prova de conceito: roteiro e resultados

## Objetivo

Descobrir, com as conexões reais do grupo, se a opção A (conexão direta, sem servidor) atende a todos, e como fica a qualidade em jogo.

## Antes do teste (cada pessoa, 5 minutos)

1. **CGNAT:** compare o "IP WAN" no painel do roteador com o IP mostrado em https://ipv4.icanhazip.com. Diferentes, ou o do roteador começa com 100.64 a 100.127, indica CGNAT.
2. **IPv6:** abra https://test-ipv6.com. Nota 10/10 indica que você tem IPv6.
3. **NAT simétrico:** abra https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/, remova o servidor que vem preenchido, adicione `stun:stun.l.google.com:19302` e `stun:stun.cloudflare.com:3478`, e clique em "Gather candidates". Nas linhas `srflx`, portas diferentes entre os dois servidores indicam NAT simétrico.

| Pessoa | Provedor | CGNAT? | IPv6? | NAT simétrico? |
|---|---|---|---|---|
| | | | | |

## Durante o teste

Faça uma transmissão para cada par de pessoas (cada um transmitindo para cada outro, se possível) e, com a conexão estabelecida, anote o que aparece na linha de dados da conexão.

Como ler a rota:

| O app mostra | Significa |
|---|---|
| `Direto · IPv6 · host → host` | Conexão direta por IPv6, sem NAT no caminho |
| `Direto · IPv4 · srflx → srflx` (ou `prflx`) | Atravessou o NAT dos dois lados com hole punching |
| `Direto · … · host → host` com IPv4 | Mesma rede local |
| "Não conectou" | Hole punching falhou; provavelmente NAT simétrico |

Os outros números:

- **fps e resolução:** o que realmente está chegando.
- **Mbps:** banda usada por esse espectador.
- **ms de ida e volta:** latência da rede (não inclui codificação e exibição).
- **qualidade limitada pela CPU/GPU ou pela banda:** o que está segurando a qualidade, do lado de quem transmite.

## Resultados

| Data | Transmite | Assiste | Predefinição | Conectou? | Rota | fps | Resolução | Mbps | Ida e volta | Observações |
|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | |

## Teste automático (2026-10-14, uma máquina)

Executado com o código real do app dentro do Electron 44, usando um vídeo sintético 1920×1080 no lugar da captura de tela e 2 espectadores na mesma máquina:

- Os 2 espectadores conectaram (`Direto · IPv6 · host → host`), com H.264 a 1920×1080 e ~52 fps.
- Ao trocar para "Código e texto", o envio caiu para 15 fps mantendo 1920×1080.
- Remover um espectador não afetou o outro.
- Os códigos mediram ~2,3 mil caracteres (convite) e ~2 mil (resposta). Quebras de linha são ignoradas, e códigos trocados, truncados ou de outra versão geram mensagens claras.
- No app real, a captura da tela cheia em 1920×1080 com áudio do sistema funcionou, e o convite foi gerado.

Esse teste não substitui o teste entre casas diferentes: na mesma máquina não existe NAT no caminho.
