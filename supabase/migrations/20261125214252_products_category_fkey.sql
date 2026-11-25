ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_category_fkey" FOREIGN KEY (category) REFERENCES public.category_configurations(category_name) ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX ix_products_category ON public.products USING btree (category);
