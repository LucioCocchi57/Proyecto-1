import { useEffect, useState, FormEvent } from 'react';
import api from '../services/api';
import { Invoice, Client } from '../types';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Borrador',
  ISSUED: 'Emitida',
  CANCELLED: 'Anulada',
  PAID: 'Pagada',
};

const STATUS_CLASSES: Record<string, string> = {
  DRAFT: 'status-draft',
  ISSUED: 'status-issued',
  CANCELLED: 'status-cancelled',
  PAID: 'status-paid',
};

const TAX_CONDITION_LABELS: Record<string, string> = {
  RESPONSABLE_INSCRIPTO: 'Responsable Inscripto',
  MONOTRIBUTISTA: 'Monotributista',
  CONSUMIDOR_FINAL: 'Consumidor Final',
  EXENTO: 'Exento',
};

const TAX_CONDITIONS = [
  { value: 'RESPONSABLE_INSCRIPTO', label: 'Responsable Inscripto' },
  { value: 'MONOTRIBUTISTA', label: 'Monotributista' },
  { value: 'CONSUMIDOR_FINAL', label: 'Consumidor Final' },
  { value: 'EXENTO', label: 'Exento' },
];

const EMPTY_ITEM = { description: '', quantity: 1, unit_price: 0, iva_rate: 21 };
const EMPTY_ITEM_NO_IVA = { description: '', quantity: 1, unit_price: 0, iva_rate: 0 };

