# Roteiro de Demo — PagueMenos Twilio Enterprise

> Versão para apresentação ao vivo. Prepare os dispositivos com antecedência.

---

## Pré-Demo: Setup (5 min antes)

1. **Backend rodando** (Railway ou `npm run dev` local)
2. **Verificar health**: `curl https://SEU_DOMINIO/health` → `{"status":"ok"}`
3. **Dados seedados**: `npm run seed` (ou confirmar que `data/` tem os arquivos)
4. **Telefone de demonstração** cadastrado (coloque o seu próprio número no seed)
5. **WhatsApp aberto** com o número PagueMenos
6. **Twilio Studio** com o flow publicado

---

## CANAL A — WHATSAPP CALLING (Voz + ConversationRelay)

### Cenário: Cliente liga via WhatsApp e resolve atraso de entrega

**Pré-requisito:** número do apresentador está em `customers.json`

---

**[Apresentador faz a ligação via WhatsApp para o número PagueMenos]**

---

#### Abertura

🤖 **Bot:**
> "Oi. Reconheci este número como cadastrado. Antes de acessar seus pedidos, vou validar sua identidade rapidinho. Quer receber o código por WhatsApp ou por SMS?"

👤 **Cliente:**
> "WhatsApp"

---

#### Autenticação

🤖 **Bot:**
> "Ok, enviei o código por WhatsApp. Me diga o código de 6 dígitos."

_[Código Verify chega no WhatsApp do apresentador]_

👤 **Cliente:**
> "1 2 3 4 5 6" _(fala o código recebido)_

🤖 **Bot:**
> "Validado. Encontrei um pedido recente associado a este número: pedido ORD-001, 2x Fralda Descartável Tamanho M, status saiu para entrega com previsão hoje até às 18h. É sobre esse pedido — diga um — ou sobre outro — diga dois?"

**Output esperado no terminal:**
```json
{"ts":"...","level":"info","event":"auth_approved","phone":"****-XXXX"}
{"ts":"...","level":"info","event":"last_order_presented","phone":"****-XXXX","orderId":"ORD-001","confidence":"high"}
```

---

#### Resolução

👤 **Cliente:**
> "Um" _(ou aperta "1" no teclado)_

🤖 **Bot:**
> "Ok. O que aconteceu com esse pedido? Pode ser: atraso na entrega, item faltando, ou outro problema."

👤 **Cliente:**
> "Meu pedido atrasou, ainda não chegou."

🤖 **Bot:**
> "Seu pedido ORD-001 está em rota de entrega. Atualizamos a previsão para hoje até às 18h. Você receberá uma notificação assim que o entregador sair. Posso ajudar com mais alguma coisa?"

**Output esperado:**
```json
{"ts":"...","level":"info","event":"resolved","phone":"****-XXXX","orderId":"ORD-001","issue":"delay","action":"eta_updated"}
```

_[Chamada encerra após 8 segundos]_

---

### Cenário alternativo: Escalação para humano

👤 **Cliente:** (na etapa de problema)
> "Tenho uma questão de cobrança no meu cartão."

🤖 **Bot:**
> "Questões de cobrança são tratadas pela equipe especializada. Vou te transferir agora com todo o contexto."

_[Pausa 2s]_

🤖 **Bot:**
> "Vou te transferir para um atendente agora e já vou mandar um resumo pra você não precisar repetir. Um momento."

**O que acontece nos bastidores:**
1. `POST /api/flex/escalate` cria Task no Flex com atributos completos
2. Twilio REST API redireciona a chamada para a fila Farmacia_Demo
3. Agente Flex recebe a task com `summary` e `nextBestAction` preenchidos

**Output esperado:**
```json
{"ts":"...","level":"info","event":"escalated","phone":"****-XXXX","reason":"billing_issue","orderId":"ORD-001"}
```

---

### Cenário: Palavra de urgência

👤 **Cliente:**
> "Isso é um absurdo, quero falar com o PROCON!"

🤖 **Bot (imediato):**
> "Vou te transferir para um atendente agora e já vou mandar um resumo pra você não precisar repetir. Um momento."

**Output:**
```json
{"ts":"...","level":"info","event":"escalated","reason":"urgency_detected"}
```

---

### Cenário: Falha na autenticação (2 tentativas)

👤 **Cliente (tentativa 1):** "1 1 1 1 1 1" _(código errado)_

🤖 **Bot:** "Código incorreto. Tente novamente — me diga os 6 dígitos."

👤 **Cliente (tentativa 2):** "2 2 2 2 2 2" _(código errado)_

🤖 **Bot:** "O código não confere por duas vezes. Por segurança, vou te transferir para um atendente."

_[Escala automaticamente com `handoffReason: "auth_failed"`]_

---

## CANAL B — WHATSAPP TEXTO (Studio Flow)

### Cenário: Status do pedido via texto

**[Apresentador abre WhatsApp e envia mensagem para o número PagueMenos]**

---

👤 **Cliente:** `oi`

🤖 **Studio:**
> "Olá! Bem-vindo à *PagueMenos* 💊
>
> Como posso te ajudar?
>
> *1* — Status do meu pedido
> *2* — Repetir minha última compra
> *3* — Falar com atendente"

