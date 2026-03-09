export type InvoiceType = 'A' | 'B' | 'C';
export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'CANCELLED' | 'PAID';
export type TaxCondition = 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTISTA' | 'CONSUMIDOR_FINAL' | 'EXENTO';

export interface Client {
  id: string;
  name: string;
  cuit: string;
  tax_condition: TaxCondition;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  phone?: string;
  email?: string;
  clave_fiscal?: string;
  punto_de_venta?: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: string;
  invoice_id: string;
  description: string;
  quantity: number;
  unit_price: number;
  iva_rate: number;
  subtotal: number;
  created_at: string;
}

export interface Invoice {
  id: string;
  type: InvoiceType;
  number: number;
  date: string;
  due_date?: string;
  client_id: string;
  client?: Client;
  receptor_name: string;
  receptor_cuit: string;
  receptor_tax_condition: TaxCondition;
  receptor_address: string;
  user_id: string;
  subtotal: number;
  tax_total: number;
  total: number;
  status: InvoiceStatus;
  notes?: string;
  cae?: string;
  cae_expiration?: string;
  items: InvoiceItem[];
  created_at: string;
  updated_at: string;
}

export interface Company {
  id: string;
  razon_social: string;
  cuit: string;
  address: string;
  city: string;
  province: string;
  postal_code: string;
  phone?: string;
  email?: string;
  punto_de_venta: number;
  iibb?: string;
  inicio_actividad?: string;
  created_at: string;
  updated_at: string;
}