const Invoices = () => {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [emitting, setEmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Invoice form
  const [type, setType] = useState<'A' | 'B' | 'C'>('A');
  const [number, setNumber] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [dueDate, setDueDate] = useState('');
  const [clientId, setClientId] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [isMonotributista, setIsMonotributista] = useState(false);

  // Punto de venta
  const [salesPoints, setSalesPoints] = useState<any[]>([]);
  const [puntoDeVenta, setPuntoDeVenta] = useState('');
  const [loadingSalesPoints, setLoadingSalesPoints] = useState(false);

  // Receptor form
  const [receptorName, setReceptorName] = useState('');
  const [receptorCuit, setReceptorCuit] = useState('');
  const [receptorTaxCondition, setReceptorTaxCondition] = useState('CONSUMIDOR_FINAL');
  const [receptorAddress, setReceptorAddress] = useState('');
  const [lookingUpCuit, setLookingUpCuit] = useState(false);

  useEffect(() => {
    fetchInvoices();
    fetchClients();
  }, []);

  const fetchInvoices = async () => {
    try {
      const { data } = await api.get('/invoices');
      setInvoices(data);
    } catch {
      setError('Error al cargar las facturas');
    } finally {
      setLoading(false);
    }
  };

  const fetchClients = async () => {
    try {
      const { data } = await api.get('/clients');
      setClients(data);
    } catch {
      // clients will just be empty
    }
  };

  // Fetch sales points from ARCA for a client
  const fetchSalesPoints = async (selectedClientId: string) => {
    if (!selectedClientId) return;
    setLoadingSalesPoints(true);
    try {
      const { data } = await api.get(`/arca/sales-points?client_id=${selectedClientId}`);
      // Filter only active, web-service-enabled sales points
      const wsEnabled = data.filter((sp: any) =>
        !sp.deactivated && !sp.blocked &&
        (sp.system?.toLowerCase().includes('web service') || sp.system?.toLowerCase().includes('web services'))
      );
      // If no WS points found, show all active ones
      const points = wsEnabled.length > 0 ? wsEnabled : data.filter((sp: any) => !sp.deactivated);
      setSalesPoints(points);
      if (points.length > 0) {
        setPuntoDeVenta(String(points[0].number));
      }
    } catch {
      setSalesPoints([]);
    } finally {
      setLoadingSalesPoints(false);
    }
  };

  // Fetch next invoice number from ARCA
  const fetchNextNumber = async (selectedClientId: string, selectedType: string, pdv?: string) => {
    if (!selectedClientId) return;
    const ptoVta = pdv || puntoDeVenta;
    try {
      const { data } = await api.get(`/arca/next-number?client_id=${selectedClientId}&type=${selectedType}${ptoVta ? `&punto_de_venta=${ptoVta}` : ''}`);
      setNumber(String(data.nextNumber));
    } catch {
      setNumber('');
    }
  };

  // When emisor client changes, auto-detect monotributista and fetch sales points
  const handleClientChange = async (newClientId: string) => {
    setClientId(newClientId);
    const selectedClient = clients.find((c) => c.id === newClientId);

    // Fetch sales points
    fetchSalesPoints(newClientId);

    if (selectedClient?.tax_condition === 'MONOTRIBUTISTA') {
      setIsMonotributista(true);
      setType('C');
      setItems(items.map((item) => ({ ...item, iva_rate: 0 })));
    } else {
      setIsMonotributista(false);
    }
    // Number will be fetched after sales points load
  };

  // When type changes, re-fetch number
  const handleTypeChange = (newType: 'A' | 'B' | 'C') => {
    setType(newType);
    if (clientId) fetchNextNumber(clientId, newType, puntoDeVenta);
  };

  // When punto de venta changes, re-fetch number
  const handlePuntoDeVentaChange = (newPdv: string) => {
    setPuntoDeVenta(newPdv);
    if (clientId) fetchNextNumber(clientId, type, newPdv);
  };

  // Auto-fetch number once sales points are loaded
  useEffect(() => {
    if (puntoDeVenta && clientId) {
      fetchNextNumber(clientId, type, puntoDeVenta);
    }
  }, [puntoDeVenta]);

  // Auto-fetch receptor data from CUIT
  const lookupReceptorCuit = async (cuit: string) => {
    const cleanCuit = cuit.replace(/[-\s]/g, '');
    if (cleanCuit.length < 10 || !clientId) return;

    setLookingUpCuit(true);
    setFormError('');
    try {
      const { data } = await api.get(`/arca/lookup-cuit?client_id=${clientId}&cuit=${cleanCuit}`);
      setReceptorName(data.name);
      setReceptorTaxCondition(data.tax_condition);
      if (data.address) setReceptorAddress(data.address);
    } catch (err: any) {
      const msg = err.response?.data?.error || err.response?.data?.detail || err.message || '';
      if (msg) setFormError(`No se pudo obtener datos del CUIT: ${msg}`);
    } finally {
      setLookingUpCuit(false);
    }
  };

  const openCreate = () => {
    setType('A');
    setNumber('');
    setDate(new Date().toISOString().split('T')[0]);
    setDueDate('');
    setClientId('');
    setNotes('');
    setItems([{ ...EMPTY_ITEM }]);
    setIsMonotributista(false);
    setSalesPoints([]);
    setPuntoDeVenta('');
    setReceptorName('');
    setReceptorCuit('');
    setReceptorTaxCondition('CONSUMIDOR_FINAL');
    setReceptorAddress('');
    setFormError('');
    setShowModal(true);
  };

  const addItem = () => {
    setItems([...items, isMonotributista ? { ...EMPTY_ITEM_NO_IVA } : { ...EMPTY_ITEM }]);
  };

  const removeItem = (index: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const updateItem = (index: number, field: string, value: string | number) => {
    const updated = items.map((item, i) => {
      if (i !== index) return item;
      return { ...item, [field]: value };
    });
    setItems(updated);
  };

  const calcSubtotal = () => items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
  const calcTax = () => items.reduce((sum, item) => sum + item.quantity * item.unit_price * (item.iva_rate / 100), 0);
  const calcTotal = () => calcSubtotal() + calcTax();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      const { data } = await api.post('/invoices', {
        type,
        number: number ? parseInt(number) : 0,
        date,
        due_date: dueDate || undefined,
        client_id: clientId,
        punto_de_venta: puntoDeVenta ? parseInt(puntoDeVenta) : undefined,
        receptor_name: receptorName,
        receptor_cuit: receptorCuit,
        receptor_tax_condition: receptorTaxCondition,
        receptor_address: receptorAddress,
        notes: notes || undefined,
        items,
      });
      setInvoices([data, ...invoices]);
      setShowModal(false);
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Error al crear la factura');
    } finally {
      setSubmitting(false);
    }
  };

  const handleViewInvoice = async (id: string) => {
    try {
      const { data } = await api.get(`/invoices/${id}`);
      setViewInvoice(data);
    } catch {
      setError('Error al cargar la factura');
    }
  };

  const handleDeleteInvoice = async (invoice: Invoice) => {
    if (!confirm('Eliminar esta factura? Esta accion no se puede deshacer.')) return;
    try {
      await api.delete(`/invoices/${invoice.id}`);
      setInvoices(invoices.filter((inv) => inv.id !== invoice.id));
      if (viewInvoice?.id === invoice.id) setViewInvoice(null);
    } catch {
      setError('Error al eliminar la factura');
    }
  };

  const handleEmitArca = async (invoice: Invoice) => {
    if (!confirm('Emitir esta factura en ARCA? Esta accion no se puede deshacer.')) return;
    setEmitting(true);
    setError('');
    try {
      const { data } = await api.post(`/arca/emit/${invoice.id}`);
      const updated = data.invoice;
      setInvoices(invoices.map((inv) => (inv.id === invoice.id ? updated : inv)));
      if (viewInvoice?.id === invoice.id) setViewInvoice(updated);
      alert(`Factura emitida! CAE: ${data.cae}`);
    } catch (err: any) {
      if (err.response?.data) {
        const msg = err.response.data.error || 'Error al emitir la factura';
        const detail = err.response.data.detail || '';
        setError(msg + (detail ? ` — ${detail}` : ''));
      } else {
        setError(err.message || 'Error de conexión al emitir la factura');
      }
    } finally {
      setEmitting(false);
    }
  };

  const handleDownloadPDF = async (invoice: Invoice) => {
    try {
      const response = await api.get(`/invoices/${invoice.id}/pdf`, { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `factura-${invoice.type}-${String(invoice.number).padStart(8, '0')}.pdf`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setError('Error al generar el PDF');
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('es-AR');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(amount);
  };

  if (loading) return <div className="page"><p>Cargando facturas...</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Facturas</h1>
        <button className="btn-primary" onClick={openCreate}>+ Nueva Factura</button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {invoices.length === 0 ? (
        <div className="empty-state">
          <p>No hay facturas creadas. Crea tu primera factura.</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Numero</th>
                <th>Fecha</th>
                <th>Emisor</th>
                <th>Receptor</th>
                <th>Total</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td><span className="invoice-type">Factura {invoice.type}</span></td>
                  <td>{String(invoice.number).padStart(8, '0')}</td>
                  <td>{formatDate(invoice.date)}</td>
                  <td>{invoice.client?.name || '-'}</td>
                  <td>{invoice.receptor_name || '-'}</td>
                  <td className="text-right">{formatCurrency(invoice.total)}</td>
                  <td>
                    <span className={`status-badge ${STATUS_CLASSES[invoice.status]}`}>
                      {STATUS_LABELS[invoice.status] || invoice.status}
                    </span>
                  </td>
                  <td>
                    <button className="btn-small" onClick={() => handleViewInvoice(invoice.id)}>Ver</button>
                    <button className="btn-small" onClick={() => handleDownloadPDF(invoice)}>PDF</button>
                    {invoice.status === 'DRAFT' && (
                      <>
                        <button className="btn-small btn-emit" onClick={() => handleEmitArca(invoice)} disabled={emitting}>
                          {emitting ? '...' : 'Emitir'}
                        </button>
                        <button className="btn-small btn-danger" onClick={() => handleDeleteInvoice(invoice)}>
                          Eliminar
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* View Invoice Modal */}
      {viewInvoice && (
        <div className="modal-overlay" onClick={() => setViewInvoice(null)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Factura {viewInvoice.type} — {String(viewInvoice.number).padStart(8, '0')}</h2>
              <button className="modal-close" onClick={() => setViewInvoice(null)}>&times;</button>
            </div>

            <div className="invoice-detail">
              <div className="detail-row">
                <div className="detail-group">
                  <span className="detail-label">Fecha</span>
                  <span>{formatDate(viewInvoice.date)}</span>
                </div>
                {viewInvoice.due_date && (
                  <div className="detail-group">
                    <span className="detail-label">Vencimiento</span>
                    <span>{formatDate(viewInvoice.due_date)}</span>
                  </div>
                )}
                <div className="detail-group">
                  <span className="detail-label">Estado</span>
                  <span className={`status-badge ${STATUS_CLASSES[viewInvoice.status]}`}>
                    {STATUS_LABELS[viewInvoice.status]}
                  </span>
                </div>
              </div>

              <div className="detail-section">
                <h3>Emisor (Cliente)</h3>
                <p><strong>{viewInvoice.client?.name}</strong></p>
                <p>CUIT: {viewInvoice.client?.cuit}</p>
                <p>Condicion: {TAX_CONDITION_LABELS[viewInvoice.client?.tax_condition || ''] || viewInvoice.client?.tax_condition}</p>
                <p>{viewInvoice.client?.address}, {viewInvoice.client?.city}</p>
              </div>

              <div className="detail-section">
                <h3>Receptor</h3>
                <p><strong>{viewInvoice.receptor_name || '-'}</strong></p>
                <p>CUIT: {viewInvoice.receptor_cuit || '-'}</p>
                <p>Condicion: {TAX_CONDITION_LABELS[viewInvoice.receptor_tax_condition || ''] || viewInvoice.receptor_tax_condition || '-'}</p>
                <p>{viewInvoice.receptor_address || '-'}</p>
              </div>

              <h3>Items</h3>
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Descripcion</th>
                      <th>Cant.</th>
                      <th>Precio Unit.</th>
                      {viewInvoice.type !== 'C' && <th>IVA</th>}
                      <th>Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewInvoice.items.map((item) => (
                      <tr key={item.id}>
                        <td>{item.description}</td>
                        <td>{item.quantity}</td>
                        <td>{formatCurrency(item.unit_price)}</td>
                        {viewInvoice.type !== 'C' && <td>{item.iva_rate}%</td>}
                        <td className="text-right">{formatCurrency(item.subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="invoice-totals">
                {viewInvoice.type !== 'C' ? (
                  <>
                    <div className="total-row"><span>Subtotal:</span><span>{formatCurrency(viewInvoice.subtotal)}</span></div>
                    <div className="total-row"><span>IVA:</span><span>{formatCurrency(viewInvoice.tax_total)}</span></div>
                  </>
                ) : null}
                <div className="total-row total-final"><span>Total:</span><span>{formatCurrency(viewInvoice.total)}</span></div>
              </div>

              {viewInvoice.cae && (
                <div className="detail-section cae-section">
                  <h3>Datos ARCA</h3>
                  <p><strong>CAE:</strong> {viewInvoice.cae}</p>
                  {viewInvoice.cae_expiration && (
                    <p><strong>Vencimiento CAE:</strong> {viewInvoice.cae_expiration}</p>
                  )}
                </div>
              )}

              {viewInvoice.notes && (
                <div className="detail-section">
                  <h3>Notas</h3>
                  <p>{viewInvoice.notes}</p>
                </div>
              )}
            </div>

            <div className="modal-actions">
              {viewInvoice.status === 'DRAFT' && (
                <button className="btn-small btn-danger" onClick={() => handleDeleteInvoice(viewInvoice)}>
                  Eliminar
                </button>
              )}
              <button className="btn-secondary" onClick={() => setViewInvoice(null)}>Cerrar</button>
              {viewInvoice.status === 'DRAFT' && (
                <button className="btn-emit-lg" onClick={() => handleEmitArca(viewInvoice)} disabled={emitting}>
                  {emitting ? 'Emitiendo...' : 'Emitir en ARCA'}
                </button>
              )}
              <button className="btn-primary" onClick={() => handleDownloadPDF(viewInvoice)}>Descargar PDF</button>
            </div>
          </div>
        </div>
      )}

      {/* Create Invoice Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Nueva Factura</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            {formError && <div className="error-message">{formError}</div>}
            <form onSubmit={handleSubmit}>
              <h3 className="section-title">Emisor (Cliente)</h3>
              <div className="form-group">
                <label>Cliente que emite la factura</label>
                <select value={clientId} onChange={(e) => handleClientChange(e.target.value)} required>
                  <option value="">Seleccionar cliente emisor...</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.cuit} ({TAX_CONDITION_LABELS[c.tax_condition]}) {!c.clave_fiscal ? '(sin clave fiscal)' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {isMonotributista && (
                <div className="info-message">
                  Monotributista: se emite Factura C sin IVA.
                </div>
              )}

              <div className="form-row">
                <div className="form-group">
                  <label>Tipo</label>
                  <select value={type} onChange={(e) => handleTypeChange(e.target.value as 'A' | 'B' | 'C')} required disabled={isMonotributista}>
                    <option value="A">Factura A</option>
                    <option value="B">Factura B</option>
                    <option value="C">Factura C</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Punto de Venta</label>
                  {loadingSalesPoints ? (
                    <input value="" readOnly placeholder="Cargando..." />
                  ) : salesPoints.length > 0 ? (
                    <select value={puntoDeVenta} onChange={(e) => handlePuntoDeVentaChange(e.target.value)} required>
                      {salesPoints.map((sp: any) => (
                        <option key={sp.number} value={sp.number}>{String(sp.number).padStart(4, '0')} - {sp.system || sp.displayName}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={puntoDeVenta} onChange={(e) => handlePuntoDeVentaChange(e.target.value)} placeholder="Ej: 1" type="number" required />
                  )}
                </div>
                <div className="form-group">
                  <label>Numero</label>
                  <input type="number" value={number} readOnly placeholder="Se asigna al emitir" />
                </div>
                <div className="form-group">
                  <label>Fecha</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Vencimiento</label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>

              <h3 className="section-title">Receptor (A quien se factura)</h3>
              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label>Nombre / Razon Social</label>
                  <input value={receptorName} onChange={(e) => setReceptorName(e.target.value)} placeholder="Nombre del receptor" required />
                </div>
                <div className="form-group" style={{ flex: 1 }}>
                  <label>CUIT</label>
                  <input value={receptorCuit} onChange={(e) => setReceptorCuit(e.target.value)} onBlur={() => lookupReceptorCuit(receptorCuit)} placeholder="XXXXXXXXXXX" required />
                  {lookingUpCuit && <small style={{ color: '#666' }}>Buscando en AFIP...</small>}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Condicion Fiscal</label>
                  <select value={receptorTaxCondition} onChange={(e) => setReceptorTaxCondition(e.target.value)} required>
                    {TAX_CONDITIONS.map((tc) => (
                      <option key={tc.value} value={tc.value}>{tc.label}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Direccion</label>
                  <input value={receptorAddress} onChange={(e) => setReceptorAddress(e.target.value)} placeholder="Direccion del receptor" />
                </div>
              </div>

              <h3 className="section-title">Items</h3>
              {items.map((item, index) => (
                <div className="form-row item-row" key={index}>
                  <div className="form-group" style={{ flex: 3 }}>
                    {index === 0 && <label>Descripcion</label>}
                    <input
                      value={item.description}
                      onChange={(e) => updateItem(index, 'description', e.target.value)}
                      placeholder="Descripcion del item"
                      required
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    {index === 0 && <label>Cantidad</label>}
                    <input
                      type="number"
                      min="1"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', parseFloat(e.target.value) || 0)}
                      required
                    />
                  </div>
                  <div className="form-group" style={{ flex: 1 }}>
                    {index === 0 && <label>Precio Unit.</label>}
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.unit_price}
                      onChange={(e) => updateItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                      required
                    />
                  </div>
                  {!isMonotributista && (
                    <div className="form-group" style={{ flex: 1 }}>
                      {index === 0 && <label>IVA %</label>}
                      <select
                        value={item.iva_rate}
                        onChange={(e) => updateItem(index, 'iva_rate', parseFloat(e.target.value))}
                      >
                        <option value={0}>0%</option>
                        <option value={10.5}>10.5%</option>
                        <option value={21}>21%</option>
                        <option value={27}>27%</option>
                      </select>
                    </div>
                  )}
                  <div className="form-group item-remove-col">
                    {index === 0 && <label>&nbsp;</label>}
                    <button type="button" className="btn-small btn-danger" onClick={() => removeItem(index)} disabled={items.length === 1}>
                      X
                    </button>
                  </div>
                </div>
              ))}
              <button type="button" className="btn-secondary btn-add-item" onClick={addItem}>+ Agregar Item</button>

              <div className="invoice-totals">
                {!isMonotributista && (
                  <>
                    <div className="total-row"><span>Subtotal:</span><span>{formatCurrency(calcSubtotal())}</span></div>
                    <div className="total-row"><span>IVA:</span><span>{formatCurrency(calcTax())}</span></div>
                  </>
                )}
                <div className="total-row total-final"><span>Total:</span><span>{formatCurrency(calcTotal())}</span></div>
              </div>

              <div className="form-group">
                <label>Notas</label>
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas opcionales" />
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Creando...' : 'Crear Factura'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Invoices;
