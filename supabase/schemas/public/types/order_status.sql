CREATE TYPE "public"."order_status" AS ENUM (
  'pending',
  'paid',
  'preparing',
  'shipped',
  'delivered',
  'completed',
  'cancelled',
  'dispute',
  'refunded'
);
