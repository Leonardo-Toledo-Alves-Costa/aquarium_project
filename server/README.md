# Servidor de salas do Aquarium

Um Cloudflare Worker com um Durable Object por grupo. Ele só sabe quem está online, em que sala e quem está transmitindo, e repassa sinais **cifrados** entre pessoas da mesma sala. O vídeo e o áudio nunca passam por aqui.

## Segurança

- Só responde a WebSocket em `/g/<id do grupo>/ws`; todo o resto é 404.
- A senha de entrada é derivada do código do grupo; o servidor guarda só o hash (SHA-256) dela e compara em tempo constante.
- 5 tentativas com senha errada do mesmo IP bloqueiam esse IP por 10 minutos.
- Sinais só passam entre pessoas da mesma sala; o conteúdo vai cifrado (AES-GCM) com uma chave que o servidor nunca recebe.
- Mais de 300 mensagens em 10 s derruba a conexão.
- No plano grátis não existe cobrança: se a cota diária acabar, as conexões falham até 00:00 UTC.

## Rodar localmente

```sh
npm install
npm run dev        # ws://127.0.0.1:8787
```

## Publicar na Cloudflare (plano grátis, sem cartão)

1. Crie uma conta em https://dash.cloudflare.com/sign-up (só e-mail).
2. Faça login pelo terminal (abre o navegador):
   ```sh
   npx wrangler login
   ```
3. Publique:
   ```sh
   npm run deploy
   ```
   O final da saída mostra o endereço, algo como `https://aquarium.<sua-conta>.workers.dev`.
4. No app, use o mesmo endereço trocando `https://` por `wss://` (veja o README principal).
