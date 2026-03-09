import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { createUserClient } from '../config/supabase';
import { generateCertificate, ensureWebServiceSalesPoint } from '../services/afip.service';

export const getClients = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase
      .from('clients')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch clients' });
  }
};

export const getClientById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { id } = req.params;

    const { data, error } = await supabase
      .from('clients')
      .select('*, invoices(*)')
      .eq('id', id)
      .single();

    if (error) { res.status(404).json({ error: 'Client not found' }); return; }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch client' });
  }
};

export const createClient = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { name, cuit, tax_condition, address, city, province, postal_code, phone, email, clave_fiscal } = req.body;

    if (!name || !cuit || !tax_condition || !clave_fiscal) {
      res.status(400).json({ error: 'Nombre, CUIT, condicion fiscal y clave fiscal son requeridos' });
      return;
    }

    const insertData: any = {
      name, cuit, tax_condition,
      address: address || null, city: city || null, province: province || null,
      postal_code: postal_code || null, phone: phone || null, email: email || null,
    };
    if (clave_fiscal) insertData.clave_fiscal = clave_fiscal;

    // If clave_fiscal provided, generate ARCA cert and ensure wsfe PV
    if (clave_fiscal) {
      try {
        const cuitNum = parseInt(cuit.replace(/-/g, ''));
        const certResult = await generateCertificate(cuitNum, clave_fiscal);
        insertData.arca_cert = certResult.cert;
        insertData.arca_key = certResult.key;

        const pvNumber = await ensureWebServiceSalesPoint(
          cuitNum, clave_fiscal, tax_condition || 'MONOTRIBUTISTA', name || '', certResult.cert, certResult.key
        );
        insertData.punto_de_venta = pvNumber;
      } catch (arcaError: any) {
        console.error('ARCA setup during client creation:', arcaError.message);
        // Non-fatal: client gets created, ARCA can be set up later
      }
    }

    const { data, error } = await supabase
      .from('clients')
      .insert(insertData)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        res.status(409).json({ error: 'A client with this CUIT already exists' });
        return;
      }
      res.status(500).json({ error: error.message });
      return;
    }
    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create client' });
  }
};

export const updateClient = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { id } = req.params;

    const { data, error } = await supabase
      .from('clients')
      .update(req.body)
      .eq('id', id)
      .select()
      .single();

    if (error) { res.status(404).json({ error: 'Client not found' }); return; }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update client' });
  }
};

export const deleteClient = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { id } = req.params;

    const { error } = await supabase
      .from('clients')
      .delete()
      .eq('id', id);

    if (error) { res.status(404).json({ error: 'Client not found' }); return; }
    res.json({ message: 'Client deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete client' });
  }
};
