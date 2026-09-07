# Investbras Intelligence

Central diaria de inteligencia de mercado para a mesa da Investbras: cafe arabica,
cambio, bolsas, commodities correlatas, noticias e agenda economica.

O principio do produto e simples e vale para todo o codigo: **nenhum numero e inventado**.
Quando uma fonte nao responde, a interface diz que nao respondeu, em vez de mostrar
um valor antigo sem aviso ou um placeholder que parece cotacao.

## O que ja funciona sem configurar nada

Basta subir o site. Estes blocos usam fontes publicas e nao dependem de chave:

| Bloco | Fonte real |
|---|---|
| Cafe arabica (KC), OHLC e serie de 5 pregoes | ICE via Yahoo Finance |
| Dolar spot, Ibovespa, S&P 500, Nasdaq, Hang Seng | Yahoo Finance |
| Acucar, petroleo WTI, ouro, soja, milho | ICE, NYMEX, COMEX e CBOT via Yahoo Finance |
| Dolar PTAX | Banco Central do Brasil (Olinda) |
| Selic meta e IPCA do mes | Banco Central do Brasil (SGS) |
| Agenda economica | Calendario oficial de divulgacoes do IBGE |
| Noticias | Busca dedicada a cafe, Agencia Brasil, Canal Rural, Money Times e InfoMoney |

### Equivalencia em R$ por saca

O diferencial da pagina e a conversao da bolsa para a unidade que a mesa negocia:

```text
R$/saca 60 kg = (cotacao em c/lb / 100) x 132,2774 lb x dolar
```

Sao as duas cotacoes reais multiplicadas, nada mais. A interface deixa explicito que
o resultado **nao** inclui diferencial, tipo, bebida, frete ou impostos. Isso e
referencia de bolsa, nao preco de mercado fisico.

## O que precisa de configuracao

| Recurso | Variaveis | Sem elas |
|---|---|---|
| Acesso ao painel `/admin` | `SESSION_SECRET` + (`ADMIN_EMAIL` e `ADMIN_PASSWORD`) ou `SUPABASE_ANON_KEY` | O painel nao abre |
| Publicar a edicao para todos | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Publica so no navegador de quem editou |
| Disparo de e-mail | `RESEND_API_KEY`, `EMAIL_FROM` | Botao responde que o provedor nao esta configurado |
| Leitura assistida por IA | `OPENAI_API_KEY` ou `GEMINI_API_KEY` | O rascunho sai em modo tecnico, so com os numeros |

Nenhuma dessas ausencias quebra a pagina publica.

## Instalacao

```bash
cd investbras-market-static
npm install
cp .env.example .env
npm run secret   # gera um SESSION_SECRET e imprime no terminal
```

Rodar local com as Functions:

```bash
npm run dev
# http://localhost:8888  e  http://localhost:8888/admin
```

Validar antes de subir:

```bash
npm run build
```

O build nao gera `dist`. Ele confere arquivos obrigatorios, sintaxe de todo o
JavaScript, metadados de cada pagina, ausencia de estilo inline (a CSP bloqueia),
referencias de `id` entre HTML e JS, e se alguma chave secreta vazou para o frontend.

## Deploy no Netlify

1. **Add new site > Import an existing project** e conecte o repositorio.
2. Se o repositorio mantiver esta subpasta, defina o **base directory** como `investbras-market-static`.
3. O `netlify.toml` ja cuida de build, publish, functions, redirects e headers.
4. Em **Site configuration > Environment variables**, cadastre pelo menos:

```text
SESSION_SECRET
ADMIN_EMAIL
ADMIN_PASSWORD
SITE_URL
```

5. Deploy.

### Dominio no Cloudflare

Alvo final: `investbras.achillesmedia.com.br`

No Netlify, adicione o dominio em **Domain management**. No Cloudflare DNS:

```text
Type: CNAME
Name: investbras
Target: hostname fornecido pelo Netlify
Proxy status: DNS only
```

Mantenha **DNS only** ate validar SSL, redirects e Functions. So depois ative o proxy.

## Supabase

Rode `supabase/migrations/0001_investbras_market.sql` no SQL Editor. A migracao cria
as tabelas, os indices, os triggers de `updated_at` e liga **RLS em todas elas**.

A unica policy permissiva libera leitura de `market_reports` com `status = 'published'`.
Todo o resto so e acessivel pela service role, que vive apenas nas Functions.

