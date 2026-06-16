# Relatório de Auditoria — Synka
**Data:** 2026-06-16  
**Escopo:** app/, site/, edge-functions/ (11 funções)  
**Status das correções:** aplicadas em ~/synka-projeto-claude/

---

## 🔴 CRÍTICO

### C1 — Inconsistência financeira: taxa exibida ≠ taxa cobrada ✅ CORRIGIDO
**Arquivo:** `app/PatientScreen.js` (modal de pagamento)

O modal de pagamento calculava a taxa como `(preco + frete) * 0.05 + 8` (percentual + fixo), mas a edge function `criar-pagamento` usa apenas `R$ 8` fixo. O usuário via um total **maior** do que o realmente cobrado pelo Mercado Pago.

```js
// ANTES (bugado)
const taxa = parseFloat(((preco + frete) * 0.05 + 8).toFixed(2));

// DEPOIS (correto — alinhado com criar-pagamento/index.ts)
const taxa = 8;
```

---

### C2 — Webhook do Mercado Pago sem verificação de assinatura ✅ CORRIGIDO
**Arquivo:** `edge-functions/mp-webhook/index.ts`

Qualquer pessoa com a URL do webhook poderia enviar uma requisição fake e acionar o fluxo completo de confirmação de pedido. Adicionada verificação HMAC-SHA256 com `x-signature` do Mercado Pago.

Adicionar `MP_WEBHOOK_SECRET` às variáveis de ambiente do Supabase (encontrado no painel do MP em Configurações > Notificações). Se a variável não estiver configurada, a verificação é pulada (graceful degradation).

---

### C3 — Tokens de API hardcodados no código-fonte ✅ CORRIGIDO
**Arquivos corrigidos:**
- `edge-functions/zapi-webhook/index.ts` — `ZAPI_INSTANCE`, `ZAPI_TOKEN`, `ZAPI_CLIENT_TOKEN`
- `edge-functions/solicitar-cotacao/index.ts` — `ZAPI_CLIENT_TOKEN` e fallbacks hardcoded
- `edge-functions/mp-webhook/index.ts` — `ZAPI_CLIENT_TOKEN`
- `edge-functions/validate-council/index.ts` — `CONSULTARIO_KEY`
- `edge-functions/search-prices/index.ts` — `SERP_KEY`

**Variáveis de ambiente a configurar no Supabase:**
| Variável | Onde usar |
|---|---|
| `ZAPI_INSTANCE` | zapi-webhook, solicitar-cotacao, mp-webhook |
| `ZAPI_TOKEN` | zapi-webhook, solicitar-cotacao, mp-webhook |
| `ZAPI_CLIENT_TOKEN` | zapi-webhook, solicitar-cotacao, mp-webhook |
| `CONSULTARIO_KEY` | validate-council |
| `SERP_KEY` | search-prices |
| `MP_WEBHOOK_SECRET` | mp-webhook (novo — para verificação de assinatura) |

---

### C4 — Campos `push_token` e `expo_push_token` conflitantes ✅ CORRIGIDO
**Arquivo:** `app/useNotifications.js`

`useNotifications.js` salvava em `push_token` mas nunca era importado por nenhum componente. `PatientScreen.js` usa `expo_push_token` (correto, lido pelo `zapi-webhook`). Arquivo `useNotifications.js` removido (dead code).

---

## 🟠 ALTO

### A1 — Observações do médico não aparecem na Ficha do Paciente ✅ CORRIGIDO
**Arquivo:** `app/DoctorScreen.js` — `FichaPaciente`

O médico preenchia "Observações" no Step 3, salvo em `recommendations.notes`. A `FichaPaciente` buscava o campo `observacoes` (sempre nulo) e exibia `r.observacoes`.

```js
// ANTES: campo errado
{r.observacoes ? <Text style={styles.historicoObs}>{r.observacoes}</Text> : null}

// DEPOIS: usa r.notes, mas ignora quando é JSON de manipulado
{r.notes && !r.notes.startsWith('{') ? <Text style={styles.historicoObs}>{r.notes}</Text> : null}
```

O SELECT também foi corrigido: removido `observacoes` (inexistente/nulo) e mantido `notes`.

---

### A2 — `recommendation_items` nunca populado, mas consultado
**Arquivo:** `app/DoctorScreen.js`

A tabela `recommendation_items` é referenciada nos SELECTs mas nunca recebe inserção. O fallback para `products?.name` funciona para prescrições com 1 produto, mas o design para múltiplos produtos por recomendação está incompleto.

**Ação necessária:** Implementar inserção em `recommendation_items` após salvar as recomendações, ou remover as referências e normalizar para múltiplas linhas em `recommendations`.

---

### A3 — Login não valida perfil contra o banco ✅ CORRIGIDO
**Arquivo:** `app/LoginScreen.js` — `doLogin`

Um médico podia selecionar "Sou paciente" na tela inicial, logar e entrar na `PatientScreen`. O `doLogin` passava `perfil` (escolhido pelo usuário) sem verificar no banco. Agora `doLogin` sempre passa `null`, forçando `detectarPerfil` a decidir.

```js
// ANTES
if (user?.id) onLogin(user, perfil); // sem validação

// DEPOIS
if (user?.id) onLogin(user, null); // detectarPerfil decide
```

---

### A4 — `email_pagador` sempre vazio no pagamento ✅ CORRIGIDO
**Arquivo:** `app/PatientScreen.js` — modal de pagamento

