
BEGIN
  RETURN internal.fn_check_order_access(p_order_id);
END;
