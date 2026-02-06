CREATE TABLE payment_methods (
id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
stripe_payment_method_id TEXT UNIQUE NOT NULL, -- ID que nos da Stripe
brand TEXT NOT NULL, -- visa, mastercard, amex
last4 TEXT NOT NULL, -- 4242
exp_month INT NOT NULL,
exp_year INT NOT NULL,
is_default BOOLEAN DEFAULT false,
created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS para que solo el dueño vea sus tarjetas
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own payment methods" ON payment_methods FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own payment methods" ON payment_methods FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own payment methods" ON payment_methods FOR DELETE USING (auth.uid() = user_id);
