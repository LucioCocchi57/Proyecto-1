-- ================================================
-- Migration: Add ARCA (CAE) fields to invoices
-- Run this in Supabase SQL Editor
-- ================================================

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cae TEXT;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cae_expiration TEXT;
