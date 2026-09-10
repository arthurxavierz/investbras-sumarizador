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
| Cafe arabica e robusta no fisico | Indicadores Esalq/B3 via Notícias Agrícolas |
| Soja, boi gordo e milho no fisico | Indicadores Esalq/B3 via Notícias Agrícolas |
| Clima nas pracas produtoras | Open-Meteo, sem chave |
| Agenda economica | Calendario oficial de divulgacoes do IBGE |
| Noticias | Canal Rural, InfoMoney, Money Times, Agrolink, G1 agro, G1 mundo, Agencia Brasil e quatro buscas tematicas |

### Bolsa contra fisico

O bloco central da pagina compara duas leituras da mesma saca:

```text
Bolsa convertida = (cotacao em c/lb / 100) x 132,2774 lb x dolar
Fisico           = indicador CEPEA/ESALQ do dia
Diferenca        = fisico menos bolsa convertida
```

A conversao usa apenas duas cotacoes reais multiplicadas, e a interface deixa
explicito que ela **nao** inclui diferencial, tipo, bebida, frete ou impostos.
O CEPEA entra como o outro lado da conta: quanto a saca vale de fato no Brasil.

A diferenca entre os dois numeros e o que a mesa negocia, e ela so aparece quando
as duas leituras chegam na mesma consulta.

### O caso do preço físico

A primeira versão lia o widget do CEPEA direto. Ele funciona de um IP
brasileiro e responde **403 do datacenter** onde as Functions rodam, o que
derrubava a coleta em produção sem aviso. Não era o User-Agent: de um IP no
Brasil os dois cabeçalhos retornam 200. É bloqueio por faixa de IP, e nenhum
cabeçalho contorna.

A leitura passou a vir das páginas de cotação do Notícias Agrícolas, que
respondem normalmente do datacenter e publicam cinco indicadores com data e
variação do dia: café arábica, café robusta, soja, boi gordo e milho. Quem
apura cada indicador continua declarado, porque o rótulo vem capturado da
própria página.

O parser se ancora no **título imediatamente antes da tabela**, não na posição
dela. Se o portal inserir um bloco novo no meio da página, a leitura continua
achando o indicador certo em vez de trocar de tabela em silêncio. Cada
indicador também declara a faixa de valor plausível: fora dela, vira
indisponível em vez de publicar o número de outro produto.

Não há entrada manual. O último valor de cada indicador fica gravado e entra
como reserva quando a fonte não responde, sempre rotulado com a idade em dias.

### Clima nas pracas produtoras

Quatro pracas acompanhadas pelo Open-Meteo, sem chave de API: Sul de Minas,
Cerrado Mineiro, Mogiana e Espirito Santo. A pagina mostra chuva prevista para
sete dias, minima do periodo e classificacao de risco de geada, com o limiar
declarado na resposta em vez de escondido no codigo.

## O que precisa de configuracao

| Recurso | Variaveis | Sem elas |
|---|---|---|
| Acesso ao painel `/admin` | `SESSION_SECRET` + (`ADMIN_EMAIL` e `ADMIN_PASSWORD`) ou `SUPABASE_ANON_KEY` | O painel nao abre |
| Publicar a edicao para todos | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Publica so no navegador de quem editou |
| Disparo de e-mail | `RESEND_API_KEY`, `EMAIL_FROM` | Botao responde que o provedor nao esta configurado |
| Leitura assistida por IA | `OPENAI_API_KEY` ou `GEMINI_API_KEY` | O rascunho sai em modo tecnico, so com os numeros |

Nenhuma dessas ausencias quebra a pagina publica.

## Como as noticias chegam

A coleta nao roda no caminho do visitante. Uma funcao agendada (`cron-news`)
executa a cada 20 minutos, busca os feeds, abre as materias principais atras de
capa e linha fina, e grava tudo no Supabase. A pagina publica so le a tabela.

Isso resolve tres problemas de uma vez: o limite de 10 segundos por Function,
o bloqueio por excesso de requisicao nos portais, e a lentidao de abrir uma
dezena de materias enquanto alguem espera a pagina carregar.

Cada item guarda titulo, linha fina, sintese, veiculo, dominio real e miniatura.
Quando a materia nao tem foto propria, a miniatura vira a marca do veiculo em
vez de um bloco vazio.

As vagas sao distribuidas por eixo editorial, senao a busca por cafe ocupa o
feed inteiro: 6 cafe, 5 commodities, 4 geopolitica, 3 energia, 3 cambio e
3 juros, completando ate 24 com o que sobrar por relevancia.

Sem Supabase configurado, a funcao publica faz a coleta ao vivo com orcamento
curto. Funciona, mas com menos capas resolvidas.

