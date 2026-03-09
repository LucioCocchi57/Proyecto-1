import { Router } from 'express';
import { getCompany, upsertCompany } from '../controllers/company.controller';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use(authMiddleware);

router.get('/', getCompany);
router.put('/', upsertCompany);

export default router;
