import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { createUserClient } from '../config/supabase';

export const getCompany = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase
      .from('companies')
      .select('*')
      .limit(1)
      .single();

    if (error) {
      res.status(404).json({ error: 'Company info not configured yet' });
      return;
    }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch company info' });
  }
};

export const upsertCompany = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const {
      razon_social, cuit, address, city, province, postal_code,
      phone, email, punto_de_venta, iibb, inicio_actividad,
    } = req.body;

    if (!razon_social || !cuit || !address || !city || !province || !postal_code || !punto_de_venta) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Check if company exists
    const { data: existing } = await supabase
      .from('companies')
      .select('id')
      .limit(1)
      .single();

    let result;
    if (existing) {
      result = await supabase
        .from('companies')
        .update({
          razon_social, cuit, address, city, province, postal_code,
          phone, email, punto_de_venta, iibb, inicio_actividad,
        })
        .eq('id', existing.id)
        .select()
        .single();
    } else {
      result = await supabase
        .from('companies')
        .insert({
          razon_social, cuit, address, city, province, postal_code,
          phone, email, punto_de_venta, iibb, inicio_actividad,
        })
        .select()
        .single();
    }

    if (result.error) { res.status(500).json({ error: result.error.message }); return; }
    res.json(result.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to save company info' });
  }
};
