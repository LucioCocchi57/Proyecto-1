import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { createUserClient } from '../config/supabase';
import { getServerStatus, getLastInvoiceNumber, getLastInvoiceNumberFromMisComprobantes, emitElectronicInvoice, generateCertificate, authorizeWebService, lookupCuit, clearAfipInstance, getSalesPoints, ensureWebServiceSalesPoint } from '../services/afip.service';

export const getArcaStatus = async (_req: AuthRequest, res: Response): Promise<void> => {
  try {
    const status = await getServerStatus();
    res.json({ status: 'ok', arca: status });
  } catch (error: any) {
    res.status(500).json({ error: 'No se pudo conectar con ARCA', detail: error.message });
  }
};

export const getClientSalesPoints = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const clientId = req.query.client_id as string;
    if (!clientId) { res.status(400).json({ error: 'client_id es requerido' }); return; }

    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (error || !client) { res.status(404).json({ error: 'Cliente no encontrado' }); return; }

    const cuit = parseInt(client.cuit.replace(/-/g, ''));
    let cert = client.arca_cert;
    let key = client.arca_key;

    // Generate cert if missing but client has clave_fiscal
    if ((!cert || !key) && client.clave_fiscal) {
      try {
        console.log(`Generating cert for client ${cuit} (sales-points request)...`);
        const certResult = await generateCertificate(cuit, client.clave_fiscal);
        cert = certResult.cert;
        key = certResult.key;
        await supabase
          .from('clients')
          .update({ arca_cert: cert, arca_key: key })
          .eq('id', clientId);
      } catch (certError: any) {
        console.error('Could not generate cert:', certError.message);
      }
    }

    let points = await getSalesPoints(cuit, cert, key);

    // If no wsfe PVs and client has clave_fiscal, auto-create one
    if ((!points || points.length === 0) && client.clave_fiscal) {
      try {
        console.log(`No wsfe PVs for ${cuit}, auto-creating...`);
        const pvNumber = await ensureWebServiceSalesPoint(
          cuit, client.clave_fiscal, client.tax_condition || 'MONOTRIBUTISTA', client.name || '', cert, key
        );
        await supabase
          .from('clients')
          .update({ punto_de_venta: pvNumber })
          .eq('id', clientId);
        // Re-fetch sales points after creation
        points = await getSalesPoints(cuit, cert, key);
      } catch (pvError: any) {
        console.error('Could not auto-create wsfe PV:', pvError.message);
      }
    }

    res.json(points);
  } catch (error: any) {
    res.status(500).json({ error: 'Error al consultar puntos de venta', detail: error.message });
  }
};

export const lookupCuitInfo = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    console.log('CUIT lookup request:', req.query);
    const supabase = createUserClient(req.accessToken!);
    const clientId = req.query.client_id as string;
    const cuit = req.query.cuit as string;

    if (!cuit) {
      res.status(400).json({ error: 'cuit es requerido' });
      return;
    }

    // If client_id provided, use that client; otherwise pick any client with a cert
    let client: any;
    let usedClientId: string;

    if (clientId) {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();
      if (error || !data) {
        res.status(404).json({ error: `Cliente emisor no encontrado` });
        return;
      }
      client = data;
      usedClientId = clientId;
    } else {
      // Pick any client that has arca_cert or clave_fiscal
      const { data: candidates } = await supabase
        .from('clients')
        .select('*')
        .or('arca_cert.not.is.null,clave_fiscal.not.is.null')
        .limit(1);
      if (!candidates || candidates.length === 0) {
        res.status(400).json({ error: 'No hay clientes configurados con ARCA para realizar la consulta' });
        return;
      }
      client = candidates[0];
      usedClientId = client.id;
    }

    const emisorCuit = parseInt(client.cuit.replace(/-/g, ''));
    const targetCuit = parseInt(cuit.replace(/-/g, ''));

    // Helper to regenerate cert, clear cache, save to DB
    const regenerateCert = async () => {
      console.log(`Generating/regenerating cert for CUIT ${emisorCuit}...`);
      clearAfipInstance(emisorCuit);
      const certResult = await generateCertificate(emisorCuit, client.clave_fiscal);
      emisorCert = certResult.cert;
      emisorKey = certResult.key;
      await supabase
        .from('clients')
        .update({ arca_cert: emisorCert, arca_key: emisorKey })
        .eq('id', usedClientId);
    };

    let emisorCert = client.arca_cert;
    let emisorKey = client.arca_key;

    // Generate cert if client doesn't have one
    if ((!emisorCert || !emisorKey) && client.clave_fiscal) {
      await regenerateCert();
    }

    // Try lookup with up to one auto-recovery (cert mismatch or not authorized)
    let result;
    try {
      result = await lookupCuit(emisorCuit, targetCuit, emisorCert, emisorKey);
    } catch (lookupError: any) {
      const msg = lookupError.data?.message || lookupError.message || '';
      if (!client.clave_fiscal) throw lookupError;

      if (msg.includes('cert.untrusted') || msg.includes('certificado de desarrollo') ||
          msg.includes('notAuthorized') || msg.includes('autorizar')) {
        // Regenerate cert (also authorizes all web services)
        await regenerateCert();
        result = await lookupCuit(emisorCuit, targetCuit, emisorCert, emisorKey);
      } else {
        throw lookupError;
      }
    }

    if (!result) {
      res.status(404).json({ error: 'CUIT no encontrado en AFIP' });
      return;
    }

    res.json(result);
  } catch (error: any) {
    console.error('CUIT lookup error:', error.data || error.message || error);
    const detail = error.data?.message || (error.data ? JSON.stringify(error.data) : error.message);
    res.status(500).json({ error: `Error al consultar CUIT: ${detail}` });
  }
};