---

👤 **Cliente:** `1`

🤖 **Studio:**
> "Antes de acessar seus pedidos, precisamos validar sua identidade rapidinho 🔐
>
> Como prefere receber o código?
>
> *1* — WhatsApp
> *2* — SMS"

---

👤 **Cliente:** `1`

_[Studio chama `POST /api/auth/start` com `channel: "whatsapp"`]_

🤖 **Studio:**
> "Ok! Enviamos o código agora 📩
>
> Por favor, me diga o código de *6 dígitos*:"

---

👤 **Cliente:** `123456` _(código recebido no WhatsApp)_

_[Studio chama `POST /api/auth/check`]_

_[Studio chama `GET /studio/order-message?phone=...`]_

🤖 **Studio:**
> "Encontrei um pedido recente:
>
> 📦 *Pedido #ORD-001*
> 🛍️ 2x Fralda Descartável Tamanho M e mais 1 item
> 📊 Status: saiu para entrega
> 🕐 Previsão: hoje até às 18h
>
> É sobre esse pedido?
> *1* - Sim, é esse
> *2* - Não, é outro"

---

👤 **Cliente:** `1`

🤖 **Studio:**
> "Qual é o problema com o pedido?
>
> *1* — Atraso na entrega
> *2* — Item faltando ou incorreto
> *3* — Questão de cobrança
> *4* — Outro / Falar com atendente"

---

👤 **Cliente:** `2` _(item faltando)_

_[Studio chama `POST /studio/resolve` com `issueType: "missing_item"`]_

🤖 **Studio:**
> "✅ Registramos a divergência no pedido #ORD-001. Em até 2 dias úteis você receberá o item faltante ou um reembolso integral. O número do protocolo é #P-ORD-001-MIS.
>
> Posso ajudar com mais alguma coisa? Responda com *menu* para voltar ao início."

---

### Cenário: Solicitar atendente direto

👤 **Cliente:** `3`

_[Studio chama `POST /api/flex/escalate`]_

🤖 **Studio:**
> "Ok! Conectando você com um atendente agora 👤
>
> Um instante, por favor. Em breve alguém da nossa equipe entrará em contato.
>
> _Protocolo: WTxx..._"

---

### Cenário: Cobrança (sempre escala)

👤 **Cliente:** _(após auth)_ `3` _(questão de cobrança)_

_[Studio chama `POST /api/flex/escalate` com `issueType: "billing"`]_

🤖 **Studio:**
> "Questões de cobrança são tratadas pela nossa equipe financeira especializada 💳
>
> Um atendente entrará em contato em breve com todas as informações do seu caso.
>
> _Protocolo: WTxx..._"

---

## Mostrar no Painel Flex (opcional)

1. Abra Flex em outra aba: `https://flex.twilio.com/`
2. Mostre a task chegando com os atributos:
   - `summary`: resumo da conversa
   - `nextBestAction`: o que o agente deve fazer
   - `orderId`, `issueType`, `authStatus`

---

## Debug ao Vivo

```bash
# Ver sessão de voz ativa (últimos 4 dígitos do telefone)
curl http://localhost:3000/debug/session-by-phone/1234

# Ver todos os dados (mascarado)
curl http://localhost:3000/debug/data

# Ver pedido diretamente
curl "http://localhost:3000/api/orders/last?phone=+5511912345678"
```

---

## Mensagens de Erro Amigáveis (fallback)

| Situação | O que o bot fala |
|---|---|
| Verify atrasa | "Quer tentar receber por SMS? Diga 'SMS' ou 'WhatsApp'." |
| 2 códigos errados | "Por segurança, vou te transferir para um atendente." |
| Pedido não encontrado | "Não encontrei pedidos. Pode me dizer o número do pedido?" |
| Erro de integração | "Houve um problema. Vou te passar para um atendente." |
| Palavra urgente | Escala imediatamente para Flex |
| 3 turns sem resolver | "Para te ajudar melhor, vou te passar para um atendente." |

---

## Dados de Teste (após `npm run seed`)

Os primeiros 3 clientes gerados aparecem no terminal do seed. Use o número do seu telefone
adicionando-o manualmente em `data/customers.json` e `data/orders.json` para a demo ao vivo.

**Exemplo de entrada manual em `data/customers.json`:**
```json
{
  "id": "CUST-DEMO",
  "phoneNumber": "+5511999999999",
  "name": "Demo PagueMenos",
  "email": "demo@paguemenos.example",
  "cpf": "***.***.***/  -**"
}
```

**Exemplo de pedido em `data/orders.json`:**
```json
{
  "id": "ORD-DEMO",
  "customerId": "CUST-DEMO",
  "phoneNumber": "+5511999999999",
  "items": [{ "name": "Fralda Descartável Tamanho M", "qty": 2, "unit": "pct" }],
  "itemSummary": "2x Fralda Descartável Tamanho M",
  "status": "out_for_delivery",
  "statusLabel": "saiu para entrega",
  "eta": "hoje até às 18h",
  "confidence": "high",
  "createdAt": "2025-01-01T10:00:00.000Z"
}
```

> Após editar, chame `POST /debug/reload-store` para recarregar sem restart.
