# Compasso · estudos de piano

Aplicação web para organizar repertório, partituras anotadas, trechos difíceis, ciclos de prática com metrônomo e orientações das aulas. Interface em português, responsiva para computador e iPad de 12,9 polegadas. Versão inicial 0.1.

O loop é um período de prática com metrônomo: você toca o trecho no piano. A aplicação não reproduz a música nem reconhece as notas tocadas.

## Executar no computador

Requisito: Node.js 24 LTS e npm. No terminal, na pasta do projeto:

```powershell
cd 'E:\APP Piano'
npm ci
npm run build
npm start
```

Abra **http://127.0.0.1:4188/**. O servidor precisa ficar aberto para o primeiro acesso. Não é necessário configurar serviços externos para usar partituras, metrônomo, notas, histórico e backups locais.

O navegador armazena seus dados por endereço. `localhost`, `127.0.0.1`, portas diferentes e o futuro domínio HTTPS são acervos separados. Para mudar de endereço ou dispositivo, exporte um backup em **Preferências e dados** e restaure no destino. A restauração substitui o acervo daquele navegador.

Para desenvolvimento com atualização automática:

```powershell
npm run dev
```

Abra http://127.0.0.1:5188/. Para a API opcional, rode `npm run server` em um segundo terminal; o Vite encaminha `/api` para a porta 8787. O modo offline é ativado somente no build de produção.

## Primeiro estudo

1. Em **Repertório**, adicione uma peça e escolha “Quero estudar”, “Em estudo” ou “Já estudei”.
2. Abra a peça e importe um PDF ou imagem. Versões novas preservam as anteriores.
3. Use caneta, marca-texto ou texto; ao inserir texto, escolha o tamanho da fonte entre 10 e 100. As camadas separam suas notas, dedilhado e orientações do professor. Para reposicionar uma marcação, escolha **Selecionar e mover** e arraste o texto, traço de caneta ou marca-texto. Com um texto selecionado, use **Editar texto e tamanho** para alterá-lo.
   A navegação entre páginas aparece acima e abaixo da partitura. Use **Tela cheia** na barra superior para ampliar a leitura; o botão muda para **Sair da tela cheia**. No computador, Esc também fecha a visualização ampliada.
4. Em **Marcar trecho**, arraste um retângulo sobre a passagem. Registre compassos, objetivo, mão, BPM e revisão.
5. Abra **Praticar**, selecione o trecho e configure duração, repetições, preparação, pausas e progressão do andamento.
6. Ao terminar, registre como foi. Em **Evolução**, consulte sessões e trechos a revisar.
7. Em **Aulas**, registre a aula, importe ou grave áudio e anote em momentos específicos. É possível escrever a transcrição manualmente.
8. Exporte seu backup regularmente em **Preferências e dados**.

Em **Evolução → Minhas gravações**, acompanhe o nível do microfone durante uma nova tentativa. Se o indicador não reagir, selecione outra entrada antes de gravar novamente. Para uma gravação antiga cuja barra de reprodução não mostra a duração, use **Criar cópia reproduzível**: o aplicativo tenta gerar um WAV com duração definida, mantendo o arquivo original e oferecendo **Baixar arquivo**. Se o áudio original não contiver sinal ou não puder ser decodificado, uma cópia não consegue recuperar o som ausente.

Rotinas permitem organizar passos com trechos e minutos, inclusive A–B–A. Cada passo é iniciado manualmente. A camada “Professor” é uma classificação feita por você; ainda não existe uma conta colaborativa de professor.

## Uso offline e iPad

O build inclui manifesto, ícones, fontes locais e service worker. Abra online e aguarde a indicação **“Aplicativo preparado para abrir offline neste navegador”** em Preferências. Partituras importadas, anotações e histórico ficam em IndexedDB; o cache guarda os arquivos do aplicativo. IA e nuvem exigem conexão.

Para usar no iPad, disponibilize o servidor em um domínio **HTTPS com certificado válido**, abra no Safari e use **Compartilhar → Adicionar à Tela de Início**. O endereço `127.0.0.1` do computador não funciona como endereço do computador no iPad. O projeto ainda não foi publicado em um domínio.

O layout foi inspecionado em tamanhos de tela de tablet; Apple Pencil, áudio, gravação, instalação e interrupções ainda precisam de teste no iPad físico. Mantenha a tela ativa durante a prática. O aplicativo pausa o metrônomo ao perder visibilidade; o sistema pode suspender áudio e microfone em segundo plano.

Dados locais não são sincronizados automaticamente. A persistência solicitada ao navegador reduz o risco de descarte, mas não substitui backup.

## Backup

**Preferências e dados → Exportar backup** gera um `.zip` com `manifest.json` (peças, trechos, marcações, sessões, aulas, notas, tarefas e rotinas) e a pasta `assets/` com as partituras e os áudios originais, sem conversão. O arquivo é montado aos poucos, sem carregar o acervo inteiro na memória. O limite é de 4 GB por backup (ZIP sem zip64); o navegador precisa de espaço livre parecido com o tamanho do acervo e a tela avisa quando ele parece insuficiente. Gravações interrompidas que ainda não foram recuperadas não entram no backup.

A restauração aceita o `.zip` e os `.json` de versões anteriores (até 180 MB). Antes de mexer em qualquer dado, ela confere o índice, a presença, o tamanho e a soma de verificação de cada arquivo e as ligações entre registros, e mostra um resumo para você confirmar. Tudo é gravado em uma única transação: se algo falhar, nada muda. A tela mostra quando foi o último backup deste navegador e avisa quando passa de 7 dias ou há arquivos novos desde então.

