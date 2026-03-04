/**
 * npm run seed
 *
 * Gera /data/customers.json e /data/orders.json com dados fictícios realistas.
 * NENHUM dado real é incluído. Todos os números são fictícios.
 * Produtos: itens neutros de higiene/beleza/cuidados pessoais (sem medicamentos).
 */

import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');

// ── Tipos (duplicados aqui para não importar src/) ────────────────────────────

interface Customer {
  id: string;
  phoneNumber: string;
  name: string;
  email: string;
  cpf: string;
}

interface OrderItem {
  name: string;
  qty: number;
  unit: string;
}

interface Order {
  id: string;
  customerId: string;
  phoneNumber: string;
  items: OrderItem[];
  itemSummary: string;
  status: string;
  statusLabel: string;
  eta: string;
  confidence: string;
  createdAt: string;
}

// ── Dados base ────────────────────────────────────────────────────────────────

const FIRST_NAMES = ['Ana', 'Carlos', 'Fernanda', 'Rodrigo', 'Juliana', 'Marcos', 'Patrícia', 'Eduardo', 'Beatriz', 'Rafael'];
const LAST_NAMES = ['Silva', 'Santos', 'Oliveira', 'Souza', 'Lima', 'Pereira', 'Costa', 'Ferreira', 'Alves', 'Martins'];

const PRODUCTS: { name: string; unit: string }[] = [
  { name: 'Fralda Descartável Tamanho M', unit: 'pct' },
  { name: 'Shampoo Hidratante 400ml', unit: 'und' },
  { name: 'Condicionador Nutritivo 400ml', unit: 'und' },
  { name: 'Sabonete Líquido Lavanda 500ml', unit: 'und' },
  { name: 'Creme Hidratante Corporal 300g', unit: 'und' },
  { name: 'Perfume Floral 100ml', unit: 'und' },
  { name: 'Escova de Dente Macia', unit: 'und' },
  { name: 'Pasta de Dente Branqueadora 90g', unit: 'und' },
  { name: 'Absorvente Noturno', unit: 'pct' },
  { name: 'Lenços Umedecidos Baby', unit: 'pct' },
  { name: 'Protetor Solar FPS 50 200ml', unit: 'und' },
  { name: 'Desodorante Aerossol 150ml', unit: 'und' },
  { name: 'Cotonete 100un', unit: 'cx' },
  { name: 'Fio Dental 50m', unit: 'und' },
  { name: 'Gel de Banho Infantil 300ml', unit: 'und' },
];

const STATUSES: { status: string; statusLabel: string; confidence: string }[] = [
  { status: 'out_for_delivery', statusLabel: 'saiu para entrega', confidence: 'high' },
  { status: 'shipped', statusLabel: 'em trânsito', confidence: 'high' },
  { status: 'processing', statusLabel: 'em preparação', confidence: 'medium' },
  { status: 'shipped', statusLabel: 'em trânsito', confidence: 'low' },   // antigo
  { status: 'delivered', statusLabel: 'entregue', confidence: 'high' },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pad(n: number): string {
  return String(n).padStart(3, '0');
}

function etaFromStatus(status: string): string {
  const today = new Date();
  switch (status) {
    case 'out_for_delivery': return 'hoje até às 18h';
    case 'shipped': {
      const d = new Date(today);
      d.setDate(d.getDate() + randInt(1, 3));
      return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    }
    case 'processing': {
      const d = new Date(today);
      d.setDate(d.getDate() + randInt(2, 5));
      return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}`;
    }
    default:
      return 'já entregue';
  }
}

function buildItemSummary(items: OrderItem[]): string {
  if (items.length === 1) return `${items[0].qty}x ${items[0].name}`;
  if (items.length === 2) return `${items[0].qty}x ${items[0].name} e mais 1 item`;
  return `${items[0].qty}x ${items[0].name} e mais ${items.length - 1} itens`;
}

function createdAt(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

// ── Geração ───────────────────────────────────────────────────────────────────

const customers: Customer[] = [];
const orders: Order[] = [];

// 10 clientes, DDD 11 (São Paulo) — números fictícios
for (let i = 0; i < 10; i++) {
  const customerId = `CUST-${pad(i + 1)}`;
  const firstName = FIRST_NAMES[i];
  const lastName = rand(LAST_NAMES);
  const phoneDigits = String(90000000 + i * 11111 + randInt(100, 999)).slice(0, 9);
  const phoneNumber = `+5511${phoneDigits}`;

  customers.push({
    id: customerId,
    phoneNumber,
    name: `${firstName} ${lastName}`,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@email.example`,
    cpf: `***.***.${pad(randInt(100, 999))}-**`,
  });

  // 2-3 pedidos por cliente
  const numOrders = randInt(2, 3);
  for (let j = 0; j < numOrders; j++) {
    const orderId = `ORD-${pad(i * 3 + j + 1)}`;
    const numItems = randInt(1, 3);
    const items: OrderItem[] = [];
    const usedProducts = new Set<number>();

    for (let k = 0; k < numItems; k++) {
      let idx: number;
      do { idx = Math.floor(Math.random() * PRODUCTS.length); } while (usedProducts.has(idx));
      usedProducts.add(idx);
      items.push({ ...PRODUCTS[idx], qty: randInt(1, 3) });
    }

    // Pedido mais recente tem status ativo; anteriores podem ser entregues
    const statusPool = j === 0
      ? STATUSES.slice(0, 4)  // ativo
      : STATUSES.slice(3);    // entregue ou em trânsito antigo

    const statusInfo = rand(statusPool);
    const daysAgo = j === 0 ? randInt(0, 2) : randInt(3, 14);

    orders.push({
      id: orderId,
      customerId,
      phoneNumber,
      items,
      itemSummary: buildItemSummary(items),
      status: statusInfo.status,
      statusLabel: statusInfo.statusLabel,
      eta: etaFromStatus(statusInfo.status),
      confidence: j === 0 ? statusInfo.confidence : 'low',
      createdAt: createdAt(daysAgo),
    });
  }
}

// ── Escrita ───────────────────────────────────────────────────────────────────

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

fs.writeFileSync(path.join(DATA_DIR, 'customers.json'), JSON.stringify(customers, null, 2));
fs.writeFileSync(path.join(DATA_DIR, 'orders.json'), JSON.stringify(orders, null, 2));

console.log(`\n✅ Seed concluído`);
console.log(`   ${customers.length} clientes em data/customers.json`);
console.log(`   ${orders.length} pedidos em data/orders.json`);
console.log(`\nNúmeros de teste (fictícios):`);
customers.slice(0, 3).forEach(c => {
  const co = orders.filter(o => o.phoneNumber === c.phoneNumber);
  const latest = co[0];
  console.log(`   ${c.phoneNumber}  →  ${c.name}  |  último pedido: ${latest?.id} (${latest?.status})`);
});
console.log();
