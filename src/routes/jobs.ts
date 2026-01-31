import { Router, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { addJobToQueue } from '../services/jobQueue';
import { fetchJobDetails } from '../services/upworkClient';

const router = Router();

// Check if maintenance mode is enabled
async function isMaintenanceMode(prisma: PrismaClient): Promise<boolean> {
  const setting = await prisma.settings.findUnique({
    where: { key: 'maintenance_mode' }
  });
  return setting?.value === 'true';
}

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

// Test endpoint - fetch job details immediately without queue
router.post('/test', authMiddleware, async (req: AuthRequest, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  const { jobUrl } = req.body;
  
  if (!jobUrl) {
    return res.status(400).json({ error: 'Job URL required' });
  }
  
  // Validate URL format
  if (!jobUrl.includes('upwork.com/jobs/') && !jobUrl.includes('upwork.com/freelance-jobs/')) {
    return res.status(400).json({ error: 'Invalid Upwork job URL' });
  }
  
  try {
    // Check maintenance mode
    if (await isMaintenanceMode(prisma)) {
      return res.status(503).json({ 
        error: 'Maintenance mode is enabled. Data fetching is paused.' 
      });
    }
    
    // Check if user has Upwork connected
    const token = await prisma.upworkToken.findUnique({
      where: { userId: req.userId }
    });
    
    if (!token) {
      return res.status(400).json({ error: 'Please connect Upwork first' });
    }
    
    // Fetch job details directly
    const result = await fetchJobDetails(prisma, req.userId!, jobUrl);
    
    res.json(result);
  } catch (error: any) {
    console.error('Test fetch error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch job details' });
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
    
    // Return array directly for easier frontend handling
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get jobs' });
  }
});

// Get queue stats - MUST be before /:id
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
    
    // Get configurable max rate limit from settings
    const rateLimitSetting = await prisma.settings.findUnique({
      where: { key: 'upwork_rate_limit' }
    });
    const maxRateLimit = rateLimitSetting ? parseInt(rateLimitSetting.value) : 50;
    
    res.json({
      queued,
      processing,
      completed,
      failed,
      rateLimitUsed: rateLimit?.count || 0,
      rateLimitMax: maxRateLimit
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Get all job URLs in the system - MUST be before /:id
router.get('/urls', authMiddleware, async (req: AuthRequest, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  
  try {
    const jobs = await prisma.job.findMany({
      select: { jobUrl: true, status: true }
    });
    
    // Return as a map of URL -> status for easy lookup
    const urlMap: { [key: string]: string } = {};
    jobs.forEach(job => {
      urlMap[job.jobUrl] = job.status;
    });
    
    res.json(urlMap);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get job URLs' });
  }
});

// Remove a job by URL - MUST be before /:id
router.delete('/by-url', authMiddleware, async (req: AuthRequest, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  const { jobUrl } = req.body;
  
  if (!jobUrl) {
    return res.status(400).json({ error: 'Job URL required' });
  }
  
  try {
    // Find and delete the job
    const job = await prisma.job.findFirst({
      where: { jobUrl }
    });
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found in queue' });
    }
    
    // Don't allow removing jobs that are currently processing
    if (job.status === 'processing') {
      return res.status(400).json({ error: 'Cannot remove job that is currently processing' });
    }
    
    await prisma.job.delete({
      where: { id: job.id }
    });
    
    res.json({ 
      success: true, 
      message: `Job removed from ${job.status === 'queued' ? 'queue' : 'job data'}` 
    });
  } catch (error) {
    console.error('Remove job error:', error);
    res.status(500).json({ error: 'Failed to remove job' });
  }
});

// Get single job - MUST be LAST (wildcard route)
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

// Migrate legacy jobs (without sourceFilterId) to a specific filter
router.post('/migrate-filter', authMiddleware, async (req: AuthRequest, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  const { filterId } = req.body;
  
  if (!filterId) {
    return res.status(400).json({ error: 'filterId required' });
  }
  
  try {
    // Count jobs without sourceFilterId
    const countBefore = await prisma.job.count({
      where: { sourceFilterId: null }
    });
    
    // Update all jobs without sourceFilterId
    const result = await prisma.job.updateMany({
      where: { sourceFilterId: null },
      data: { sourceFilterId: filterId }
    });
    
    res.json({ 
      success: true, 
      message: `Updated ${result.count} jobs to filter #${filterId}`,
      updated: result.count
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to migrate: ' + error.message });
  }
});

export default router;