export const getNextInvoiceNumber = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const clientId = req.query.client_id as string;
    const type = (req.query.type as string) || 'A';

    if (!clientId) {
      res.status(400).json({ error: 'client_id es requerido' });
      return;
    }

    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (error || !client) {
      res.status(404).json({ error: 'Cliente no encontrado' });
      return;
    }

    const cuit = parseInt(client.cuit.replace(/-/g, ''));
    const puntoDeVenta = parseInt(req.query.punto_de_venta as string) || client.punto_de_venta || 1;

    // Ensure we have cert/key
    let emisorCert = client.arca_cert;
    let emisorKey = client.arca_key;
    if ((!emisorCert || !emisorKey) && client.clave_fiscal) {
      const certResult = await generateCertificate(cuit, client.clave_fiscal);
      emisorCert = certResult.cert;
      emisorKey = certResult.key;
      await supabase
        .from('clients')
        .update({ arca_cert: emisorCert, arca_key: emisorKey })
        .eq('id', clientId);
    }

    const TYPE_CODES: Record<string, number> = { A: 1, B: 6, C: 11 };
    const tipoComprobante = TYPE_CODES[type];

    if (!tipoComprobante) {
      res.status(400).json({ error: 'Tipo de comprobante inválido' });
      return;
    }

    let lastNumber = await getLastInvoiceNumber(cuit, puntoDeVenta, tipoComprobante, emisorCert, emisorKey);

    // If PV not enabled for wsfe (-1), try Mis Comprobantes automation
    if (lastNumber === -1 && client.clave_fiscal) {
      lastNumber = await getLastInvoiceNumberFromMisComprobantes(cuit, client.clave_fiscal, puntoDeVenta, type);
    }

    res.json({ lastNumber, nextNumber: lastNumber + 1 });
  } catch (error: any) {
    console.error('Next invoice number error:', error.data || error.message);
    res.status(500).json({ error: 'Error al consultar ARCA', detail: error.data?.message || error.message });
  }
};

// Generate certificate for a client
export const setupClient = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { clientId } = req.params;

    const { data: client, error } = await supabase
      .from('clients')
      .select('*')
      .eq('id', clientId)
      .single();

    if (error || !client) {
      res.status(404).json({ error: 'Cliente no encontrado' });
      return;
    }

    if (!client.clave_fiscal) {
      res.status(400).json({ error: 'El cliente no tiene clave fiscal configurada' });
      return;
    }

    const cuit = parseInt(client.cuit.replace(/-/g, ''));
    const result = await generateCertificate(cuit, client.clave_fiscal);

    // Store the cert and key in the client record
    await supabase
      .from('clients')
      .update({
        arca_cert: result.cert,
        arca_key: result.key,
      })
      .eq('id', clientId);

    // Ensure client has a web-service-enabled punto de venta
    try {
      const pvNumber = await ensureWebServiceSalesPoint(
        cuit, client.clave_fiscal, client.tax_condition || 'MONOTRIBUTISTA', client.name || '', result.cert, result.key
      );
      await supabase
        .from('clients')
        .update({ punto_de_venta: pvNumber })
        .eq('id', clientId);
    } catch (pvError: any) {
      console.error('Could not ensure wsfe PV:', pvError.message);
      // Non-fatal — cert was still generated successfully
    }

    res.json({ message: 'Certificado generado exitosamente' });
  } catch (error: any) {
    console.error('Setup client error:', error);
    res.status(500).json({ error: 'Error al generar certificado ARCA', detail: error.message });
  }
};

