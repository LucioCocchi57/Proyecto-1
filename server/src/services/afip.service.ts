const Afip = require('@afipsdk/afip.js');

const AFIP_ACCESS_TOKEN = process.env.AFIP_ACCESS_TOKEN || '';
const IS_PRODUCTION = process.env.AFIP_PRODUCTION === 'true';

// Cache a single Afip instance per CUIT (avoid multiple token requests)
const afipInstances = new Map<number, any>();

const getAfipInstance = (cuit: number, cert?: string, key?: string) => {
  const existing = afipInstances.get(cuit);
  if (existing) {
    if (cert && key) {
      existing.CERT = cert;
      existing.PRIVATEKEY = key;
    }
    return existing;
  }
  const options: any = {
    CUIT: cuit,
    production: IS_PRODUCTION,
    access_token: AFIP_ACCESS_TOKEN,
  };
  if (cert && key) {
    options.cert = cert;
    options.key = key;
  }
  const instance = new Afip(options);
  afipInstances.set(cuit, instance);
  return instance;
};

// Clear cached instance (e.g. when cert needs to be regenerated)
export const clearAfipInstance = (cuit: number) => {
  afipInstances.delete(cuit);
};

// Generate certificate for a client using their clave fiscal
export const generateCertificate = async (cuit: number, claveFiscal: string): Promise<{ cert: string; key: string }> => {
  const afip = getAfipInstance(cuit);
  const alias = `facturador${cuit}`;
  const cuitStr = String(cuit);

  let cert: string;
  let key: string;

  if (IS_PRODUCTION) {
    // Production: use CreateAutomation
    const data = { cuit: cuitStr, username: cuitStr, password: claveFiscal, alias };
    const result = await afip.CreateAutomation('create-cert-prod', data, true);
    cert = result.data.cert;
    key = result.data.key;
  } else {
    // Test: use CreateCert
    const result = await afip.CreateCert(cuitStr, claveFiscal, alias);
    cert = result.cert;
    key = result.key;
  }

  // Authorize web services needed
  const services = ['wsfe', 'ws_sr_constancia_inscripcion'];
  for (const ws of services) {
    try {
      await authorizeWebService(cuit, claveFiscal, ws);
    } catch {
      // May fail if already authorized — that's fine
    }
  }

  // Update the cached instance with the new cert
  afip.CERT = cert;
  afip.PRIVATEKEY = key;
  return { cert, key };
};

export const authorizeWebService = async (cuit: number, claveFiscal: string, wsid: string = 'wsfe'): Promise<void> => {
  const afip = getAfipInstance(cuit);
  const alias = `facturador${cuit}`;
  const cuitStr = String(cuit);

  try {
    if (IS_PRODUCTION) {
      const data = { cuit: cuitStr, username: cuitStr, password: claveFiscal, alias, service: wsid };
      await afip.CreateAutomation('auth-web-service-prod', data, true);
    } else {
      await afip.CreateWSAuth(cuitStr, claveFiscal, alias, wsid);
    }
  } catch (err: any) {
    const msg = err.data?.message || err.message || '';
    if (!msg.includes('alreadyAuthenticated') && !msg.includes('already')) {
      throw err;
    }
  }
};

// Ensure the client has a web-service-enabled punto de venta. Returns the PV number.
export const ensureWebServiceSalesPoint = async (
  cuit: number, claveFiscal: string, taxCondition: string, businessName: string, cert?: string, key?: string
): Promise<number> => {
  const afip = getAfipInstance(cuit, cert, key);

  // Check existing wsfe sales points
  try {
    const points = await afip.ElectronicBilling.getSalesPoints();
    if (points && points.length > 0) {
      const active = points.find((p: any) => p.Bloqueado !== 'S' && p.FchBaja === 'NULL');
      if (active) {
        console.log(`Client ${cuit} already has wsfe PV ${active.Nro}`);
        return active.Nro;
      }
    }
  } catch {
    // No sales points or wsfe not ready yet
  }

  // No wsfe PV found — create one
  // Pick system type based on tax condition
  const sistema = taxCondition === 'MONOTRIBUTISTA' ? 'MAW' : 'FEEWS';
  const cuitStr = String(cuit);

  // Find next available PV number (try 1-99)
  let pvNumber = 1;
  try {
    const allPoints = await afip.CreateAutomation('list-sales-points', {
      cuit: cuitStr, username: cuitStr, password: claveFiscal,
    }, true);
    const usedNumbers = (allPoints.data || []).map((p: any) => parseInt(p.number));
    while (usedNumbers.includes(pvNumber)) pvNumber++;
  } catch {
    pvNumber = 1;
  }

  console.log(`Creating wsfe PV ${pvNumber} (${sistema}) for CUIT ${cuit}...`);
  await afip.CreateAutomation('create-sales-point', {
    cuit: cuitStr,
    username: cuitStr,
    password: claveFiscal,
    numero: pvNumber,
    sistema,
    nombreFantasia: businessName || `PV ${pvNumber}`,
  }, true);

  // Authorize wsfe for the new cert if needed
  try {
    await authorizeWebService(cuit, claveFiscal, 'wsfe');
  } catch { /* already authorized */ }

  console.log(`Created wsfe PV ${pvNumber} for CUIT ${cuit}`);
  return pvNumber;
};

