import { useEffect, useState, FormEvent } from 'react';
import api from '../services/api';
import { Client } from '../types';

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

const EMPTY_FORM = {
  name: '',
  cuit: '',
  tax_condition: 'CONSUMIDOR_FINAL',
  address: '',
  city: '',
  province: '',
  postal_code: '',
  phone: '',
  email: '',
  clave_fiscal: '',
};

const Clients = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [lookingUpCuit, setLookingUpCuit] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      const { data } = await api.get('/clients');
      setClients(data);
    } catch {
      setError('Error al cargar los clientes');
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setFormData(EMPTY_FORM);
    setEditingId(null);
    setFormError('');
    setShowPassword(false);
    setShowModal(true);
  };

  const openEdit = (client: Client) => {
    setFormData({
      name: client.name,
      cuit: client.cuit,
      tax_condition: client.tax_condition,
      address: client.address,
      city: client.city,
      province: client.province,
      postal_code: client.postal_code,
      phone: client.phone || '',
      email: client.email || '',
      clave_fiscal: client.clave_fiscal || '',
    });
    setEditingId(client.id);
    setFormError('');
    setShowModal(true);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);

    const payload = { ...formData };

    try {
      if (editingId) {
        const { data } = await api.put(`/clients/${editingId}`, payload);
        setClients(clients.map((c) => (c.id === editingId ? data : c)));
      } else {
        const { data } = await api.post('/clients', payload);
        setClients([data, ...clients]);
      }
      setShowModal(false);
    } catch (err: any) {
      setFormError(err.response?.data?.error || 'Error al guardar el cliente');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Estas seguro de eliminar este cliente?')) return;
    try {
      await api.delete(`/clients/${id}`);
      setClients(clients.filter((c) => c.id !== id));
    } catch {
      setError('Error al eliminar el cliente');
    }
  };

  const lookupClientCuit = async (cuit: string) => {
    const cleanCuit = cuit.replace(/[-\s]/g, '');
    if (cleanCuit.length < 10) return;

    setLookingUpCuit(true);
    setFormError('');
    try {
      const { data } = await api.get(`/arca/lookup-cuit?cuit=${cleanCuit}`);
      setFormData((prev) => ({
        ...prev,
        name: data.name || prev.name,
        tax_condition: data.tax_condition || prev.tax_condition,
        address: data.address || prev.address,
      }));
    } catch (err: any) {
      const msg = err.response?.data?.error || err.message || '';
      if (msg) setFormError(`No se pudo obtener datos del CUIT: ${msg}`);
    } finally {
      setLookingUpCuit(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });

    if (name === 'cuit') {
      const clean = value.replace(/[-\s]/g, '');
      if (clean.length >= 10) lookupClientCuit(value);
    }
  };

  if (loading) return <div className="page"><p>Cargando clientes...</p></div>;

  return (
    <div className="page">
      <div className="page-header">
        <h1>Clientes</h1>
        <button className="btn-primary" onClick={openCreate}>+ Nuevo Cliente</button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {clients.length === 0 ? (
        <div className="empty-state">
          <p>No hay clientes registrados. Agrega tu primer cliente.</p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>CUIT</th>
                <th>Condicion Fiscal</th>
                <th>Pto. Venta</th>
                <th>ARCA</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>{client.name}</td>
                  <td>{client.cuit}</td>
                  <td>{TAX_CONDITION_LABELS[client.tax_condition] || client.tax_condition}</td>
                  <td>{String(client.punto_de_venta || 1).padStart(4, '0')}</td>
                  <td>
                    {client.clave_fiscal ? (
                      <span className="status-badge status-paid">Configurado</span>
                    ) : (
                      <span className="status-badge status-draft">Sin clave</span>
                    )}
                  </td>
                  <td>
                    <button className="btn-small" onClick={() => openEdit(client)}>Editar</button>
                    <button className="btn-small btn-danger" onClick={() => handleDelete(client.id)}>Eliminar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{editingId ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
              <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            {formError && <div className="error-message">{formError}</div>}
            <form onSubmit={handleSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>Nombre / Razon Social</label>
                  <input name="name" value={formData.name} onChange={handleChange} required />
                </div>
                <div className="form-group">
                  <label>CUIT</label>
                  <input name="cuit" value={formData.cuit} onChange={handleChange} placeholder="XX-XXXXXXXX-X" required />
                  {lookingUpCuit && <small style={{ color: '#666' }}>Buscando en AFIP...</small>}
                </div>
              </div>
              <div className="form-group">
                <label>Condicion Fiscal</label>
                <select name="tax_condition" value={formData.tax_condition} onChange={handleChange} required>
                  {TAX_CONDITIONS.map((tc) => (
                    <option key={tc.value} value={tc.value}>{tc.label}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Direccion</label>
                <input name="address" value={formData.address} onChange={handleChange} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Ciudad</label>
                  <input name="city" value={formData.city} onChange={handleChange} />
                </div>
                <div className="form-group">
                  <label>Provincia</label>
                  <input name="province" value={formData.province} onChange={handleChange} />
                </div>
                <div className="form-group">
                  <label>Codigo Postal</label>
                  <input name="postal_code" value={formData.postal_code} onChange={handleChange} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Telefono</label>
                  <input name="phone" value={formData.phone} onChange={handleChange} />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input name="email" type="email" value={formData.email} onChange={handleChange} />
                </div>
              </div>

              <h3 className="section-title">Datos ARCA (Facturacion Electronica)</h3>
              <div className="form-group">
                <label>Clave Fiscal ARCA</label>
                <div style={{ position: 'relative' }}>
                  <input
                    name="clave_fiscal"
                    type={showPassword ? 'text' : 'password'}
                    value={formData.clave_fiscal}
                    onChange={handleChange}
                    placeholder="Clave fiscal del cliente"
                    required
                    style={{ paddingRight: 40 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                      background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#666',
                      padding: '4px',
                    }}
                    tabIndex={-1}
                  >
                    {showPassword ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Cancelar</button>
                <button type="submit" className="btn-primary" disabled={submitting}>
                  {submitting ? 'Guardando...' : (editingId ? 'Guardar Cambios' : 'Crear Cliente')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Clients;
