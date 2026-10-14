# Aquarium

Compartilhamento de tela P2P para uso interno do grupo. Substitui o compartilhamento de tela do Discord para jogos, código e vídeos.

Esta é a **prova de conceito da opção A**: o vídeo vai direto de um PC para o outro e não existe nenhum servidor nosso. Os PCs se encontram trocando dois códigos por mensagem (WhatsApp, por exemplo).

## Rodar em desenvolvimento

```sh
npm install
npm run dev
```

Na primeira execução o Electron baixa o próprio binário (~100 MB).

## Gerar o executável para Windows

```sh
npm run dist:win
```

O resultado é `dist/Aquarium-<versão>.exe`, um executável portátil (não precisa instalar). Como ele não é assinado digitalmente, o Windows mostra o aviso do SmartScreen: clique em "Mais informações" e depois em "Executar assim mesmo".

## Como fazer uma transmissão

| Quem transmite | Quem assiste |
|---|---|
| 1. Abre o app, clica em **Transmitir minha tela** e escolhe a tela ou janela | |
| 2. Clica em **Adicionar espectador** e manda o convite (`AQ1.C…`) | |
| | 3. Abre o app, clica em **Assistir** e cola o convite |
| | 4. Clica em **Gerar resposta** e devolve a resposta (`AQ1.R…`) |
| 5. Cola a resposta e clica em **Conectar** | 6. A imagem aparece |

Cada espectador tem o seu próprio convite. Para mais gente, repita a partir do passo 2.

## Prova de conceito

O objetivo é descobrir, com as conexões reais do grupo, quem consegue conectar direto. O roteiro e a tabela para anotar os resultados estão em [docs/poc-resultados.md](docs/poc-resultados.md).

## Limitações conhecidas

- **CGNAT simétrico não conecta.** É o limite da opção A; o teste vai mostrar se isso afeta alguém do grupo.
- **Mesh:** cada espectador é uma codificação a mais na placa de vídeo e uma fatia a mais do upload. Funciona bem até 3 ou 4 pessoas.
- **Áudio do sistema só no Windows**, e ele vai inteiro: se você estiver em chamada no Discord, quem assiste ouve a chamada também.
- **Tela cheia exclusiva** pode aparecer preta. Use o modo "janela sem borda" nos jogos.
- Os códigos têm ~2,5 mil caracteres. Alguns apps de mensagem quebram o texto em linhas; o Aquarium ignora as quebras.

## Estrutura

```
src/
├─ main/                processo principal do Electron: janela, permissões, captura
├─ preload/             ponte segura entre o processo principal e a interface
├─ shared/              contrato entre os dois (tipos e nomes das mensagens)
└─ renderer/src/
   ├─ rtc/              WebRTC: quem transmite, quem assiste, qualidade, estatísticas
   ├─ signaling/        como os PCs se encontram (hoje: códigos manuais)
   ├─ components/       peças de interface reutilizadas
   └─ views/            telas de transmitir e assistir
docs/
├─ ARCHITECTURE.md      como as partes se encaixam
├─ decisions/           registro das decisões e dos motivos
└─ poc-resultados.md    roteiro e resultados do teste
```
