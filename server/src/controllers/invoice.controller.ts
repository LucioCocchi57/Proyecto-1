import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { createUserClient } from '../config/supabase';
import { generateInvoicePDF } from '../services/pdf.service';

export const getInvoices = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { data, error } = await supabase
      .from('invoices')
      .select('*, client:clients(*), items:invoice_items(*)')
      .order('created_at', { ascending: false });

    if (error) { res.status(500).json({ error: error.message }); return; }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invoices' });
  }
};

export const getInvoiceById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { id } = req.params;

    const { data, error } = await supabase
      .from('invoices')
      .select('*, client:clients(*), items:invoice_items(*)')
      .eq('id', id)
      .single();

    if (error) { res.status(404).json({ error: 'Invoice not found' }); return; }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch invoice' });
  }
};

export const createInvoice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const {
      type, number, date, due_date, client_id, notes, items,
      receptor_name, receptor_cuit, receptor_tax_condition, receptor_address,
      punto_de_venta,
    } = req.body;

    if (!type || !date || !client_id || !items || items.length === 0) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    if (!receptor_name || !receptor_cuit) {
      res.status(400).json({ error: 'Receptor name and CUIT are required' });
      return;
    }

    // Calculate totals
    let subtotal = 0;
    let taxTotal = 0;

    const processedItems = items.map((item: any) => {
      const itemSubtotal = item.quantity * item.unit_price;
      const itemTax = itemSubtotal * (item.iva_rate / 100);
      subtotal += itemSubtotal;
      taxTotal += itemTax;
      return {
        description: item.description,
        quantity: item.quantity,
        unit_price: item.unit_price,
        iva_rate: item.iva_rate,
        subtotal: itemSubtotal,
      };
    });

    const total = subtotal + taxTotal;

    // Insert invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        type,
        number: number || 0,
        date,
        due_date: due_date || null,
        client_id,
        user_id: req.userId,
        receptor_name,
        receptor_cuit,
        receptor_tax_condition: receptor_tax_condition || null,
        receptor_address: receptor_address || null,
        punto_de_venta: punto_de_venta || null,
        subtotal,
        tax_total: taxTotal,
        total,
        notes,
      })
      .select()
      .single();

    if (invoiceError) { res.status(500).json({ error: invoiceError.message }); return; }

    // Insert items
    const itemsWithInvoiceId = processedItems.map((item: any) => ({
      ...item,
      invoice_id: invoice.id,
    }));

    const { error: itemsError } = await supabase
      .from('invoice_items')
      .insert(itemsWithInvoiceId);

    if (itemsError) { res.status(500).json({ error: itemsError.message }); return; }

    // Return full invoice with client and items
    const { data: fullInvoice } = await supabase
      .from('invoices')
      .select('*, client:clients(*), items:invoice_items(*)')
      .eq('id', invoice.id)
      .single();

    res.status(201).json(fullInvoice);
  } catch (error) {
    console.error('Create invoice error:', error);
    res.status(500).json({ error: 'Failed to create invoice' });
  }
};

export const updateInvoice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { id } = req.params;
    const { status, notes, due_date } = req.body;

    const updateData: any = {};
    if (status) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (due_date !== undefined) updateData.due_date = due_date || null;

    const { data, error } = await supabase
      .from('invoices')
      .update(updateData)
      .eq('id', id)
      .select('*, client:clients(*), items:invoice_items(*)')
      .single();

    if (error) { res.status(404).json({ error: 'Invoice not found' }); return; }
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update invoice' });
  }
};

export const getInvoicePDF = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { id } = req.params;

    const { data: invoice, error } = await supabase
      .from('invoices')
      .select('*, client:clients(*), items:invoice_items(*)')
      .eq('id', id)
      .single();

    if (error || !invoice) {
      res.status(404).json({ error: 'Invoice not found' });
      return;
    }

    const pdfData = {
      invoiceType: invoice.type,
      invoiceNumber: invoice.number,
      date: new Date(invoice.date).toLocaleDateString('es-AR'),
      cae: invoice.cae || undefined,
      caeExpiration: invoice.cae_expiration || undefined,
      emisor: {
        name: invoice.client?.name || '-',
        cuit: invoice.client?.cuit || '-',
        taxCondition: invoice.client?.tax_condition || '-',
        address: invoice.client?.address || '-',
        puntoDeVenta: invoice.punto_de_venta || invoice.client?.punto_de_venta || 1,
      },
      receptor: {
        name: invoice.receptor_name || '-',
        cuit: invoice.receptor_cuit || '-',
        taxCondition: invoice.receptor_tax_condition || '-',
        address: invoice.receptor_address || '-',
      },
      items: invoice.items.map((item: any) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        ivaRate: item.iva_rate,
        subtotal: item.subtotal,
      })),
      subtotal: invoice.subtotal,
      taxTotal: invoice.tax_total,
      total: invoice.total,
    };

    const doc = generateInvoicePDF(pdfData);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=factura-${invoice.type}-${String(invoice.number).padStart(8, '0')}.pdf`);
    doc.pipe(res);
    doc.end();
  } catch (error) {
    console.error('PDF generation error:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  }
};

export const deleteInvoice = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const supabase = createUserClient(req.accessToken!);
    const { id } = req.params;

    const { error } = await supabase
      .from('invoices')
      .delete()
      .eq('id', id);

    if (error) { res.status(404).json({ error: 'Invoice not found' }); return; }
    res.json({ message: 'Invoice deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete invoice' });
  }
};
