# LICENÇA DE USO E PROIBIÇÃO DE VENDA DO AQUARIUM

**Copyright (c) 2026 @MigzuLCS e @Leonardo-Toledo-Alves-Costa**  
Todos os direitos reservados, exceto conforme expressamente concedido nesta Licença.

---

## 1. Aceitação e Escopo

Ao baixar, instalar, executar, compilar, copiar, modificar, distribuir ou de qualquer forma utilizar o software **Aquarium**, seu código-fonte, seus executáveis binários (incluindo o módulo nativo `aquarium-audio.exe` e instaladores) ou seu servidor de sinalização de salas (em conjunto, o **"Software"**), você (**"Usuário"** ou **"Licenciado"**) declara ter lido, compreendido e concordado integralmente com todas as condições e obrigações estabelecidas nesta Licença.

Caso você não concorde com qualquer disposição deste instrumento, **não possui licença** para utilizar, copiar, executar ou distribuir o Software, devendo interromper imediatamente seu uso e excluí-lo de seus dispositivos.

---

## 2. Concessão de Licença Gratuita (Uso, Modificação e Distribuição Sem Venda)

Sujeito ao cumprimento integral e contínuo de todas as condições deste instrumento — em especial a **proibição de venda e comercialização da Seção 3** —, os titulares dos direitos autorais (**"Licenciantes"** ou **"Criadores"**) concedem a você uma licença mundial, gratuita (isenta de *royalties*), não exclusiva e intransferível — abrangendo direitos autorais de programa de computador e eventuais reivindicações de patentes detidas pelos Licenciantes que sejam necessariamente infringidas pelo uso do Software — permitindo:

1. **Executar e usar gratuitamente** o Software para comunicação, compartilhamento de tela e áudio ponto a ponto (P2P);
2. **Estudar, inspecionar, compilar e modificar** o código-fonte do Software e criar obras derivadas;
3. **Redistribuir gratuitamente** cópias exatas ou modificadas do código-fonte ou dos binários a terceiros, desde que **sem qualquer cobrança ou contrapartida comercial** e observadas todas as exigências das Seções 3, 4 e 5 desta Licença.

---

## 3. Proibição Expressa de Venda, Revenda e Monetização (Cláusula *No-Selling*)

Sem autorização prévia, específica e por escrito dos Licenciantes, é **estritamente proibido Vender** o Software, no todo ou em parte, original ou modificado.

Para os fins desta Licença, **"Vender"** (ou comercializar/revender) inclui, sem limitação:

1. **Cobrar qualquer valor** (em dinheiro, criptoativos, bens, serviços ou dados pessoais comercializáveis) pelo download, cópia, acesso, instalação, licença, aluguel, empréstimo ou uso do Software, de seus binários, de seu código-fonte ou de qualquer versão modificada ou obra derivada dele;
2. **Oferecer o Software (ou versão derivada) como serviço pago ou gerenciado** (*Software as a Service — SaaS*, hospedagem paga de servidores de salas, salas VIP, servidores *relay*/TURN cobrados, clubes de assinatura ou acesso condicionado a *paywall* ou exibição de publicidade/anúncios);
3. **Embutir, empacotar ou distribuir** o Software (ou parte substancial dele) como parte integrante de produtos comerciais, hardwares vendidos, cursos/assinaturas pagas ou pacotes de software pagos;
4. **Vender serviços de suporte, consultoria, hospedagem ou manutenção** cujo valor derive total ou substancialmente da funcionalidade do Software.

---

## 4. Condições para Versões Modificadas (*Forks*), Redistribuição e Marca

Caso você distribua gratuitamente cópias do Software ou publique versões modificadas (*forks* ou obras derivadas), você deve cumprir cumulativamente as seguintes condições:

1. **Manutenção da Licença e dos Avisos:** Toda cópia ou obra derivada deve manter intactos todos os avisos de *copyright*, este arquivo de Licença na íntegra (mantendo a proibição de venda da Seção 3) e os avisos de licenças de terceiros que acompanham o Software (como `THIRD-PARTY-NOTICES.txt`, `LICENSE.electron.txt` e `LICENSES.chromium.html`), não podendo ser relicenciada sob termos que permitam a venda ou comercialização;
2. **Proteção do Nome e Identidade ("Aquarium"):** Esta Licença **não concede** qualquer direito sobre o nome **"Aquarium"**, logotipos, ícones ou identificadores de aplicativo (`appId`) dos Licenciantes. Qualquer versão modificada ou compilada por terceiros que seja distribuída publicamente **deve**:
   - Utilizar um nome distinto que não cause confusão com o Aquarium original;
   - Alterar o identificador de aplicativo (`appId` em `electron-builder.yml`) e o repositório de atualização automática (`publish`); e
   - Declarar de forma visível que se trata de uma versão não oficial modificada a partir do projeto Aquarium;
