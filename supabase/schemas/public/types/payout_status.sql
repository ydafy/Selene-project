CREATE TYPE "public"."payout_status" AS ENUM (
  'pending',
  'processing',
  'completed',
  'rejected'
);
