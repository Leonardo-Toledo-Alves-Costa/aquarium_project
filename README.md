# Aquarium

Compartilhamento de tela P2P para uso interno do grupo. Substitui o compartilhamento de tela do Discord para jogos, código e vídeos; a conversa por voz continua no Discord.

- **Salas:** qualquer pessoa da sala pode transmitir e assistir quem quiser, ao mesmo tempo.
- **Vídeo direto entre os PCs** (WebRTC, cifrado). O servidor só ajuda os PCs a se encontrarem.
- **Áudio por programa:** vai o som do jogo (ou de todos os apps), e **nunca** o do Discord nem o do próprio Aquarium, para não dar retorno.

## Estrutura

```
src/
├─ main/                processo principal do Electron: janela, permissões, captura, módulo de áudio
├─ preload/             ponte segura entre o processo principal e a interface
├─ shared/              contratos: mensagens com o servidor (rooms-protocol) e com o processo principal (ipc)
└─ renderer/src/
   ├─ group/            código do grupo e chaves derivadas dele
   ├─ signaling/        como os PCs se encontram: servidor de salas (rooms) ou códigos manuais (manual)
   ├─ rtc/              WebRTC: sessão da sala (mesh), qualidade, limite automático de banda, estatísticas
   ├─ audio/            trilha de áudio alimentada pelo módulo nativo
   ├─ ui/               interface "Palco"
   └─ views/            modo manual (sem servidor), da v0.2
server/                 servidor de salas (Cloudflare Worker + Durable Objects)
native/                 aquarium-audio.exe: captura de áudio por programa (C++, API do Windows)
docs/                   arquitetura, decisões e resultados de testes
```

## Desenvolvimento

Pré-requisitos: Node 22+, e para o módulo de áudio o Visual Studio com "Desenvolvimento para desktop com C++" e o Windows 11 SDK.

```sh
npm install
npm --prefix server install
npm run build:native     # gera native/bin/aquarium-audio.exe
npm run server           # servidor de salas local em ws://127.0.0.1:8787
npm run dev              # o app (em outro terminal)
```

Na primeira execução o Electron baixa o próprio binário (~100 MB).

## Gerar o executável para Windows

```sh
npm run dist:win
```

Gera `dist/Aquarium-<versão>.exe`, portátil (não precisa instalar), já com o módulo de áudio. O Windows mostra o aviso do SmartScreen porque o executável não é assinado: "Mais informações" → "Executar assim mesmo".

O endereço do servidor vem de `VITE_AQUARIUM_SERVER`: `.env.development` aponta para o servidor local (`npm run dev`) e `.env.production` para o servidor publicado, `wss://aquarium.miguelzu1243.workers.dev` (veja [server/README.md](server/README.md)). Cada pessoa também pode trocar o servidor em Configurações → Rede e diagnóstico.

## Como usar

1. **Primeiro acesso:** escolha seu nome e crie um grupo (o app mostra o código `AQG-…` para mandar ao grupo) ou cole o código que te mandaram.
2. **Entre numa sala** pela barra à esquerda ou pelo seletor no topo.
3. **Transmitir:** escolha a tela ou janela, a qualidade e o áudio.
4. **Assistir:** clique em "Assistir" na transmissão de alguém. Clique com o botão direito numa transmissão para volume (até 200%), silenciar, tela cheia e diagnóstico; na sua, para o áudio enviado.

## Limitações conhecidas

- **CGNAT simétrico não conecta** direto, e ainda não há relay (TURN). O teste da Bahia conectou direto.
- **Mesh:** cada pessoa assistindo é uma codificação a mais e uma fatia a mais do upload. Funciona bem até 3 ou 4 pessoas assistindo a mesma transmissão.
- **Áudio por programa exige Windows 11** (ou Windows 10 build 20348+; versões anteriores podem funcionar, não testado). Sem ele, a transmissão vai sem áudio.
- **Tela cheia exclusiva** pode aparecer preta. Use o modo "janela sem borda" nos jogos.
- Quem tem o código do grupo entra. Para tirar alguém, é preciso criar um grupo novo.

## Licença

O código é aberto para ler, usar, estudar, modificar e redistribuir de graça, mas **a venda é proibida**, inclusive de versões modificadas. Por isso o Aquarium não é "open source" no sentido da OSI. Versões modificadas precisam usar outro nome e outro servidor de salas. O software vem sem garantia, e quem transmite responde pelo que aparece na própria tela. Veja os termos completos em [LICENSE.md](LICENSE.md).