3. **Proibição de Uso do Servidor Oficial por *Forks*:** Qualquer versão modificada ou redistribuída por terceiros **deve alterar o endereço padrão do servidor de salas** (`VITE_AQUARIUM_SERVER` / `DEFAULT_SERVER`), sendo expressamente proibido apontar binários ou *forks* de terceiros para a infraestrutura Cloudflare Workers mantida pelos Criadores;
4. **Não Afiliação com Terceiros:** O Aquarium é um projeto independente e não é afiliado, associado, autorizado, endossado ou de qualquer forma oficialmente conectado ao Discord Inc. ou a quaisquer outras marcas mencionadas de forma meramente descritiva no código ou na documentação.

---

## 5. Componentes de Terceiros e Preservação de Licenças

O Software incorpora ou interage com bibliotecas, fontes tipográficas e componentes de terceiros distribuídos sob suas respectivas licenças originais, incluindo, sem limitação:

- **Electron** (Licença MIT — ver `LICENSE.electron.txt`);
- **Chromium e projetos embarcados** (WebRTC, V8, BoringSSL, Opus, libvpx, dav1d, OpenH264 — ver `LICENSES.chromium.html`);
- **FFmpeg (`ffmpeg.dll`)** (GNU Lesser General Public License v2.1 ou posterior — LGPLv2.1+);
- **React e React-DOM** (Licença MIT — *Copyright (c) Meta Platforms, Inc. and affiliates*);
- **Fontes Bricolage Grotesque e Figtree** (*SIL Open Font License, Version 1.1 — OFL-1.1*);
- **Runtime Visual C++ da Microsoft** (termos de código redistribuível do *Microsoft Visual Studio*).

**Preservação expressa:** Nada nesta Licença restringe, limita ou altera os direitos concedidos a você diretamente pelos titulares das licenças de código aberto ou de fontes acima referidas. Em especial:
1. As restrições desta Licença não impedem o Usuário de modificar ou substituir bibliotecas dinamicamente vinculadas licenciadas sob a **LGPLv2.1** (como `ffmpeg.dll`) para seu próprio uso, nem de realizar engenharia reversa dessas bibliotecas específicas na estrita medida exigida pela LGPLv2.1 para depurar tais modificações;
2. As fontes licenciadas sob a **SIL Open Font License 1.1** permanecem regidas exclusivamente pela OFL-1.1 e não podem ser vendidas isoladamente;
3. Em relação aos componentes redistribuíveis da Microsoft embutidos no módulo de áudio, é vedada a engenharia reversa, descompilação ou desmontagem de tais componentes da Microsoft, exceto e somente na medida em que a legislação aplicável o permita expressamente apesar desta limitação.

---

## 6. Responsabilidade Exclusiva pelo Conteúdo Transmitido, Privacidade e Gravações

O Aquarium é uma ferramenta técnica de comunicação direta ponto a ponto (WebRTC cifrado via DTLS-SRTP direto entre os computadores dos participantes). Os Criadores **não têm acesso, não armazenam, não monitoram, não descriptografam e não possuem capacidade técnica de visualizar ou moderar** o vídeo, o áudio ou os sinais trocados dentro dos grupos privados.

Ao utilizar o Software, você concorda e declara que:

1. **Direitos Autorais e Propriedade Intelectual de Terceiros (Lei nº 9.610/1998 e DMCA):** Você é o **único e exclusivo responsável** por garantir que possui todas as licenças, direitos e autorizações necessários para transmitir qualquer imagem, janela, jogo, vídeo, música, código ou documento em sua tela. É estritamente proibido utilizar o Software para pirataria, execução pública não autorizada, distribuição ilícita de obras protegidas por direitos autorais ou contorno de medidas tecnológicas de proteção (DRM);
2. **Privacidade, Dados Pessoais e Segredos na Tela/Áudio:** Como o Software captura a imagem de telas/janelas e o áudio de processos do sistema operacional (`aquarium-audio.exe`), é de sua **exclusiva responsabilidade** verificar previamente o que está visível em seu monitor e audível nos programas capturados, devendo fechar ou bloquear aplicativos que exibam dados pessoais de terceiros, informações bancárias, conversas privadas ou informações confidenciais protegidas por sigilo profissional ou contratual (NDA);
3. **Proibição de Gravação e Divulgação sem Consentimento (Código Civil, art. 20):** É **expressamente proibido** gravar, capturar, salvar, retransmitir ou divulgar a terceiros o vídeo, o áudio ou a imagem/voz de qualquer participante de uma sala sem o **consentimento prévio, livre, expresso e inequívoco de todos os participantes envolvidos**;
4. **Uso Lícito:** É proibido utilizar o Software para praticar qualquer ato ilícito civil ou penal, violar direitos de personalidade, intimidade, honra ou imagem de terceiros, ou transmitir material ilegal de qualquer natureza.

---

## 7. Servidor de Salas (Cloudflare Workers) e Privacidade de Dados

1. **Cortesia sem Garantia de Disponibilidade (Sem SLA):** O servidor de sinalização configurado por padrão no Software (`*.workers.dev`) é operado em caráter experimental e gratuito no plano sem custos da Cloudflare, exclusivamente como ponto de encontro para uso pessoal. Os Criadores **não garantem qualquer tempo de atividade (*uptime*), disponibilidade, capacidade ou permanência** do servidor, podendo suspendê-lo, desligá-lo, alterar seu endereço, limpar dados de salas ou bloquear endereços IP e grupos a qualquer momento, sem aviso prévio e sem que isso gere direito a qualquer indenização;
2. **Proteção contra Abuso:** É proibido submeter o servidor de salas a testes de carga, ataques de negação de serviço (DoS/DDoS), conexões automatizadas (*bots*), excesso intencional de mensagens, tentativa de força bruta contra códigos de grupo (`AQG-…`) ou qualquer conduta que viole a *Acceptable Use Policy* da Cloudflare;
3. **Minimização de Dados e LGPD (Lei nº 13.709/2018, art. 4º, I):** O projeto é disponibilizado por pessoas físicas para fins exclusivamente particulares e não econômicos (art. 4º, I da LGPD). O servidor de salas não recebe a chave de criptografia dos sinais nem o código original do grupo (`AQG-…`), processando apenas o mínimo estritamente técnico para funcionamento das salas: (a) o *hash* SHA-256 da senha de entrada derivada; (b) os nomes das salas do grupo; (c) o apelido e identificador aleatório (`peerId`) escolhidos pelo usuário enquanto conectado; e (d) o endereço IP de conexão, mantido apenas em memória enquanto a conexão dura e para o bloqueio automático de tentativas repetidas de senha incorreta. A própria Cloudflare trata dados de conexão conforme a política de privacidade dela.

---

## 8. Natureza Gratuita, Não Incidência do CDC e Ausência de Suporte

O Usuário reconhece e concorda que:

1. O Software é cedido a título puramente gratuito, benéfico e sem intuito de lucro, **fora de qualquer atividade empresarial ou mercado de consumo**, não configurando relação de consumo nos termos do art. 3º da Lei nº 8.078/1990 (Código de Defesa do Consumidor), regendo-se pelas normas aplicáveis aos negócios jurídicos gratuitos/benéficos do Código Civil Brasileiro (Lei nº 10.406/2002, art. 392);
2. Nos termos da Lei nº 9.609/1998 (Lei do Software), por não haver comercialização do Software, **não há prazo de validade técnica assegurado**, e os Licenciantes não assumem qualquer obrigação de prestar suporte técnico, assistência, manutenção, correção de *bugs* ou atualizações futuras.

---

## 9. Isenção de Garantias e Limitação de Responsabilidade

NA EXTENSÃO MÁXIMA PERMITIDA PELA LEGISLAÇÃO APLICÁVEL:

1. **FORNECIMENTO "NO ESTADO EM QUE SE ENCONTRA" (*AS IS*):** O SOFTWARE, SEU CÓDIGO-FONTE, SEUS EXECUTÁVEIS, O MÓDULO NATIVO DE ÁUDIO E O SERVIDOR DE SALAS SÃO FORNECIDOS **"NO ESTADO EM QUE SE ENCONTRAM" ("AS IS")** E **"CONFORME DISPONÍVEIS" ("AS AVAILABLE")**, COM TODAS AS SUAS EVENTUAIS FALHAS E SEM GARANTIA DE QUALQUER ESPÉCIE, EXPRESSA, IMPLÍCITA OU ESTATUTÁRIA, INCLUINDO, SEM LIMITAÇÃO, GARANTIAS IMPLÍCITAS DE COMERCIABILIDADE, ADEQUAÇÃO A UMA FINALIDADE ESPECÍFICA, DISPONIBILIDADE ININTERRUPTA, AUSÊNCIA DE ERROS, SEGURANÇA OU NÃO VIOLAÇÃO DE DIREITOS DE TERCEIROS.
2. **EXCLUSÃO DE RESPONSABILIDADE POR DANOS:** EM NENHUMA HIPÓTESE OS LICENCIANTES, AUTORES OU CONTRIBUIDORES SERÃO RESPONSÁVEIS PERANTE O USUÁRIO OU QUAISQUER TERCEIROS POR QUAISQUER DANOS DIRETOS, INDIRETOS, INCIDENTAIS, ESPECIAIS, PUNITIVOS, MORAIS OU CONSEQUENCIAIS, NEM POR LUCROS CESSANTES, PERDA DE DADOS, FALHA DE ÁUDIO OU VÍDEO, EXPOSIÇÃO ACIDENTAL DE INFORMAÇÕES NA TELA, INDISPONIBILIDADE DE REDE, BLOQUEIO PELO SISTEMA OPERACIONAL/ANTIVÍRUS OU ATOS PRATICADOS POR OUTROS USUÁRIOS NAS SALAS, SEJA COM BASE EM CONTRATO, RESPONSABILIDADE CIVIL EXTRACONTRATUAL OU QUALQUER OUTRA TEORIA JURÍDICA, MESMO QUE TENHAM SIDO AVISADOS DA POSSIBILIDADE DE TAIS DANOS.

*(International Notice / Aviso Internacional — UCC § 2-316)*:  
**AS FAR AS THE LAW ALLOWS, THE SOFTWARE COMES "AS IS", WITHOUT ANY WARRANTY OR CONDITION, EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. IN NO EVENT SHALL THE AUTHORS, COPYRIGHT HOLDERS, OR CONTRIBUTORS BE LIABLE TO YOU OR ANY THIRD PARTY FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES ARISING OUT OF THESE TERMS OR THE USE OR NATURE OF THE SOFTWARE, UNDER ANY KIND OF LEGAL CLAIM.**

---

## 10. Indenização a Favor dos Criadores e Extinção da Licença

1. **Dever de Indenizar e Manter Indene:** Você concorda em defender, indenizar e manter indenes os Licenciantes e contribuidores do projeto contra quaisquer reclamações, processos, perdas, multas, condenações e despesas (incluindo honorários advocatícios razoáveis) movidos por terceiros ou autoridades em decorrência de: (a) violação desta Licença por você; (b) conteúdo, áudio ou vídeo transmitido ou gravado por você por meio do Software; ou (c) venda, revenda ou exploração comercial não autorizada do Software por você;
2. **Extinção Automática:** Caso você descumpra qualquer condição desta Licença (incluindo, em especial, a proibição de venda ou revenda da Seção 3), todos os direitos e licenças a você concedidos por este instrumento **extinguir-se-ão imediata e automaticamente**, sem necessidade de notificação prévia, sem prejuízo das medidas judiciais cabíveis.

---

## 11. Disposições Gerais e Lei Aplicável

1. **Autonomia das Cláusulas (*Severability*):** Caso qualquer disposição desta Licença seja considerada inválida, nula ou inexequível por juízo competente em determinada jurisdição, tal disposição será interpretada ou limitada na extensão mínima necessária para torná-la válida (preservando-se a intenção original de alocação de riscos e gratuidade), permanecendo as demais cláusulas em pleno vigor e efeito;
2. **Lei Aplicável:** Esta Licença é regida e interpretada de acordo com as leis da República Federativa do Brasil.