Para usar Supabase Auth no lugar do operador unico: crie o usuario em
**Authentication > Users**, informe `SUPABASE_ANON_KEY` no ambiente e faca login com
esse e-mail. O login tenta o Supabase primeiro e cai para `ADMIN_EMAIL` como reserva.

## Seguranca

- Sessao do painel assinada com HMAC-SHA256 e validade de 12 horas, guardada em
  `sessionStorage` (some ao fechar a aba, nunca vai para disco).
- Toda Function sensivel revalida a assinatura no servidor. O painel nao decide nada sozinho.
- CSP estrita: script e estilo apenas locais, fontes so do Google, imagem so da
  propria origem. Por isso o build recusa qualquer `style=` inline.
- Comparacao de senha em tempo constante, limite de 8 tentativas por IP a cada 5 minutos.
- Proxy de imagem com bloqueio de rede interna, limite de 3 MB e sandbox por CSP.
- Descadastro assinado por token derivado do e-mail: ninguem remove endereco alheio.

## Fluxo da mesa

1. Entrar em `/admin`.
2. **Gerar rascunho**: as Functions buscam cotacoes, noticias e agenda e montam o texto.
   Com chave de IA, a leitura vem interpretada; sem chave, vem so com os numeros organizados.
3. Revisar e editar. O rascunho salva sozinho no navegador enquanto voce escreve.
4. **Publicar edicao**: grava no Supabase e a pagina publica passa a exibir.
5. **Enviar teste para mim** antes de **Disparar para a base**. O disparo real pede confirmacao.

A regra do prompt de IA e explicita: interpretar apenas os dados recebidos, nunca criar
cotacao, percentual, data ou evento, e declarar quando uma fonte nao respondeu. Ainda assim,
revisao humana antes de publicar continua obrigatoria.

## Estrutura

```text
investbras-market-static/
  index.html            cockpit publico
  admin.html            painel da mesa, com portao de login
  404.html
  styles.css            tokens e area publica
  admin.css             console interno
  app.js                cotacoes, graficos SVG, noticias, agenda, newsletter
  admin.js              sessao, editor, publicacao, disparo
  favicon.svg
  og-investbras.png     cartao social 1200x630, gerado por script
  robots.txt / sitemap.xml / site.webmanifest
  netlify.toml
  scripts/
    validate-static.js  roda no npm run build
    make-og.js          regera o cartao social
  netlify/functions/
    _utils.js           json, fetch com timeout, rate limit, cliente Supabase
    _auth.js            assinatura e verificacao de sessao
    auth-login.js  auth-me.js
    market-data.js  market-news.js  market-agenda.js  news-image.js
    generate-report.js  report.js  report-save.js
    subscribe.js  unsubscribe.js  subscribers.js  send-campaign.js
    health.js
  supabase/migrations/
    0001_investbras_market.sql
```

## Notas de operacao

- **Limite do Yahoo Finance.** A fonte bloqueia rajadas. A Function busca todos os
  simbolos em uma unica chamada, mantem cache de 90 segundos no container e, se a
  fonte cair, serve a ultima leitura valida marcada como tal por ate 20 minutos.
- **Serie de 5 pregoes.** A janela intradiaria vem vazia fora do pregao, entao o
  grafico usa 5 dias. A variacao do dia sai do metadado da sessao regular, nao da janela.
- **Cafe robusta.** O Yahoo nao expoe robusta em simbolo publico estavel. Ao contratar
  uma fonte, informe `ROBUSTA_SYMBOL` e o contrato volta a aparecer na grade e na conversao.
  Preferimos omitir a linha a exibir "indisponivel" para sempre.
- **Agenda.** O IBGE ja vem ligado. Para somar Copom, Fed ou USDA, adicione os links
  `.ics` em `AGENDA_ICS_URLS`, separados por virgula.
- **Foto.** O visual da pagina e construido sobre os proprios dados. Se a Investbras
  quiser uma fotografia de lavoura ou armazem no bloco de cafe, e o unico lugar do
  layout preparado para receber imagem propria.

## Proximos passos sugeridos

1. Ligar Supabase e Resend para a edicao sair do navegador e chegar na base.
2. Definir a fonte oficial de cafe robusta e de mercado fisico usada pela mesa.
3. Publicar por 5 dias seguidos e so entao avaliar cadencia e formato do e-mail.
4. Registrar `market_snapshots` diariamente para montar historico proprio de preco.