// AFIP IVA condition ID to our tax condition mapping
const IVA_ID_TO_TAX_CONDITION: Record<number, string> = {
  1: 'RESPONSABLE_INSCRIPTO',
  4: 'EXENTO',
  5: 'CONSUMIDOR_FINAL',
  6: 'MONOTRIBUTISTA',
};

export const lookupCuit = async (emisorCuit: number, targetCuit: number, cert?: string, key?: string): Promise<{
  name: string;
  tax_condition: string;
  address: string;
} | null> => {
  const afip = getAfipInstance(emisorCuit, cert, key);
  let details: any = null;
  let source = '';

  // Use RegisterInscriptionProof (ws_sr_constancia_inscripcion) — official documented method
  details = await afip.RegisterInscriptionProof.getTaxpayerDetails(targetCuit);
  source = 'constancia';

  if (!details) return null;

  // Log the full response for debugging
  const fs = require('fs');
  fs.writeFileSync('/tmp/afip-persona.log', JSON.stringify({ source, ...details }, null, 2));
  console.log('AFIP lookup source:', source, 'keys:', Object.keys(details));

  // Parse response — handle different response structures:
  // constancia/a5: { datosGenerales: {...}, datosRegimenGeneral: {...}, datosMonotributo: {...} }
  // constancia/a5 error: { errorConstancia: { apellido, nombre, idPersona, error } }
  // a10: { apellido, nombre, domicilio: [...], tipoClave, ... } (flat)

  const datosGenerales = details.datosGenerales;
  const errorConstancia = details.errorConstancia;

  let name = 'Desconocido';
  let address = '';
  let taxCondition = 'CONSUMIDOR_FINAL';

  if (datosGenerales) {
    // Full constancia/a5 response
    name = datosGenerales.razonSocial ||
      (datosGenerales.apellido && datosGenerales.nombre
        ? `${datosGenerales.apellido} ${datosGenerales.nombre}` : '') ||
      'Desconocido';

    // Address from datosGenerales.domicilioFiscal
    const dom = datosGenerales.domicilioFiscal;
    if (dom) {
      address = [dom.direccion, dom.localidad, dom.descripcionProvincia].filter(Boolean).join(', ');
    }

    // Tax condition from detailed fields
    if (details.datosMonotributo) {
      taxCondition = 'MONOTRIBUTISTA';
    } else if (details.datosRegimenGeneral?.impuesto) {
      const impList = Array.isArray(details.datosRegimenGeneral.impuesto)
        ? details.datosRegimenGeneral.impuesto
        : [details.datosRegimenGeneral.impuesto];
      const hasIva = impList.some((imp: any) => imp.idImpuesto === 30);
      if (hasIva) {
        taxCondition = 'RESPONSABLE_INSCRIPTO';
      } else {
        taxCondition = 'EXENTO';
      }
    }
  } else if (errorConstancia) {
    // Partial constancia response (has error but still has basic data)
    name = errorConstancia.razonSocial ||
      (errorConstancia.apellido && errorConstancia.nombre
        ? `${errorConstancia.apellido} ${errorConstancia.nombre}` : '') ||
      'Desconocido';
    // errorConstancia doesn't have full tax details, but may have some
    // Try to get what we can
    if (errorConstancia.datosMonotributo) {
      taxCondition = 'MONOTRIBUTISTA';
    }
  } else {
    // Flat a10 response
    name = details.razonSocial ||
      (details.apellido && details.nombre
        ? `${details.apellido} ${details.nombre}` : '') ||
      'Desconocido';

    // Address from array
    const domArr = details.domicilio;
    if (Array.isArray(domArr)) {
      const fiscal = domArr.find((d: any) => d.tipoDomicilio === 'FISCAL') || domArr[0];
      if (fiscal) {
        address = [fiscal.direccion, fiscal.localidad, fiscal.descripcionProvincia].filter(Boolean).join(', ');
      }
    } else if (domArr) {
      address = [domArr.direccion, domArr.localidad, domArr.descripcionProvincia].filter(Boolean).join(', ');
    }

    // a10 doesn't have tax details — use CUIT heuristic
    if (details.tipoClave === 'CUIT') {
      taxCondition = 'MONOTRIBUTISTA';
    }
  }

  return { name, tax_condition: taxCondition, address };
};

