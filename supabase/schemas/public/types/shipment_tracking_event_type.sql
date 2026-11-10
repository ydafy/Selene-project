CREATE TYPE "public"."shipment_tracking_event_type" AS ENUM (
  'created',
  'information',
  'in_transit',
  'delivered',
  'exception',
  'returned'
);
