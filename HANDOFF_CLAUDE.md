# Continuidade do projeto Compasso

Este documento permite retomar o trabalho no Claude ou em outro assistente. **Nenhuma transferência automática de conversa ou execução para Claude foi realizada.** Não foi encontrada integração callable nem comando `claude` no ambiente desta sessão. A disponibilidade/modelo deve ser verificada na ferramenta que o usuário escolher; não presumir que “Opus 5.5” esteja disponível.

## Pedido do usuário

Construir o máximo possível de uma aplicação de estudos de piano para navegador no computador e iPad de 12,9 polegadas: organizar partituras por estado, notas do professor, anotações nas páginas, trechos difíceis, metrônomo, aulas gravadas com IA e evolução. Loop significa **repetir um período de prática com metrônomo sem áudio da música**. O usuário pediu handoff ao Claude se a cota semanal restante chegar a 5%.

A consulta desta atualização mostrou 7% utilizados/93% disponíveis na cota semanal; o gatilho de 5% restantes não foi atingido. Não consumir créditos de reset nem instalar ferramentas pagas por inferência.

## Retomar

1. Trabalhar em `E:\APP Piano` no Windows/PowerShell. Ler `README.md`, `IMPLEMENTACAO.md` e `ARQUITETURA.md`.
2. Preservar os dados locais do usuário e a separação entre acervos por origem. Não limpar IndexedDB/armazenamento para resolver um erro sem exportação e autorização adequada.
3. `npm test` e `npm run build`. Último resultado: 34 testes aprovados e build aprovado, incluindo a correção de PDF digitalizado em branco, texto com tamanho ajustável, movimentação de anotações e ajustes de gravação no Firefox.
4. `npm start` abre servidor de produção em `http://127.0.0.1:4188/`. `npm run dev` usa 5188; `npm run server` fornece API em 8787. As portas podem estar ocupadas por processos deixados ao final da sessão; não terminar processos de outros projetos.
5. `.env.example` descreve a configuração. Nenhuma chave real foi inserida no projeto. `.env` não deve ser exposto no frontend, no Git ou em logs.

## Decisões e código

- React 19 + TypeScript + Vite; visual próprio “Compasso”, português, verde petróleo e fundo claro.
- Dexie/IndexedDB versão 2; tipos/validações em `src/domain.ts`; alterações de esquema exigem migração.
- PDF.js carrega dinamicamente; `scripts/pdf-assets.mjs` copia os decodificadores, CMaps, fontes e perfis da versão instalada antes de dev/build. `src/pdf/render.ts` renderiza em canvas temporário e impede publicação após cancelamento. Isso corrigiu a página branca reproduzida com JPEG2000. SVG com coordenadas normalizadas mantém marcações em zoom/redimensionamento; `score-export.ts` exporta com pdf-lib.
- `src/practice/timeline.ts` é função pura; `engine.ts` usa relógio Web Audio/lookahead e cancela sons na pausa. Não trocar a precisão sonora por um `setInterval` que toca diretamente a cada batida.
- Aulas usam MediaRecorder, chunks locais e recuperação. `Recorder.tsx` e `Lessons.tsx` concentram esse caminho. O navegador integrado caiu ao tocar o WAV de teste; investigar primeiro em Safari/Chrome antes de atribuir a falha ao codec ou à aplicação.
- Backend Fastify com autenticação Supabase para hospedagem, modo local restrito a loopback, limite por endpoint e duas chamadas simultâneas. API de IA usa segredo no servidor, saída estruturada e evidência literal filtrada.
- Supabase implementa apenas snapshots manuais privados, sem sincronização automática. O SQL ainda não foi aplicado em serviço real.
- Service worker precacheia build/fontes/worker PDF, exclui `/api` e espera abas antigas fecharem para atualizar. Reabertura sem servidor foi testada.
- Servidor estático utiliza `reply.header` na versão instalada de `@fastify/static`; há teste de regressão específico.

## Prioridade de continuação

Priorizar homologação do iPad físico e áudio, configuração HTTPS/IA/Supabase com recursos do usuário e evolução para sincronização incremental. A lista completa de pendências e limites está em `IMPLEMENTACAO.md`. Não apresentar integrações apenas implementadas como já configuradas ou homologadas.

O aplicativo foi deixado funcional para uso local; preservar os fluxos que já funcionam ao ampliar o projeto. Não reescrever a base em outro framework sem necessidade concreta.
