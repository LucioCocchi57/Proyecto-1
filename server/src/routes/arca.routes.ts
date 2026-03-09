import { Router } from 'express';
import { getArcaStatus, getNextInvoiceNumber, emitInvoice, setupClient, lookupCuitInfo, getClientSalesPoints } from '../controllers/arca.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/status', getArcaStatus);
router.get('/next-number', getNextInvoiceNumber);
router.get('/lookup-cuit', lookupCuitInfo);
router.get('/sales-points', getClientSalesPoints);
router.post('/setup/:clientId', setupClient);
router.post('/emit/:invoiceId', emitInvoice);

export default router;
