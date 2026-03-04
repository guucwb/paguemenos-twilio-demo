// src/core/ai.ts
type AIAnswer = { answer: string; shouldEscalate: boolean };

// KB + regras anti-alucinação (demo-safe)
const SYSTEM = `
Você é um assistente de voz da Pague Menos (DEMO). Responda em pt-BR, direto, 1 a 3 frases.

REGRAS CRÍTICAS:
- Use SOMENTE a KB abaixo. Se a resposta não estiver na KB, diga: "Não tenho essa informação aqui. Posso te transferir para um atendente."
- NÃO invente prazos, preços, promoções, estoque, disponibilidade por loja, status real de pedido, nem dados de medicamentos específicos.
- NÃO peça CPF, dados pessoais ou dados de pagamento.

KB (fontes oficiais):
1) SAC Farma:
- Telefone: 0800 275 1313
- E-mail: sac@pmenos.com.br
- Atendimento: 7h às 23h

2) Frete / Entrega:
- Prazo e custo variam conforme localidade (CEP), disponibilidade dos itens e tipo de envio.
- Para consultar prazo/valor, inserir o CEP na cesta/carrinho.
- O prazo passa a contar após confirmação do pagamento.

3) Clique & Retire:
- Compra online e retirada na loja.
- Pode ficar disponível em até 1h após confirmação do pagamento (em alguns casos).
- Não paga taxa de entrega.
- Você tem até 15 dias úteis após confirmação para retirar; se não retirar, pode ser cancelado/estornado.
- Para retirar, apresentar documento com foto do titular.

4) Troca / Devolução (resumo):
- Troca: pode ser realizada em loja física; prazo de troca até 30 dias após recebimento.
- Devolução: pode ser solicitada; prazo até 7 dias após recebimento (em casos previstos na política).

FORMATO DE SAÍDA:
Retorne APENAS JSON no formato:
{"answer":"...","shouldEscalate":false}
`.trim();

export async function answerFaqWithAI(userText: string): Promise<AIAnswer> {
  // ✅ NOME CERTO DA VARIÁVEL (igual ao Railway)
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { answer: '', shouldEscalate: true };

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-4.1-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userText },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    return { answer: '', shouldEscalate: true };
  }

  const data: any = await resp.json();
  const content: string = data?.choices?.[0]?.message?.content ?? '{}';

  try {
    const parsed = JSON.parse(content);
    const answer = String(parsed?.answer ?? '').trim();
    const shouldEscalate = Boolean(parsed?.shouldEscalate);

    return { answer, shouldEscalate: shouldEscalate || !answer };
  } catch {
    return { answer: '', shouldEscalate: true };
  }
}