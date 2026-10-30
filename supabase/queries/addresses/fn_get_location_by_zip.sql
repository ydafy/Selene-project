
BEGIN
    RETURN QUERY
    SELECT
        m.state_code,
        m.state_name,
        m.city,
        array_agg(m.district) as districts
    FROM public.mexico_zips m
    WHERE m.zip_code = p_zip
    GROUP BY m.state_code, m.state_name, m.city;
END;