// Map invoice type letter to AFIP code
const INVOICE_TYPE_CODES: Record<string, number> = {
  'A': 1,
  'B': 6,
  'C': 11,
};

// Map IVA rates to AFIP codes
const IVA_RATE_CODES: Record<number, number> = {
  0: 3,
  10.5: 4,
  21: 5,
  27: 6,
};

const DOC_TYPE_CUIT = 80;
const DOC_TYPE_CONSUMIDOR_FINAL = 99;

// AFIP IVA condition codes for receptor
const IVA_CONDITION_CODES: Record<string, number> = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTISTA: 6,
};

interface EmitInvoiceParams {
  emisorCuit: number;
  emisorCert?: string;
  emisorKey?: string;
  type: 'A' | 'B' | 'C';
  puntoDeVenta: number;
  receptorCuit: string;
  receptorTaxCondition: string;
  date: string;
  items: Array<{
    description: string;
    quantity: number;
    unit_price: number;
    iva_rate: number;
    subtotal: number;
  }>;
  subtotal: number;
  taxTotal: number;
  total: number;
}

export const emitElectronicInvoice = async (params: EmitInvoiceParams) => {
  const afip = getAfipInstance(params.emisorCuit, params.emisorCert, params.emisorKey);

  const tipoComprobante = INVOICE_TYPE_CODES[params.type];
  if (!tipoComprobante) {
    throw new Error(`Tipo de comprobante inválido: ${params.type}`);
  }

  // Get next invoice number
  const lastNumber = await afip.ElectronicBilling.getLastVoucher(params.puntoDeVenta, tipoComprobante);
  const nextNumber = lastNumber + 1;

  const fechaComprobante = params.date.split('T')[0].replace(/-/g, '');

  let docTipo = DOC_TYPE_CUIT;
  let docNro = parseInt(params.receptorCuit.replace(/-/g, ''));

  if (params.type === 'B' && params.receptorTaxCondition === 'CONSUMIDOR_FINAL') {
    docTipo = DOC_TYPE_CONSUMIDOR_FINAL;
    docNro = 0;
  }
  if (params.type === 'C') {
    // Factura C (monotributista) — receptor can be consumidor final
    if (params.receptorTaxCondition === 'CONSUMIDOR_FINAL') {
      docTipo = DOC_TYPE_CONSUMIDOR_FINAL;
      docNro = 0;
    }
  }

  // Build IVA array grouped by rate (only for Factura A/B)
  const ivaMap = new Map<number, { baseImp: number; importe: number }>();
  if (params.type !== 'C') {
    for (const item of params.items) {
      const rate = item.iva_rate;
      if (rate === 0) continue;
      const existing = ivaMap.get(rate) || { baseImp: 0, importe: 0 };
      existing.baseImp += item.subtotal;
      existing.importe += item.subtotal * (rate / 100);
      ivaMap.set(rate, existing);
    }
  }

  const ivaArray = Array.from(ivaMap.entries()).map(([rate, values]) => ({
    Id: IVA_RATE_CODES[rate] || 5,
    BaseImp: Math.round(values.baseImp * 100) / 100,
    Importe: Math.round(values.importe * 100) / 100,
  }));

  const voucherData: any = {
    CantReg: 1,
    PtoVta: params.puntoDeVenta,
    CbteTipo: tipoComprobante,
    Concepto: 1,
    DocTipo: docTipo,
    DocNro: docNro,
    CbteDesde: nextNumber,
    CbteHasta: nextNumber,
    CbteFch: fechaComprobante,
    ImpTotal: Math.round(params.total * 100) / 100,
    ImpTotConc: 0,
    ImpNeto: Math.round(params.subtotal * 100) / 100,
    ImpOpEx: 0,
    ImpIVA: params.type === 'C' ? 0 : Math.round(params.taxTotal * 100) / 100,
    ImpTrib: 0,
    MonId: 'PES',
    MonCotiz: 1,
    CondicionIVAReceptorId: IVA_CONDITION_CODES[params.receptorTaxCondition] || 5,
  };

  if (ivaArray.length > 0) {
    voucherData.Iva = ivaArray;
  }

  const response = await afip.ElectronicBilling.createVoucher(voucherData);

  return {
    cae: response.CAE,
    caeExpiration: response.CAEFchVto,
    invoiceNumber: nextNumber,
    puntoDeVenta: params.puntoDeVenta,
  };
};