`rec.patients?.email` era sempre `undefined` pois a query de recs não faz join com patients. Corrigido para usar `patient?.email` (prop disponível no componente).

---

### A5 — `address` do paciente exigido para entrega, mas nunca coletado
**Arquivos:** `edge-functions/solicitar-cotacao/index.ts`, `edge-functions/mp-webhook/index.ts`

O campo aparece como "Não informado" em todas as notificações de farmácia. Necessário adicionar campo de endereço no perfil do paciente (app e site).

---

### A6 — CORS `*` em todas as edge functions
**Todos os arquivos em** `edge-functions/`

Retornam `'Access-Control-Allow-Origin': '*'`. Funções que processam pagamentos e dados de saúde deveriam restringir ao domínio `synkasaude.com.br`.

---

## 🟡 MÉDIO

### M1 — `health_profile` preenchido pelo paciente, invisível para o médico
**Arquivo:** `app/DoctorScreen.js` — `FichaPaciente`

Condições de saúde, alergias e medicamentos em uso não são exibidos para o médico. Implementar seção na FichaPaciente.

---

### M2 — `purchased_at` salvo mas nunca exibido
**Arquivo:** `app/PatientScreen.js:561`

Data de compra registrada mas não exibida em nenhuma tela.

---

### M3 — `gerarReceitaPDF` sem nome do paciente ✅ CORRIGIDO
**Arquivo:** `app/PatientScreen.js`

`rec.patients?.name` era sempre `undefined`. Função agora recebe `patientName` como segundo parâmetro.

---

### M4 — Número de pedido de cotação pode colidir ✅ CORRIGIDO
**Arquivo:** `edge-functions/solicitar-cotacao/index.ts`

Antes: `Math.floor(1000 + Math.random() * 9000)` — apenas 9.000 possibilidades.  
Depois: prefixo de 8 chars do UUID da recommendation + timestamp, praticamente sem colisão.

---

### M5 — `ilike` em vez de `eq` para busca por email ✅ CORRIGIDO
**Arquivo:** `app/PatientScreen.js:425`

Trocado para `eq` — busca exata, usa índice, mais rápida.

---

### M6 — Dupla filtragem redundante em TabInicio (médico)
**Arquivo:** `app/DoctorScreen.js`

A query já filtra no banco por status e período; a renderização refaz os mesmos filtros localmente. Baixo impacto prático mas confuso.

---

### M7 — `onAuthStateChange` não detecta perfil no SIGNED_IN ✅ CORRIGIDO
**Arquivo:** `app/App.js`

Se o usuário resetava a senha via deep link, ficava preso na tela de seleção mesmo autenticado. Agora `SIGNED_IN` também chama `detectarPerfil`.

---

### M8 — Polling a cada 3 segundos sem backoff
**Arquivo:** `app/PatientScreen.js` — `ProdutoCard`

Enquanto o modal de cotações fica aberto, uma query vai ao banco a cada 3 segundos. Recomendado: Supabase Realtime em vez de polling.

---

## 🔵 BAIXO

### B1 — `useNotifications.js` era dead code ✅ CORRIGIDO (removido)

### B2 — `select('*')` desnecessário em TabPacientes
**Arquivo:** `app/DoctorScreen.js:1249`

Traz `cpf`, `health_profile` (pode ser grande) etc. Deveria selecionar apenas os campos exibidos.

### B3 — `confirmarCompra` fazia query extra desnecessária ✅ CORRIGIDO
**Arquivo:** `app/PatientScreen.js`

Buscava `patient.id` via nova query + `getUser()`. Agora usa `patient?.id` da prop.

### B4 — Taxa Synka hardcodada em 4 lugares (agora alinhados após C1)
Após C1, todos usam `8` fixo. Idealmente centralizar em variável de ambiente.

### B5 — Catálogo de produtos pode ter duplicatas (app adiciona, site não)
### B6 — `isNutri` baseado em regex frágil
### B7 — Cotação enviada para TODAS as farmácias sem filtro geográfico

### B8 — `analyze-exam` não apagava arquivo do OpenAI em caso de erro ✅ CORRIGIDO
**Arquivo:** `edge-functions/analyze-exam/index.ts`

Adicionado `try/finally` para garantir DELETE do arquivo mesmo com erros.

---

## Resumo de Correções Aplicadas

| # | Severity | Arquivo | Status |
|---|---|---|---|
| C1 | 🔴 | PatientScreen.js | ✅ |
| C2 | 🔴 | mp-webhook/index.ts | ✅ |
| C3 | 🔴 | 5 edge functions | ✅ |
| C4 | 🔴 | useNotifications.js | ✅ (removido) |
| A1 | 🟠 | DoctorScreen.js | ✅ |
| A3 | 🟠 | LoginScreen.js | ✅ |
| A4 | 🟠 | PatientScreen.js | ✅ |
| M3 | 🟡 | PatientScreen.js | ✅ |
| M4 | 🟡 | solicitar-cotacao/index.ts | ✅ |
| M5 | 🟡 | PatientScreen.js | ✅ |
| M7 | 🟡 | App.js | ✅ |
| B3 | 🔵 | PatientScreen.js | ✅ |
| B8 | 🔵 | analyze-exam/index.ts | ✅ |

**Pendentes (requerem decisão de produto):** A2, A5, A6, M1, M2, M6, M8, B2, B4–B7
