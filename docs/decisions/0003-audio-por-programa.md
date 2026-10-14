# 0003 · Áudio da transmissão capturado por programa

- **Data:** 2026-10-14
- **Situação:** aceita

## Contexto

Até a v0.2, o áudio da transmissão era o do sistema inteiro (loopback do Electron). Isso leva junto a voz do Discord, que o grupo usa ao mesmo tempo, e o som das transmissões que a pessoa está assistindo no próprio Aquarium, o que causa retorno.

## Decisão

Um executável próprio, `aquarium-audio.exe` (C++, ~220 KB, runtime embutido), usa a captura por processo do Windows (`AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK`, Windows 11 / Windows 10 build 20348+):

- **Só o app transmitido:** captura a árvore de processos dona da janela compartilhada.
- **Todos os apps:** soma a captura de cada programa com sessão de áudio, menos os bloqueados por nome (Discord e outros que a pessoa escolher) e menos a árvore de processos do próprio Aquarium. A lista é revista a cada segundo.
- **Sem áudio.**

O PCM (16 bits, 48 kHz, estéreo) vai do executável ao processo principal por stdout e chega à página por um `MessagePort`, direto para um AudioWorklet que vira a trilha de áudio. A trilha existe sempre, então trocar de modo durante a transmissão não renegocia a conexão. O Opus é ajustado para estéreo a 128 kbps (o padrão do WebRTC é mono, para voz).

O pacote `application-loopback` do npm foi descartado: traz um `.exe` pronto sem o código-fonte no pacote e não sabe excluir programas.

## Consequências

- Compilar exige o Visual Studio com C++ e o Windows SDK (só para quem gera o executável).
- Windows mais antigo que o build 20348 pode ficar sem áudio na transmissão (não testado).
- O módulo encerra sozinho quando o Aquarium fecha (vigia o processo pai).
