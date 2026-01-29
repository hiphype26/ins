import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { addJobToQueue } from '../services/jobQueue';

const router = Router();

// Submit a job URL
router.post('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  const { jobUrl } = req.body;
  
  if (!jobUrl) {
    return res.status(400).json({ error: 'Job URL required' });
  }
  
  // Validate URL format
  if (!jobUrl.includes('upwork.com/jobs/') && !jobUrl.includes('upwork.com/freelance-jobs/')) {
    return res.status(400).json({ error: 'Invalid Upwork job URL' });
  }
  
  // Extract job ID from URL
  const jobIdMatch = jobUrl.match(/~([a-zA-Z0-9]+)/);
  const jobId = jobIdMatch ? `~${jobIdMatch[1]}` : null;
  
  try {
    // Check if user has Upwork connected
    const token = await prisma.upworkToken.findUnique({
      where: { userId: req.userId }
    });
    
    if (!token) {
      return res.status(400).json({ error: 'Please connect Upwork first' });
    }
    
    // Create job record
    const job = await prisma.job.create({
      data: {
        userId: req.userId!,
        jobUrl,
        jobId,
        status: 'queued'
      }
    });
    
    // Add to queue
    await addJobToQueue(job.id);
    
    // Get queue position
    const queuePosition = await prisma.job.count({
      where: {
        status: 'queued',
        createdAt: { lte: job.createdAt }
      }
    });
    
    res.json({
      success: true,
      job: {
        id: job.id,
        jobUrl: job.jobUrl,
        status: job.status,
        queuePosition
      }
    });
  } catch (error) {
    console.error('Submit job error:', error);
    res.status(500).json({ error: 'Failed to submit job' });
  }
});

// Get all jobs for user
router.get('/', authMiddleware, async (req: AuthRequest, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  
  try {
    const jobs = await prisma.job.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    
    res.json({ jobs });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get jobs' });
  }
});

// Get single job
router.get('/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  const { id } = req.params;
  
  try {
    const job = await prisma.job.findFirst({
      where: { id, userId: req.userId }
    });
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    res.json({ job });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get job' });
  }
});

// Get queue stats
router.get('/stats/queue', authMiddleware, async (req: AuthRequest, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  
  try {
    const [queued, processing, completed, failed] = await Promise.all([
      prisma.job.count({ where: { status: 'queued' } }),
      prisma.job.count({ where: { status: 'processing' } }),
      prisma.job.count({ where: { status: 'completed' } }),
      prisma.job.count({ where: { status: 'failed' } })
    ]);
    
    // Get rate limit for current hour
    const currentHour = new Date().toISOString().slice(0, 13);
    const rateLimit = await prisma.rateLimit.findUnique({
      where: { hour: currentHour }
    });
    
    res.json({
      queued,
      processing,
      completed,
      failed,
      rateLimitUsed: rateLimit?.count || 0,
      rateLimitMax: 50
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export default router;