## Ativar IA opcional

Copie `.env.example` para `.env` e preencha **somente no servidor** `OPENAI_API_KEY`. Nunca coloque essa chave em variáveis `VITE_*`. Os modelos padrão são configuráveis:

```dotenv
OPENAI_TRANSCRIPTION_MODEL=whisper-1
OPENAI_SUMMARY_MODEL=gpt-4.1-mini
```

Para uso apenas no próprio computador, `ALLOW_LOCAL_AI=true` permite chamadas de loopback com host e origem locais. Reinicie o servidor após editar `.env`. Em hospedagem use `ALLOW_LOCAL_AI=false` e configure autenticação Supabase. A utilização do provedor pode gerar custos na conta associada à chave.

Áudio é enviado ao provedor somente ao clicar em **Transcrever áudio**, e a transcrição somente ao clicar em **Analisar transcrição**. As propostas de tarefa precisam ser aceitas individualmente. Cada proposta contém evidência literal da transcrição; o servidor descarta propostas sem evidência correspondente. Isso não garante que toda interpretação esteja correta: revise o texto.

Limites iniciais: áudio de até 24 MB por transcrição, texto até 100.000 caracteres e duas chamadas simultâneas de IA por processo. Gravações longas exigem recorte externo ou transcrição manual nesta versão. Nenhuma chave ou chamada paga foi utilizada na validação deste projeto.

## Backups privados na nuvem, opcionais

1. Use um projeto Supabase seu e aplique uma vez `supabase/migrations/001_private_backups.sql` e depois `002_zip_backups.sql` (quem já usa a nuvem aplica só a 002).
2. Crie o usuário no Supabase Auth; o aplicativo possui entrada para conta existente, sem fluxo de cadastro/recuperação de senha nesta versão.
3. Configure `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` antes do build. São configurações públicas; nunca use uma chave `service_role` no navegador.
4. Para autenticar a API de IA, configure também `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `ALLOW_LOCAL_AI=false` no servidor.
5. Refaça `npm run build`, reinicie e entre em **Preferências e dados**.

O SQL cria tabela e bucket privados com regras por usuário. Cada envio cria uma cópia manual imutável, no mesmo `.zip` da exportação local. A tela lista as cinco cópias mais recentes; as antigas em `.json` continuam restauráveis. Restaurar substitui os dados locais; não existe mesclagem automática entre aparelhos. Cada cópia na nuvem aceita até 45 MB, limite igual no bucket, na tabela e na tela; para acervos maiores use a exportação local.

A integração está implementada, mas não foi testada contra um projeto real. Antes de disponibilizar para terceiros, valide as regras com dois usuários diferentes e configure limites financeiros no provedor de IA.

## Hospedar

`npm start` serve o conteúdo de `dist` e `/api` no mesmo processo. Por padrão escuta apenas `127.0.0.1`; atrás de um proxy na mesma máquina isso é suficiente. A hospedagem precisa de HTTPS, variáveis de ambiente e um processo Node persistente. Configure `HOST` e `PORT` conforme seu ambiente.

Há um Dockerfile de duas etapas, com usuário sem privilégios e porta 4188:

```sh
docker build -t compasso .
docker run --rm -p 127.0.0.1:4188:4188 --env-file .env compasso
```

Para nuvem no frontend, passe as duas variáveis `VITE_SUPABASE_*` como `--build-arg`. Em produção configure explicitamente `ALLOW_LOCAL_AI=false`. Não envie `.env` ao controle de versão. O container não foi executado nesta sessão; foi validado o servidor Node local.

## Verificação e organização

```powershell
npm test
npm run build
```

São 34 testes cobrindo contagem de prática, agendamento de áudio com relógio simulado, recuperação de capturas, formato e análise de gravações, integridade de backup, movimentação de anotações, preservação de registros vinculados, renderização/cancelamento de PDF e fronteiras da API. Os testes de IA usam respostas simuladas do provedor.

Os comandos `npm run dev` e `npm run build` preparam automaticamente os recursos auxiliares do PDF.js em `public/pdfjs/<versão>`. Eles incluem decodificadores de imagens digitalizadas (JPEG2000/JBIG2), fontes e perfis de cor. Preserve essa pasta no pacote publicado: sem esses recursos, certos PDFs podem ficar em branco. O build de produção inclui esses arquivos no cache offline.

| Pasta/arquivo                          | Responsabilidade                                    |
| -------------------------------------- | --------------------------------------------------- |
| `src/domain.ts`, `src/db.ts`           | Tipos, validações e banco local versionado          |
| `src/components`                       | Telas e fluxos da aplicação                         |
| `src/practice`                         | Linha do tempo e metrônomo Web Audio                |
| `src/backup.ts`, `src/score-export.ts` | Portabilidade dos dados e exportação de PDF         |
| `server`                               | API de IA autenticada e servidor de produção        |
| `supabase/migrations`                  | Estrutura opcional de backups privados              |
| `scripts/service-worker.mjs`           | Cache offline gerado a partir do build              |
| `tests`                                | Testes automatizados e arquivos sintéticos de teste |

Veja [IMPLEMENTACAO.md](./IMPLEMENTACAO.md) para resultados e limitações, [ARQUITETURA.md](./ARQUITETURA.md) para a visão de longo prazo, [PESQUISA_APPS.md](./PESQUISA_APPS.md) para referências e [HANDOFF_CLAUDE.md](./HANDOFF_CLAUDE.md) para continuidade por outro assistente.