export const getServerStatus = async () => {
  const afip = getAfipInstance(20438045083);
  const status = await afip.ElectronicBilling.getServerStatus();
  return status;
};

export const getLastInvoiceNumber = async (cuit: number, puntoDeVenta: number, tipoComprobante: number, cert?: string, key?: string): Promise<number> => {
  const afip = getAfipInstance(cuit, cert, key);
  try {
    const lastVoucher = await afip.ElectronicBilling.getLastVoucher(puntoDeVenta, tipoComprobante);
    return lastVoucher;
  } catch (e: any) {
    const msg = e.message || '';
    if (msg.includes('11002') || msg.includes('no se encuentra habilitado')) {
      // PV not enabled for wsfe — try Mis Comprobantes automation
      console.log(`PV ${puntoDeVenta} not wsfe-enabled, trying Mis Comprobantes...`);
      return -1; // Signal caller to use automation
    }
    throw e;
  }
};

// Get last invoice number via Mis Comprobantes (for non-wsfe puntos de venta)
export const getLastInvoiceNumberFromMisComprobantes = async (
  cuit: number, claveFiscal: string, puntoDeVenta: number, tipoComprobante: string
): Promise<number> => {
  const afip = getAfipInstance(cuit);
  const cuitStr = String(cuit);

  // Map type code to AFIP comprobante type name
  const TIPO_NAMES: Record<string, string> = {
    'C': 'Factura C',
    'A': 'Factura A',
    'B': 'Factura B',
  };

  // Query recent invoices for this PV
  const today = new Date();
  const yearAgo = new Date(today.getFullYear() - 1, today.getMonth(), today.getDate());
  const formatDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

  const response = await afip.CreateAutomation('mis-comprobantes', {
    cuit: cuitStr,
    username: cuitStr,
    password: claveFiscal,
    filters: {
      t: 'E',
      fechaEmision: `${formatDate(yearAgo)} - ${formatDate(today)}`,
      puntosVenta: String(puntoDeVenta),
    },
  }, true);

  const comprobantes = response.data || [];
  console.log(`Mis Comprobantes returned ${comprobantes.length} results for PV ${puntoDeVenta}`);

  // Find the highest number for the given invoice type
  let maxNumber = 0;
  const tipoName = TIPO_NAMES[tipoComprobante] || tipoComprobante;
  for (const c of comprobantes) {
    const tipo = c['Tipo'] || c['tipoComprobante'] || '';
    if (tipo.includes(tipoName) || tipo === tipoName) {
      const hasta = parseInt(c['Número Hasta'] || c['Hasta'] || c['numero'] || '0');
      if (hasta > maxNumber) maxNumber = hasta;
    }
  }

  return maxNumber;
};

// Get web-service-enabled sales points (fast, via wsfe)
export const getSalesPoints = async (cuit: number, cert?: string, key?: string): Promise<any[]> => {
  const afip = getAfipInstance(cuit, cert, key);
  try {
    const points = await afip.ElectronicBilling.getSalesPoints();
    return (points || []).map((p: any) => ({
      number: p.Nro,
      system: p.EmisionTipo,
      blocked: p.Bloqueado === 'S',
      deactivated: p.FchBaja !== 'NULL',
    }));
  } catch {
    return [];
  }
};
