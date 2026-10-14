# 0002 · Salas com um servidor de sinalização no Cloudflare Workers

- **Data:** 2026-10-14
- **Situação:** aceita (desenvolvida e testada localmente; falta publicar)

## Contexto

A opção A (códigos copiados à mão) funcionou, inclusive com uma pessoa na Bahia, mas o grupo quer salas prontas, ver quem está online e que qualquer pessoa da sala possa transmitir. Isso exige um ponto de encontro sempre disponível. O grupo não quer domínio próprio nem servidor para manter.

Opções gratuitas avaliadas: Google Colab (proibido pelos termos e com sessões de no máximo 12 h), GitHub Pages (só arquivos estáticos), Firebase (100 conexões simultâneas), Supabase (pausa depois de 7 dias sem uso), Render (dorme após 15 min), Oracle Cloud (VM grátis, mas com cartão e recolhimento de VMs ociosas), relays públicos Nostr/MQTT (sem garantia) e Cloudflare Workers + Durable Objects.

## Decisão

Cloudflare Workers + Durable Objects no plano grátis, no endereço `*.workers.dev`:

- 100 mil requisições por dia, sem cartão e sem cobrança; um grupo pequeno usa bem menos de 1%.
- Nada de sistema operacional para manter ou atacar; o código só aceita quem tem a senha do grupo.
- A senha e a chave de cifra saem do código do grupo por HKDF; o servidor nunca vê a chave de cifra.

## Consequências

- Endereço público na internet, protegido no próprio código (senha, limite de tentativas e de mensagens), já que o firewall da Cloudflare é configurado por domínio próprio.
- Sem TURN por enquanto: o TURN da Cloudflare tem 1.000 GB grátis por mês, mas pode exigir cartão. Fica para quando algum par não conectar direto.
- O modo manual por códigos continua no app como plano B.
