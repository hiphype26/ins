import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { getApiStats, getHourlyStats, getDailyStats } from '../services/apiLogger';

const router = Router();

// All stats routes require authentication
router.use(authMiddleware);

// Get API stats summary
router.get('/summary', async (req: AuthRequest, res: Response) => {
  try {
    const { range } = req.query;
    
    const endDate = new Date();
    const startDate = new Date();
    
    // Default to today
    switch (range) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default: // today
        startDate.setUTCHours(0, 0, 0, 0);
    }
    
    const stats = await getApiStats(startDate, endDate);
    
    res.json({
      range: range || 'today',
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      ...stats
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get hourly breakdown (for peak hours)
router.get('/hourly', async (req: AuthRequest, res: Response) => {
  try {
    const { range } = req.query;
    
    const endDate = new Date();
    const startDate = new Date();
    
    switch (range) {
      case 'week':
        startDate.setDate(startDate.getDate() - 7);
        break;
      case 'month':
        startDate.setDate(startDate.getDate() - 30);
        break;
      default: // today
        startDate.setUTCHours(0, 0, 0, 0);
    }
    
    const stats = await getHourlyStats(startDate, endDate);
    
    res.json({
      range: range || 'today',
      ...stats
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get daily breakdown
router.get('/daily', async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const stats = await getDailyStats(Math.min(days, 30)); // Max 30 days
    
    res.json({
      days,
      daily: stats
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get stats for a specific time range
router.get('/range', async (req: AuthRequest, res: Response) => {
  try {
    const { start, end } = req.query;
    
    if (!start || !end) {
      return res.status(400).json({ error: 'start and end query params required (ISO format)' });
    }
    
    const startDate = new Date(start as string);
    const endDate = new Date(end as string);
    
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    const stats = await getApiStats(startDate, endDate);
    const hourly = await getHourlyStats(startDate, endDate);
    
    res.json({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
      ...stats,
      hourly: hourly.hourly,
      peakHour: hourly.peakHour,
      peakCount: hourly.peakCount
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
