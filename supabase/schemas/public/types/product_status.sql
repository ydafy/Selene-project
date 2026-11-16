CREATE TYPE "public"."product_status" AS ENUM (
  'pending_verification',
  'in_review',
  'verified',
  'sold',
  'rejected',
  'hidden',
  'reserved',
  'in_dispute'
);
