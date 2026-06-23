-- Fix: net.http_post espera body JSONB, não TEXT.
-- Trigger estava passando v_payload::text → erro 42883 → todo INSERT em recommendations falhava.

CREATE OR REPLACE FUNCTION public.fn_notify_nova_receita()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_push_token  TEXT;
  v_doctor_name TEXT;
  v_item_name   TEXT;
  v_payload     JSONB;
BEGIN
  IF NEW.doctor_id IS NULL OR NEW.patient_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.push_notifications_log
    WHERE patient_id = NEW.patient_id
      AND tipo = 'nova_receita'
      AND sent_at > now() - INTERVAL '60 seconds'
  ) THEN
    RETURN NEW;
  END IF;

  SELECT expo_push_token INTO v_push_token
    FROM public.patients WHERE id = NEW.patient_id;

  IF v_push_token IS NULL OR v_push_token = '' THEN
    RETURN NEW;
  END IF;

  SELECT name INTO v_doctor_name FROM public.doctors WHERE id = NEW.doctor_id;

  IF NEW.product_id IS NOT NULL THEN
    SELECT name INTO v_item_name FROM public.products WHERE id = NEW.product_id;
  ELSE
    BEGIN
      v_item_name := (NEW.notes::jsonb ->> 'nome');
    EXCEPTION WHEN OTHERS THEN
      v_item_name := NULL;
    END;
  END IF;

  INSERT INTO public.push_notifications_log (patient_id, tipo)
  VALUES (NEW.patient_id, 'nova_receita');

  v_payload := jsonb_build_object(
    'to',    v_push_token,
    'title', '💊 Nova receita — ' || COALESCE(v_doctor_name, 'seu médico'),
    'body',  COALESCE(v_item_name, 'Você tem novos itens prescritos.') || ' foi prescrito para você.',
    'data',  jsonb_build_object('tipo', 'nova_receita'),
    'sound', 'default'
  );

  PERFORM net.http_post(
    url     := 'https://exp.host/--/api/v2/push/send'::text,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := v_payload
  );

  RETURN NEW;
END;
$$;
