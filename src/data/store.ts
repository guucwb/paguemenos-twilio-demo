import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../logger';

// ── Tipos ────────────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  phoneNumber: string; // E.164
  name: string;
  email: string;
  cpf: string; // últimos 4 dígitos para display
}

export type OrderStatus = 'processing' | 'shipped' | 'out_for_delivery' | 'delivered' | 'cancelled';
export type OrderConfidence = 'high' | 'medium' | 'low';

export interface OrderItem {
  name: string;
  qty: number;
  unit: string;
}

export interface Order {
  id: string;
  customerId: string;
  phoneNumber: string;
  items: OrderItem[];
  itemSummary: string;
  status: OrderStatus;
  statusLabel: string;
  eta: string;
  confidence: OrderConfidence;
  createdAt: string;
}

// ── Carregamento lazy do JSON ─────────────────────────────────────────────────

let _customers: Customer[] | null = null;
let _orders: Order[] | null = null;

function loadFile<T>(filename: string): T[] {
  const filePath = path.join(config.dataDir, filename);
  if (!fs.existsSync(filePath)) {
    logger.warn(`store_file_missing`, { file: filename });
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T[];
  } catch (err) {
    logger.error(`store_parse_error`, { file: filename, error: String(err) });
    return [];
  }
}

function customers(): Customer[] {
  if (!_customers) _customers = loadFile<Customer>('customers.json');
  return _customers;
}

function orders(): Order[] {
  if (!_orders) _orders = loadFile<Order>('orders.json');
  return _orders;
}

/** Recarrega dados (útil em dev após seed sem restart) */
export function reloadStore(): void {
  _customers = null;
  _orders = null;
}

// ── API pública ───────────────────────────────────────────────────────────────

export function findCustomerByPhone(phoneNumber: string): Customer | undefined {
  // Normaliza: compara por sufixo de 10 dígitos para tolerar variações de código de país
  const normalizedInput = phoneNumber.replace(/\D/g, '').slice(-10);
  return customers().find(c => c.phoneNumber.replace(/\D/g, '').slice(-10) === normalizedInput);
}

export function getOrdersByPhone(phoneNumber: string): Order[] {
  const normalizedInput = phoneNumber.replace(/\D/g, '').slice(-10);
  return orders().filter(o => o.phoneNumber.replace(/\D/g, '').slice(-10) === normalizedInput);
}

export function getLastOrderByPhone(phoneNumber: string): Order | undefined {
  const customerOrders = getOrdersByPhone(phoneNumber);
  if (customerOrders.length === 0) return undefined;

  // Ordena por data decrescente e retorna o mais recente não entregue/cancelado
  const sorted = [...customerOrders].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Prefere pedidos ativos
  const active = sorted.find(o => !['delivered', 'cancelled'].includes(o.status));
  return active ?? sorted[0];
}

export function getOrderById(orderId: string, phoneNumber: string): Order | undefined {
  const normalizedInput = phoneNumber.replace(/\D/g, '').slice(-10);
  return orders().find(
    o => o.id === orderId && o.phoneNumber.replace(/\D/g, '').slice(-10) === normalizedInput
  );
}

export function getAllCustomers(): Customer[] {
  return customers();
}

export function getAllOrders(): Order[] {
  return orders();
}
