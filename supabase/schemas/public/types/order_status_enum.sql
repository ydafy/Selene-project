CREATE TYPE "public"."order_status_enum" AS ENUM (
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
