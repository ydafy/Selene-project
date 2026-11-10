CREATE TYPE "public"."dispute_status" AS ENUM (
  'open',
  'under_review',
  'waiting_return',
  'resolved',
  'rejected',
  'return_shipped',
  'return_delivered'
);
