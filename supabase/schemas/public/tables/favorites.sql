CREATE TABLE "public"."favorites" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "user_id"    uuid                     NOT NULL,
  "product_id" uuid                     NOT NULL,
  CONSTRAINT "favorites_pkey" PRIMARY KEY (id),
  CONSTRAINT "favorites_user_id_product_id_key" UNIQUE (user_id, product_id),
  CONSTRAINT "favorites_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

ALTER TABLE "public"."favorites"
  ENABLE ROW LEVEL SECURITY;

CREATE INDEX ix_favorites_product_id ON public.favorites USING btree (product_id);

CREATE TRIGGER trg_product_interest_on_favorite
  AFTER INSERT ON public.favorites
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_tr_product_interest_on_favorite();

CREATE POLICY "favorites_all" ON "public"."favorites"
  FOR ALL
  TO "authenticated"
  USING ((( SELECT auth.uid() AS uid) = user_id));

REVOKE ALL ON TABLE "public"."favorites" FROM "anon", "authenticated";

GRANT DELETE, INSERT, SELECT ON TABLE "public"."favorites" TO "authenticated";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."favorites" TO "service_role";

REVOKE ALL ON TABLE "public"."favorites" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."favorites" TO "postgres";
