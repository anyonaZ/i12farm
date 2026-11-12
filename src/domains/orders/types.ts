export type OrderStatus = 'awaiting_payment' | 'paid' | 'accepted' | 'ready' | 'completed' | 'cancelled' | 'declined';
export type PaymentStatus = 'requested' | 'succeeded' | 'failed' | 'cancelled' | 'expired';

export const OPEN_STATUSES: OrderStatus[] = ['awaiting_payment', 'paid', 'accepted', 'ready'];

export interface OrderSummary {
  id: string;
  number: string;
  status: OrderStatus;
  subtotal_kes: number;
  created_at: string;
  fulfilment: 'pickup' | 'delivery';
  buyer_name: string | null;
  /** Last 3 digits of the buyer's phone, to tell unnamed buyers apart. */
  buyer_phone_tail: string | null;
  farm_name: string | null;
  farm_slug: string | null;
  item_count: number;
}

export interface OrderItem {
  id: string;
  title: string;
  unit: string;
  product_slug: string | null;
  unit_price_kes: number;
  quantity: number;
  line_total_kes: number;
}

export interface OrderDetail extends OrderSummary {
  delivery_note: string | null;
  visit_date: string | null;
  visit_slot: 'morning' | 'afternoon' | null;
  buyer_phone: string;
  commission_bps: number;
  commission_kes: number;
  farmer_payout_kes: number;
  /** Pesi's charge for collecting the payment, carried by the farm (0 until paid). */
  collection_fee_kes: number;
  paid_at: string | null;
  completed_at: string | null;
  i_am_buyer: boolean;
  i_manage: boolean;
  farm: { id: string; name: string; slug: string; phone: string | null; whatsapp: string | null; place: string | null } | null;
  items: OrderItem[];
  history: { from: OrderStatus | null; to: OrderStatus; note: string | null; at: string; by_system: boolean }[];
  payments: {
    id: string;
    status: PaymentStatus;
    amount: number;
    receipt: string | null;
    requested_at: string;
    result_desc: string | null;
  }[];
  review: { rating: number; body: string | null } | null;
}

export interface CartLine {
  listingId: string;
  quantity: number;
}