export const emitInvoice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { invoiceId } = req.params;

    // Get the invoice with client (emisor) and items
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .select('*, client:clients(*), items:invoice_items(*)')
      .eq('id', invoiceId)
      .single();

    if (invoiceError || !invoice) {
      res.status(404).json({ error: 'Factura no encontrada' });
      return;
    }

    if (invoice.status === 'ISSUED') {
      res.status(400).json({ error: 'Esta factura ya fue emitida' });
      return;
    }

    if (!invoice.client) {
      res.status(400).json({ error: 'No se encontró el cliente emisor' });
      return;
    }

    if (!invoice.client.clave_fiscal) {
      res.status(400).json({ error: 'El cliente emisor no tiene clave fiscal configurada. Editalo en la seccion Clientes.' });
      return;
    }

    const emisorCuit = parseInt(invoice.client.cuit.replace(/-/g, ''));
    const puntoDeVenta = invoice.punto_de_venta || invoice.client.punto_de_venta || 1;
    const receptorCuit = invoice.receptor_cuit || '';
    const receptorTaxCondition = invoice.receptor_tax_condition || 'CONSUMIDOR_FINAL';

    // Check if client has cert, if not generate one
    let emisorCert = invoice.client.arca_cert;
    let emisorKey = invoice.client.arca_key;

    if (!emisorCert || !emisorKey) {
      console.log(`Generating ARCA certificate for CUIT ${emisorCuit}...`);
      const certResult = await generateCertificate(emisorCuit, invoice.client.clave_fiscal);
      emisorCert = certResult.cert;
      emisorKey = certResult.key;

      // Save cert to client record for future use
      await supabase
        .from('clients')
        .update({ arca_cert: emisorCert, arca_key: emisorKey })
        .eq('id', invoice.client_id);
    }

    // Build emit params
    const emitParams = {
      emisorCuit,
      emisorCert,
      emisorKey,
      type: invoice.type as 'A' | 'B' | 'C',
      puntoDeVenta,
      receptorCuit,
      receptorTaxCondition,
      date: invoice.date,
      items: invoice.items.map((item: any) => ({
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        iva_rate: item.iva_rate,
        subtotal: item.subtotal,
      })),
      subtotal: invoice.subtotal,
      taxTotal: invoice.tax_total,
      total: invoice.total,
    };

    // Emit via ARCA, auto-authorize wsfe if not authorized
    let result;
    try {
      result = await emitElectronicInvoice(emitParams);
    } catch (emitError: any) {
      const errorMsg = emitError.data?.message || emitError.message || '';
      if ((errorMsg.includes('cert.untrusted') || errorMsg.includes('certificado de desarrollo')) && invoice.client.clave_fiscal) {
        // Cert mismatch — regenerate
        console.log(`Cert mismatch for CUIT ${emisorCuit}, regenerating...`);
        clearAfipInstance(emisorCuit);
        const certResult = await generateCertificate(emisorCuit, invoice.client.clave_fiscal);
        emitParams.emisorCert = certResult.cert;
        emitParams.emisorKey = certResult.key;
        await supabase
          .from('clients')
          .update({ arca_cert: certResult.cert, arca_key: certResult.key })
          .eq('id', invoice.client_id);
        result = await emitElectronicInvoice(emitParams);
      } else if (errorMsg.includes('notAuthorized') || errorMsg.includes('autorizar')) {
        console.log(`Auto-authorizing wsfe for CUIT ${emisorCuit}...`);
        await authorizeWebService(emisorCuit, invoice.client.clave_fiscal);
        result = await emitElectronicInvoice(emitParams);
      } else if (errorMsg.includes('alreadyAuthenticated') || errorMsg.includes('10 minutos')) {
        throw new Error('El servicio de ARCA está procesando la autenticación. Por favor esperá unos minutos e intentá de nuevo.');
      } else {
        throw emitError;
      }
    }

    // Update invoice with CAE and status
    const { data: updatedInvoice, error: updateError } = await supabase
      .from('invoices')
      .update({
        status: 'ISSUED',
        number: result.invoiceNumber,
        cae: result.cae,
        cae_expiration: result.caeExpiration,
      })
      .eq('id', invoiceId)
      .select('*, client:clients(*), items:invoice_items(*)')
      .single();

    if (updateError) {
      res.status(500).json({ error: 'Factura emitida en ARCA pero error al actualizar BD', cae: result.cae });
      return;
    }

    res.json({
      message: 'Factura emitida exitosamente',
      cae: result.cae,
      caeExpiration: result.caeExpiration,
      invoiceNumber: result.invoiceNumber,
      invoice: updatedInvoice,
    });
  } catch (error: any) {
    console.error('ARCA emit error:', error);
    // AFIP SDK puts error details in error.data (not error.response.data)
    const detail = error.data?.message || error.data
      ? (typeof error.data === 'string' ? error.data : JSON.stringify(error.data))
      : error.message;
    res.status(500).json({ error: 'Error al emitir factura en ARCA', detail });
  }
};
