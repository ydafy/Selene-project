
DECLARE
    v_auth_user_id UUID;
    v_bank_code TEXT;
    v_bank_name TEXT;
    v_weights INTEGER[] := ARRAY[3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7];
    v_sum INTEGER := 0;
    v_digit INTEGER;
    v_checksum INTEGER;
    v_last_digit INTEGER;
BEGIN
    -- 1. Seguridad JWT
    v_auth_user_id := (current_setting('request.jwt.claims', true)::json->>'sub')::UUID;
    IF v_auth_user_id IS NULL THEN
        RETURN QUERY SELECT false, NULL::TEXT, 'UNAUTHORIZED'::TEXT; RETURN;
    END IF;

    -- 2. Limpieza y Longitud
    p_clabe := regexp_replace(p_clabe, '\D', '', 'g');
    IF length(p_clabe) != 18 THEN
        RETURN QUERY SELECT false, NULL::TEXT, 'CLABE_INVALID_LENGTH'::TEXT; RETURN;
    END IF;

    -- 3. Identificar Banco
    v_bank_code := substr(p_clabe, 1, 3);
    SELECT name INTO v_bank_name FROM public.mexico_banks WHERE code = v_bank_code;
    IF v_bank_name IS NULL THEN v_bank_name := 'OTRO BANCO'; END IF;

    -- 4. Algoritmo Modulo 10 (Validación Matemática)
    FOR i IN 1..17 LOOP
        v_digit := cast(substr(p_clabe, i, 1) as integer);
        v_sum := (v_sum + (v_digit * v_weights[i])) % 10;
    END LOOP;

    v_checksum := (10 - v_sum) % 10;
    v_last_digit := cast(substr(p_clabe, 18, 1) as integer);

    IF v_checksum != v_last_digit THEN
        RETURN QUERY SELECT false, v_bank_name, 'CLABE_CHECKSUM_FAILED'::TEXT; RETURN;
    END IF;

    -- 5. Guardado Atómico (Upsert)
    INSERT INTO public.seller_bank_accounts (
        user_id, clabe, account_holder_name, bank_name, is_verified
    ) VALUES (
        v_auth_user_id, p_clabe, p_holder_name, v_bank_name, true -- SE AUTORIZA AUTOMÁTICAMENTE
    )
    ON CONFLICT (user_id) DO UPDATE SET
        clabe = EXCLUDED.clabe,
        account_holder_name = EXCLUDED.account_holder_name,
        bank_name = EXCLUDED.bank_name,
        is_verified = true,
        created_at = now();

    RETURN QUERY SELECT true, v_bank_name, NULL::TEXT;

EXCEPTION WHEN OTHERS THEN
    RETURN QUERY SELECT false, NULL::TEXT, SQLERRM;
END;
