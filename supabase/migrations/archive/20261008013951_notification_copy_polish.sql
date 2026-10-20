-- N7: apply this whole transaction after the already-deployed actor RPCs and N5h.
-- Future notices only: no function invocation, row rewrite, or event replay.
-- Reject missing targets, changed bodies/security, duplicate literals and reruns.
-- Body fingerprints normalize CRLF pairs and boundary LF only; no SQL whitespace folding.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

DO $copy_polish$
DECLARE
  target RECORD;
  function_oid OID;
  before_catalog JSONB;
  after_catalog JSONB;
  before_defaults TEXT;
  after_defaults TEXT;
  definition TEXT;
  patched_definition TEXT;
  body TEXT;
  patched_body TEXT;
  old_literal TEXT;
  new_literal TEXT;
  i INTEGER;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('public.fn_resolve_dispute_to_buyer_as_admin(uuid,text,uuid)',
       '5719d7156d500821c35db34a99c6cd70', 0,
       ARRAY['Veredicto: Generar Guía',
             'Se aprobó la devolución. Consulta el pedido para generar la guía de retorno y continuar el proceso.'],
       ARRAY['Disputa resuelta a favor del comprador',
             'El equipo de Selene resolvió la disputa a favor del comprador. Sigue las instrucciones del pedido en la app para coordinar la devolución de tu producto.']),
      ('public.fn_resolve_dispute_to_seller_as_admin(uuid,text,uuid)',
       '72cc6c70d1a6edeb6a760a2289ca8055', 0,
       ARRAY['La disputa se resolvió a tu favor. Consulta el pedido para conocer el estado del pago.',
             'Disputa resuelta',
             'La disputa se resolvió a favor del vendedor. Consulta el pedido para conocer los detalles.'],
       ARRAY['El equipo de Selene resolvió la disputa a tu favor. Una vez liberado el pago, el depósito puede tardar 1–4 días hábiles, dependiendo de tu banco. Consulta el estado del pago en tu pedido.',
             'Disputa resuelta a favor del vendedor',
             'El equipo de Selene resolvió la disputa a favor del vendedor. No se aprobó un reembolso para esta disputa. Consulta los detalles en tu pedido.']),
      ('public.fn_seller_submit_return_evidence(uuid,text[],text)',
       'f41050fdee9a7fc407f581f2d070573d', 1,
       ARRAY['Evidencia del retorno recibida',
             'El vendedor presentó evidencia del retorno. Consulta el estado de tu caso.'],
       ARRAY['Tu disputa se reabrió para revisión',
             'El vendedor reportó un problema con el producto devuelto y presentó evidencia. La misma disputa se reabrió para revisar esa evidencia. Consulta los detalles del caso en tu pedido.'])
    ) AS targets(identity, expected_body_md5, expected_defaults, old_copy, new_copy)
  LOOP
    function_oid := pg_catalog.to_regprocedure(target.identity);
    IF function_oid IS NULL THEN
      RAISE EXCEPTION 'Missing copy target: %', target.identity;
    END IF;

    SELECT pg_catalog.to_jsonb(p), p.prosrc,
           pg_catalog.pg_get_functiondef(p.oid), pg_catalog.pg_get_expr(p.proargdefaults, 0)
      INTO before_catalog, body, definition, before_defaults
      FROM pg_catalog.pg_proc p
      WHERE p.oid = function_oid
        AND p.prokind = 'f' AND p.prosecdef
        AND p.prolang = (SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'plpgsql')
        AND p.pronargdefaults = target.expected_defaults
        AND p.proconfig = ARRAY['search_path=public, pg_temp']::text[];
    IF NOT FOUND OR md5(btrim(replace(body, E'\r\n', E'\n'), E'\n'))
                       IS DISTINCT FROM target.expected_body_md5 THEN
      RAISE EXCEPTION 'Copy target body or security drift: %', target.identity;
    END IF;

    -- Work from the installed definition, retaining all financial/state/auth logic.
    patched_definition := definition;
    patched_body := body;
    FOR i IN 1..cardinality(target.old_copy) LOOP
      old_literal := pg_catalog.quote_literal(target.old_copy[i]);
      new_literal := pg_catalog.quote_literal(target.new_copy[i]);
      -- Count full SQL-quoted literals, not substrings of another title/message.
      IF (length(definition) - length(replace(definition, old_literal, ''))) / length(old_literal) <> 1
         OR (length(body) - length(replace(body, old_literal, ''))) / length(old_literal) <> 1
         OR strpos(definition, new_literal) <> 0 THEN
        RAISE EXCEPTION 'Ambiguous, changed or already-applied copy in % (pair %)', target.identity, i;
      END IF;
      patched_definition := replace(patched_definition, old_literal, new_literal);
      patched_body := replace(patched_body, old_literal, new_literal);
    END LOOP;

    -- pg_get_functiondef supplies CREATE OR REPLACE with the existing signature,
    -- defaults, return shape, language, security and SET clauses. No ACL changes.
    EXECUTE patched_definition;

    SELECT pg_catalog.to_jsonb(p), pg_catalog.pg_get_expr(p.proargdefaults, 0)
      INTO after_catalog, after_defaults
      FROM pg_catalog.pg_proc p WHERE p.oid = function_oid;
    -- Default-expression AST source positions are nonsemantic and may change on
    -- definition roundtrip; compare deparsed defaults null-safely instead.
    -- Keep every other catalog field exact, including default count, identity,
    -- owner, ACLs, configuration and security; only the body changes intentionally.
    IF after_catalog IS NULL
       OR (after_catalog - 'prosrc' - 'proargdefaults') IS DISTINCT FROM (before_catalog - 'prosrc' - 'proargdefaults')
       OR after_defaults IS DISTINCT FROM before_defaults
       OR (after_catalog->>'prosrc') IS DISTINCT FROM patched_body
       OR pg_catalog.to_regprocedure(target.identity)::oid IS DISTINCT FROM function_oid
       OR pg_catalog.pg_get_functiondef(function_oid) IS DISTINCT FROM patched_definition THEN
      RAISE EXCEPTION 'Copy-only identity/security/body preservation failed: %', target.identity;
    END IF;
  END LOOP;
END;
$copy_polish$;

COMMIT;
