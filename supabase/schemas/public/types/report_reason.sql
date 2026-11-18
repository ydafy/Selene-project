CREATE TYPE "public"."report_reason" AS ENUM (
  'fraud',
  'counterfeit_or_misdescribed',
  'prohibited_item',
  'offensive_content',
  'harassment',
  'spam',
  'other'
);
