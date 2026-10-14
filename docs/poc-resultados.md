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

A partir da v0.2, o botão **Copiar diagnóstico** junta tudo isso num texto só. Se a imagem estiver ruim, os dois lados copiam o diagnóstico e colam no grupo.

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

## Primeiro teste real (v0.1, 2026-10-14)

Conexão direta com uma pessoa na Bahia. Funcionou, mas a imagem chegou borrada. A causa provável era a predefinição de jogo, que mantinha os fps reduzindo a resolução. Isso foi corrigido na v0.2 (ver "Por que a imagem ficava borrada" em [ARCHITECTURE.md](ARCHITECTURE.md)).

## Teste automático de qualidade (v0.2, 2026-10-14, uma máquina)

Conteúdo sintético difícil de comprimir (centenas de retângulos aleatórios por quadro), 1920×1080 a 60 fps, predefinição Jogo:

| | Equilíbrio | Nitidez (novo padrão) |
|---|---|---|
| Resolução enviada após 3 s | 1280×720 | 1920×1080 |
| Banda | 8–14 Mbps | 11–12 Mbps |
| Limitação | banda | nenhuma |

- Com o início de banda ajustado, a transmissão já estava acima de 11 Mbps no primeiro segundo.
- O convite passou a ser gerado em ~1 s (antes 5 s), ainda com o endereço público incluído. A conexão completa caiu de 5,7 s para 1,7 s.
- VP9 e AV1 negociaram corretamente quando escolhidos.

## Testes automáticos da v0.3 (2026-10-14, uma máquina, servidor local)

**Servidor de salas** (16/16): rotas inválidas recusadas, grupo criado na primeira entrada com 3 salas, senha errada recusada e desconectada, presença, sinais só dentro da mesma sala, transmissão visível para todos, criar/apagar sala, reconexão do mesmo aparelho derruba a conexão antiga, versão diferente recusada, saída some da lista, excesso de mensagens derruba a conexão.

**Sala com três pessoas** (20/20): A e B transmitindo ao mesmo tempo; B assiste A, C assiste A e B, A assiste B. O vídeo começa a chegar ~0,3 s depois de pedir para assistir; cada um envia só para quem pediu; parar de assistir, parar de transmitir e sair da sala não afetam os outros.

**Limite automático de banda** (rede simulada): 16 Mbps estável → 5,1 Mbps após 8 s de rede congestionada → piso de 3,2 Mbps → volta ao teto em pouco mais de um minuto de rede estável.

**Interface com dois apps abertos** ("Miguel" e "Bia"): criar grupo, entrar com o código digitado em minúsculas e com espaços, entrar na sala, transmitir a tela (1920×1080), "Assistir": vídeo em 0,6 s, 1080p a 52 fps.

**Áudio por programa**, com um programa "Tom 440" (440 Hz) transmitido e um falso `Discord.exe` tocando 660 Hz ao mesmo tempo, medido por frequência do lado de quem assiste:

| Modo | 440 Hz | 660 Hz ("Discord") |
|---|---|---|
| Só o app transmitido | 0,0396 (chegou) | 0,0000 (bloqueado) |
| Todos os apps | 0,0397 (chegou) | 0,0000 (bloqueado) |
| Sem áudio | 0,0000 | 0,0000 |

A troca de modo com a transmissão rodando funcionou sem derrubar a conexão, e o `aquarium-audio.exe` encerrou junto com o app.

Ainda falta: testar entre casas diferentes com o servidor publicado na Cloudflare, e em Windows 10.
