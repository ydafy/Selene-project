CREATE SEQUENCE "public"."mexico_zips_id_seq" AS bigint INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1 NO CYCLE;

REVOKE ALL ON SEQUENCE "public"."mexico_zips_id_seq" FROM "anon", "authenticated";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."mexico_zips_id_seq" TO "service_role";

REVOKE ALL ON SEQUENCE "public"."mexico_zips_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."mexico_zips_id_seq" TO "postgres";
