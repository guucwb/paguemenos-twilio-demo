# PagueMenos — Demo Enterprise Twilio

Demo resiliente para rede de farmácias com **dois canais**:

| Canal | Tecnologia |
|---|---|
| **WhatsApp Calling (Voz)** | Twilio Voice + ConversationRelay + Verify + Flex |
| **WhatsApp Texto** | Twilio Studio + Verify + Flex |

---

## Arquitetura

```
Cliente WhatsApp
│
├─ Ligação (Voice) ──► POST /voice/inbound (TwiML)
│                          └─ ConversationRelay ──► WS /ws/conversationrelay
│                                                       ├─ Auth (Verify)
│                                                       ├─ Pedidos (/api/orders/*)
│                                                       └─ Escalate (/api/flex/escalate)
│
└─ Mensagem (Texto) ──► Twilio Studio (flow.json)
                            ├─ POST /api/auth/start
                            ├─ POST /api/auth/check
                            ├─ GET  /studio/order-message
                            ├─ POST /studio/resolve
                            └─ POST /api/flex/escalate
```

---

## Variáveis de Ambiente

Copie `.env.example` para `.env` e preencha:

| Variável | Onde obter |
|---|---|
| `PORT` | Porta local (padrão: 3000) |
| `BASE_URL` | URL pública do backend (ex.: `https://paguemenos.up.railway.app`) |
| `WS_PUBLIC_URL` | WebSocket público (ex.: `wss://paguemenos.up.railway.app/ws/conversationrelay`) |
| `TWILIO_ACCOUNT_SID` | Console > Dashboard |
| `TWILIO_AUTH_TOKEN` | Console > Dashboard |
| `VERIFY_SERVICE_SID` | Console > Verify > Services |
| `FLEX_WORKSPACE_SID` | Console > TaskRouter > Workspaces |
| `FLEX_QUEUE_SID` | Console > TaskRouter > Queues > "Farmacia_Demo" |
| `FLEX_WORKFLOW_SID` | Console > TaskRouter > Workflows |
| `TWILIO_WHATSAPP_NUMBER` | Número com WhatsApp habilitado |
| `FLEX_TRANSFER_NUMBER` | Número do Flex para transferência (opcional) |

---

## Setup Rápido (Desenvolvimento)

```bash
# 1. Instalar dependências
npm install

# 2. Configurar env
cp .env.example .env
# edite .env com suas credenciais

# 3. Gerar dados de teste
npm run seed

# 4. Iniciar em modo dev (hot-reload)
npm run dev
```

O servidor sobe em `http://localhost:3000`.

---

## Deploy no Railway

### Passo a passo

