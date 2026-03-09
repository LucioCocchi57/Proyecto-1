-- Migration v3: Add ARCA certificate storage to clients
-- Run this in Supabase SQL Editor

ALTER TABLE clients ADD COLUMN IF NOT EXISTS arca_cert TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS arca_key TEXT;
