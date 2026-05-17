ALTER TABLE clients ADD COLUMN is_onboarding INTEGER DEFAULT 0;
ALTER TABLE clients ADD COLUMN onboarding_data TEXT;
ALTER TABLE clients ADD COLUMN bor_date TEXT;