## Card do dia

O painel gera um card consolidado em JPG, desenhado em canvas com as fontes da
marca, em dois formatos:

- **Post** 1920 x 1080
- **Story** 1080 x 1920

O card reune manchete e resumo da edicao, preco do arabica na bolsa com a serie
de cinco pregoes, a comparacao entre bolsa e fisico, as cotacoes de apoio e o
clima das pracas. Todo numero vem das Functions no momento da geracao: dado
ausente aparece como indisponivel, nunca some.

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

Rode as migracoes na ordem, no SQL Editor:

1. `supabase/migrations/0001_investbras_market.sql` cria as tabelas, os indices,
   os triggers de `updated_at` e liga **RLS em todas elas**.
2. `supabase/migrations/0002_news_and_subscribers.sql` adiciona os campos que a
   coleta de noticias precisa, os campos de cadastro manual de inscrito e a
   funcao de limpeza `purge_old_news`.
3. `supabase/migrations/0003_physical_indicators.sql` cria a tabela do mercado
   físico, onde fica o último valor conhecido de cada indicador.
4. `supabase/migrations/0004_subscriber_phone.sql` adiciona o telefone do
   inscrito, que é opcional.

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
2. **Atualizar informacoes**: forca a releitura das tres fontes ignorando o cache
   e monta o texto no editor. Com chave de IA a leitura vem interpretada; sem
   chave, vem com os numeros organizados. A area publica ja se atualiza sozinha,
   entao este botao serve para trazer tudo agora e comecar a edicao.
3. Revisar e editar. O rascunho salva sozinho no navegador enquanto voce escreve.
4. **Publicar edicao**: grava no Supabase e a pagina publica passa a exibir.
5. **Simular e-mail** abre em aba nova exatamente o HTML que o inscrito recebe,
   gerado pelo mesmo modelo do disparo real.
6. **Enviar teste para mim** antes de **Disparar para a base**. O disparo real
   pede confirmacao.

O bloco **Mercado físico** mostra os cinco indicadores com origem, data de
referência e idade de cada um.

O bloco **Card do dia** gera o JPG consolidado, em story 1080 x 1920 por padrão
ou post 1920 x 1080. A tipografia do card é diferente da do site de propósito:
a página é leitura contínua, o card é peça de circulação vista por segundos.

O bloco **Inscritos** cadastra contato na mão (e-mail e nome obrigatórios,
telefone e empresa opcionais), importa base em CSV, busca por e-mail, nome ou
empresa, filtra por status e permite desativar, reativar ou remover.

### Importar base em CSV

O leitor reconhece vírgula, ponto e vírgula, tabulação e barra vertical, com ou
sem aspas, com BOM e com quebra de linha do Windows. As colunas são mapeadas
pelo cabeçalho em qualquer ordem: e-mail, nome, telefone e empresa, incluindo
variações como "celular", "razão social" e "responsável". Sem cabeçalho
reconhecível, ele deduz as colunas pelo conteúdo das células.

Contato sem e-mail válido, sem nome ou repetido no arquivo é ignorado e listado
no relatório da importação. O limite é de 2000 linhas por arquivo.

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
  card.js               gerador do card em canvas, post e story
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
    _news.js            coleta, classificacao e cotas por eixo editorial
    _email.js           modelo do e-mail, usado por disparo e simulador
    auth-login.js  auth-me.js
    market-data.js  market-news.js  market-agenda.js  news-image.js
    market-physical.js  indicadores do fisico e clima das pracas produtoras
    _indicators.js      coleta e validacao dos indicadores de preco
    cron-news.js        coleta agendada a cada 20 minutos
    generate-report.js  report.js  report-save.js
    subscribe.js  unsubscribe.js  subscribers.js
    send-campaign.js  campaign-preview.js
    health.js
  supabase/migrations/
    0001_investbras_market.sql
    0002_news_and_subscribers.sql
    0003_physical_indicators.sql
    0004_subscriber_phone.sql
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
- **Links do Google Noticias.** Eles nao redirecionam para a materia: a pagina e
  do proprio Google. Por isso a coleta nao tenta buscar capa nesses itens, e usa
  o `<source url>` do RSS para identificar o veiculo real e montar a miniatura
  de marca. Os portais diretos entregam foto e texto proprios.
- **Preço físico.** Ver "O caso do preço físico" acima. A leitura é automática
  e o painel só mostra o resultado, sem digitação.
- **PTAX em feriado.** O Banco Central so publica em dia util. A busca anda para
  tras dia a dia, e agora tem prazo proprio de 7 segundos: sem esse teto um
  feriado prolongado podia somar 48 segundos e estourar o limite da Function.
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
