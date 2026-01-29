import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Get all settings
router.get('/', authenticateToken, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  
  try {
    const settings = await prisma.settings.findMany();
    res.json(settings);
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Get a specific setting
router.get('/:key', authenticateToken, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  const { key } = req.params;
  
  try {
    const setting = await prisma.settings.findUnique({
      where: { key }
    });
    
    if (!setting) {
      return res.status(404).json({ error: 'Setting not found' });
    }
    
    res.json(setting);
  } catch (error) {
    console.error('Get setting error:', error);
    res.status(500).json({ error: 'Failed to fetch setting' });
  }
});

// Create or update a setting
router.post('/', authenticateToken, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  const { key, value } = req.body;
  
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'Key and value are required' });
  }
  
  try {
    const setting = await prisma.settings.upsert({
      where: { key },
      update: { value: String(value) },
      create: { key, value: String(value) }
    });
    
    res.json(setting);
  } catch (error) {
    console.error('Save setting error:', error);
    res.status(500).json({ error: 'Failed to save setting' });
  }
});

// Bulk update settings
router.post('/bulk', authenticateToken, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  const { settings } = req.body;
  
  if (!settings || !Array.isArray(settings)) {
    return res.status(400).json({ error: 'Settings array is required' });
  }
  
  try {
    const results = await Promise.all(
      settings.map(({ key, value }: { key: string; value: string }) =>
        prisma.settings.upsert({
          where: { key },
          update: { value: String(value) },
          create: { key, value: String(value) }
        })
      )
    );
    
    res.json(results);
  } catch (error) {
    console.error('Bulk save settings error:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

// Delete a setting
router.delete('/:key', authenticateToken, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  const { key } = req.params;
  
  try {
    await prisma.settings.delete({
      where: { key }
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Delete setting error:', error);
    res.status(500).json({ error: 'Failed to delete setting' });
  }
});

export default router;
