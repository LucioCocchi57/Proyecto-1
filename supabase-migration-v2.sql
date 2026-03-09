-- ================================================
-- Migration v2: Restructure for accounting studio model
-- Clients = emisores, Invoices get receptor fields
-- Run this in Supabase SQL Editor
-- ================================================

-- Add clave_fiscal and punto_de_venta to clients (they are the emisores)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS clave_fiscal TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS punto_de_venta INTEGER DEFAULT 1;

-- Add receptor fields to invoices (who the invoice is issued TO)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receptor_name TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receptor_cuit TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receptor_tax_condition TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS receptor_address TEXT;

-- CAE fields (if not already added)
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cae TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cae_expiration TEXT;