1. **Crie uma conta** em [railway.app](https://railway.app) e instale a CLI:
   ```bash
   npm install -g @railway/cli
   railway login
   ```

2. **Inicialize o projeto**:
   ```bash
   cd paguemenos
   railway init
   ```

3. **Adicione as variáveis de ambiente** no dashboard do Railway:
   - Vá em seu projeto > **Variables**
   - Adicione todas as variáveis do `.env.example` com valores reais

4. **Deploy**:
   ```bash
   railway up
   ```
   O Railway detecta o `Dockerfile` automaticamente via `railway.toml`.

5. **Obtenha a URL pública**:
   ```bash
   railway domain
   ```
   Use esta URL para configurar `BASE_URL` e `WS_PUBLIC_URL`.

6. **Atualize as variáveis** com a URL do Railway:
   ```
   BASE_URL=https://SEU-PROJETO.up.railway.app
   WS_PUBLIC_URL=wss://SEU-PROJETO.up.railway.app/ws/conversationrelay
   ```
   Faça redeploy após atualizar.

### Volumes (dados persistentes)

```bash
# No Railway, adicione um volume em /app/data
# Dashboard > seu serviço > Volumes > Add Volume
# Mount path: /app/data
```

Sem volume, os dados de seed são perdidos a cada deploy. Para demo, rode seed no container:
```bash
railway run npm run seed
```

---

## Configuração Twilio Console

### A) Voice + ConversationRelay (WhatsApp Calling)

1. Acesse seu número Twilio no Console
2. **Voice Configuration** > **A Call Comes In**
3. Tipo: **Webhook**, Método: **HTTP POST**
4. URL: `https://SEU_DOMINIO/voice/inbound`

> **Importante:** O WebSocket (`WS_PUBLIC_URL`) deve estar acessível publicamente.
> O Railway suporta WebSockets nativamente — não precisa de configuração extra.

### B) Studio Flow (WhatsApp Texto)

1. Acesse **Twilio Studio** no Console
2. Clique em **Create a flow** > **Import from JSON**
3. Cole o conteúdo de `flow.json`
4. Configure a variável de flow `BACKEND_URL`:
   - No Studio, vá em **Trigger** > **Flow Variables**
   - Adicione: `BACKEND_URL` = `https://SEU_DOMINIO`
5. **Publique** o flow
6. Conecte o flow ao sender WhatsApp:
   - Console > Messaging > Senders > seu número WhatsApp
   - **When a message comes in**: Studio Flow > selecione seu flow

### C) Verify Service

1. Console > **Verify** > **Services** > **Create new Service**
2. Nome: `PagueMenos Demo`
3. Copie o **Service SID** (VAxx...) para `VERIFY_SERVICE_SID`
4. Habilite os canais: **SMS** e **WhatsApp**

### D) Flex + TaskRouter

1. Acesse **Flex** no Console (primeira vez cria o ambiente automaticamente)
2. Acesse **TaskRouter** > **Workspaces** > selecione o workspace do Flex
3. Copie o **Workspace SID** para `FLEX_WORKSPACE_SID`
4. Crie a fila:
   - **Queues** > **Create new Queue**
   - Nome: `Farmacia_Demo`
   - Copie o **Queue SID** para `FLEX_QUEUE_SID`
5. Crie o workflow:
   - **Workflows** > **Create new Workflow**
   - Adicione uma regra: tasks com `taskType == "farmacia_demo"` → Queue `Farmacia_Demo`
   - Copie o **Workflow SID** para `FLEX_WORKFLOW_SID`

---

## Endpoints da API

| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/voice/inbound` | Webhook de voz (TwiML) |
| POST | `/api/auth/start` | Inicia Verify |
| POST | `/api/auth/check` | Verifica código OTP |
| GET | `/api/orders/last?phone=` | Último pedido do cliente |
| GET | `/api/orders/by-id?phone=&order=` | Pedido por ID |
| POST | `/api/flex/escalate` | Cria Task no Flex |
| POST | `/studio/resolve` | Resolve problema (Studio) |
| GET | `/studio/order-message?phone=` | Mensagem formatada do pedido |
| GET | `/studio/order-by-id?phone=&order=` | Pedido por ID formatado |
| WS | `/ws/conversationrelay` | WebSocket ConversationRelay |

**Endpoints de debug** (apenas em `NODE_ENV=development`):

| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/debug/sessions` | Sessões de voz ativas |
| GET | `/debug/session/:callSid` | Detalhes de sessão |
| GET | `/debug/customer/:last4` | Cliente por últimos 4 dígitos |
| GET | `/debug/data` | Dados do store (mascarado) |
| POST | `/debug/reload-store` | Recarrega JSON sem restart |

---

## Scripts

```bash
npm run dev      # Desenvolvimento com hot-reload
npm run build    # Compila TypeScript
npm run start    # Produção (após build)
npm run seed     # Gera dados de teste em data/
npm run test     # Testes (Jest)
```

---

## Studio Flow — Variáveis

No Studio, a variável `{{flow.variables.BACKEND_URL}}` deve ser configurada como:
```
https://SEU_DOMINIO
```

O flow usa as seguintes variáveis do Twilio:
- `{{contact.channel.address}}` — número WhatsApp do cliente (E.164)
- `{{trigger.message.InstanceSid}}` — SID da instância de mensagem
- `{{trigger.message.ChannelSid}}` — SID do canal
- `{{flow.channel.address}}` — número do sender (PagueMenos)

---

## Checklist Pré-Demo

- [ ] `npm run seed` rodado e `data/customers.json` existe
- [ ] `GET /health` retorna `{"status":"ok"}`
- [ ] Variáveis de env configuradas no Railway
- [ ] URL Railway configurada em `BASE_URL` e `WS_PUBLIC_URL`
- [ ] Webhook de voz configurado no Console Twilio
- [ ] Studio flow importado e publicado
- [ ] Flow variable `BACKEND_URL` configurada no Studio
- [ ] Verify Service com SMS e WhatsApp habilitados
- [ ] Flex/TaskRouter com fila `Farmacia_Demo` criada
- [ ] Número de teste no `customers.json` testado com `/api/orders/last?phone=`
- [ ] Testar auth: `POST /api/auth/start` com telefone real

---

## Plano B (se algo der errado ao vivo)

| Problema | Solução |
|---|---|
| Verify lento/falha | Oferecer SMS como fallback (automático no bot de voz) |
| Flex não configurado | Endpoint `/api/flex/escalate` retorna mock sem quebrar |
| Studio HTTP falha | Mensagem de erro amigável + escalate automático |
| WebSocket desconecta | Chamada cai, cliente liga de novo (sessão recriada) |
| Dados não encontrados | Bot oferece falar com atendente |

---

## Segurança

- Credenciais apenas em variáveis de ambiente
- PII mascarado em todos os logs (telefone → `****-XXXX`)
- Tokens OTP nunca logados
- Debug endpoints bloqueados em `NODE_ENV=production`
- `.gitignore` bloqueia `.env` e `data/*.json`
