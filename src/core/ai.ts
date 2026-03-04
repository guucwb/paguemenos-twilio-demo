// src/core/ai.ts
type AIAnswer = { answer: string; shouldEscalate: boolean };

const SYSTEM = `
Você é um assistente de voz da Pague Menos (demo).
Regras:
- Responda em pt-BR, curto e direto (1 a 3 frases).
- NÃO invente dados. Se não souber, diga que pode transferir para um atendente.
- NÃO peça CPF nem dados sensíveis.
- Você pode responder perguntas gerais: entrega, retirada, troca/devolução, suporte, pagamento, horários (genéricos), canais de atendimento.
Retorne JSON puro no formato:
{"answer":"...","shouldEscalate":false}
`;

export async function answerFaqWithAI(userText: string): Promise<AIAnswer> {
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

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content ?? '{}';

  try {
    const parsed = JSON.parse(content);
    const answer = String(parsed.answer ?? '').trim();
    const shouldEscalate = Boolean(parsed.shouldEscalate);
    return { answer, shouldEscalate: shouldEscalate || !answer };
  } catch {
    return { answer: '', shouldEscalate: true };
  }
}