import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Volna API base URL
const VOLNA_API_BASE = 'https://api.vollna.com/v1';

// Cache for Volna data
interface CacheEntry {
  data: any[];
  timestamp: number;
  filterId: string;
}

const volnaCache: Map<string, CacheEntry> = new Map();
const CACHE_TTL = 60000; // Cache for 60 seconds

// Get cached data or fetch fresh
async function getCachedOrFetch(apiKey: string, filterId: string): Promise<any[]> {
  const cacheKey = filterId;
  const cached = volnaCache.get(cacheKey);
  
  // Return cached data if still valid
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  // Fetch fresh data (no pagination params - Volna returns all by default)
  const response = await axios.get(
    `${VOLNA_API_BASE}/filters/${filterId}/projects`,
    {
      headers: {
        'X-API-TOKEN': apiKey,
        'Content-Type': 'application/json'
      },
      timeout: 60000
    }
  );
  
  // Debug: log first project to see field names and sample data
  if (response.data.data && response.data.data.length > 0) {
    const sample = response.data.data[0];
    console.log('Volna API sample project fields:', Object.keys(sample));
    console.log('Volna API sample project data:', JSON.stringify(sample, null, 2));
  }
  
  const data = response.data.data || [];
  
  // Cache the result
  volnaCache.set(cacheKey, {
    data,
    timestamp: Date.now(),
    filterId
  });
  
  return data;
}

// Get Volna API configuration from settings
async function getVolnaConfig(prisma: PrismaClient) {
  const settings = await prisma.settings.findMany({
    where: {
      key: {
        in: [
          'volna_api_key',
          'volna_filter_id_1',
          'volna_filter_id_2',
          'volna_filter_id_3',
          'volna_filter_id_4',
          'volna_auto_fetch',
          'volna_fetch_interval',
          'volna_auto_add'
        ]
      }
    }
  });
  
  const getVal = (key: string) => settings.find(s => s.key === key)?.value || '';
  
  // Get all non-empty filter IDs
  const filterIds = [
    getVal('volna_filter_id_1'),
    getVal('volna_filter_id_2'),
    getVal('volna_filter_id_3'),
    getVal('volna_filter_id_4')
  ].filter(id => id.trim() !== '');
  
  return {
    apiKey: getVal('volna_api_key'),
    filterIds,
    autoFetch: getVal('volna_auto_fetch') === 'true',
    fetchInterval: parseInt(getVal('volna_fetch_interval')) || 5,
    autoAdd: getVal('volna_auto_add') === 'true'
  };
}

// Check if maintenance mode is enabled
async function isMaintenanceMode(prisma: PrismaClient): Promise<boolean> {
  const setting = await prisma.settings.findUnique({
    where: { key: 'maintenance_mode' }
  });
  return setting?.value === 'true';
}

// Fetch projects from all Volna filters
// GET /filters/{id}/projects
router.get('/jobs', authenticateToken, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  
  try {
    // Check maintenance mode
    if (await isMaintenanceMode(prisma)) {
      return res.status(503).json({ 
        error: 'Maintenance mode is enabled. Data fetching is paused.' 
      });
    }
    
    const config = await getVolnaConfig(prisma);
    
    if (!config.apiKey) {
      return res.status(400).json({ 
        error: 'Volna API Token is not configured. Please set it in Settings.' 
      });
    }
    
    if (config.filterIds.length === 0) {
      return res.status(400).json({ 
        error: 'No Volna Filter IDs configured. Please set at least one in Settings.' 
      });
    }
    
    // Fetch projects from all configured filters (using cache)
    const allProjects: any[] = [];
    const seenUrls = new Set<string>();
    
    // Fetch all filters in parallel
    const fetchPromises = config.filterIds.map(async (filterId) => {
      try {
        const rawProjects = await getCachedOrFetch(config.apiKey, filterId);
        
        // Transform projects using Volna API field names (from docs)
        return rawProjects.map((project: any) => ({
          filter_id: filterId,
          title: project.title,
          description: project.description,
          skills: project.skills,
          url: project.url,
          published_at: project.publishedAt, // camelCase per Volna API
          budget_type: project.budget?.type,
          budget_amount: project.budget?.amount,
          client_country: project.clientDetails?.country, // Country only - city not available from Volna
          client_total_spent: project.clientDetails?.totalSpent,
          client_total_hires: project.clientDetails?.totalHires,
          client_hire_rate: project.clientDetails?.hireRate,
          client_rating: project.clientDetails?.rating,
          client_reviews: project.clientDetails?.reviews,
          client_verified: project.clientDetails?.paymentMethodVerified
        }));
      } catch (filterError: any) {
        console.error(`Failed to fetch from filter ${filterId}:`, filterError.message);
        return [];
      }
    });
    
    // Wait for all fetches to complete
    const results = await Promise.all(fetchPromises);
    
    // Deduplicate projects
    for (const projects of results) {
      for (const project of projects) {
        if (project.url && !seenUrls.has(project.url)) {
          seenUrls.add(project.url);
          allProjects.push(project);
        }
      }
    }
    
    // Sort by published date (newest first)
    allProjects.sort((a, b) => {
      const dateA = new Date(a.published_at || 0).getTime();
      const dateB = new Date(b.published_at || 0).getTime();
      return dateB - dateA;
    });
    
    res.json(allProjects);
  } catch (error: any) {
    console.error('Volna API error:', error.message);
    
    if (error.response) {
      return res.status(error.response.status).json({ 
        error: `Volna API error: ${error.response.data?.error || error.message}` 
      });
    }
    
    res.status(500).json({ error: 'Failed to fetch projects from Volna' });
  }
});

// Test Volna connection
router.get('/test', authenticateToken, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  
  try {
    const config = await getVolnaConfig(prisma);
    
    if (!config.apiKey || config.filterIds.length === 0) {
      return res.json({ 
        connected: false, 
        message: 'Volna API is not fully configured' 
      });
    }
    
    // Test connection with first filter (no pagination params)
    const response = await axios.get(
      `${VOLNA_API_BASE}/filters/${config.filterIds[0]}/projects`,
      {
        headers: {
          'X-API-TOKEN': config.apiKey,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );
    
    if (response.data.data) {
      const projectCount = response.data.data.length || 0;
      res.json({ 
        connected: true, 
        message: `Connected to ${config.filterIds.length} filter(s)`,
        filters: config.filterIds,
        total_projects: projectCount
      });
    } else {
      res.json({
        connected: false,
        message: 'API responded but filter may be invalid'
      });
    }
  } catch (error: any) {
    const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message;
    res.json({ 
      connected: false, 
      message: errorMsg
    });
  }
});

// Get Volna config (for frontend auto-fetch)
router.get('/config', authenticateToken, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  
  try {
    const config = await getVolnaConfig(prisma);
    
    res.json({
      configured: config.apiKey !== '' && config.filterIds.length > 0,
      filterCount: config.filterIds.length,
      filterIds: config.filterIds,
      autoFetch: config.autoFetch,
      fetchInterval: config.fetchInterval,
      autoAdd: config.autoAdd
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to get config' });
  }
});

// Get stats based on jobs saved in the database (not from Volna API)
router.get('/stats', authenticateToken, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  
  try {
    const config = await getVolnaConfig(prisma);
    
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Yesterday (previous calendar day in UTC)
    const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
    const yesterdayEnd = new Date(todayStart.getTime() - 1); // End of yesterday (23:59:59.999)
    
    // Get job counts from database based on createdAt
    const [totalJobs, lastHourJobs, yesterdayJobs, todayJobs] = await Promise.all([
      prisma.job.count(),
      prisma.job.count({
        where: {
          createdAt: { gte: oneHourAgo }
        }
      }),
      prisma.job.count({
        where: {
          createdAt: { gte: yesterdayStart, lt: todayStart }
        }
      }),
      prisma.job.count({
        where: {
          createdAt: { gte: todayStart }
        }
      })
    ]);
    
    // Get job counts by status
    const [queuedJobs, processingJobs, completedJobs, failedJobs] = await Promise.all([
      prisma.job.count({ where: { status: 'queued' } }),
      prisma.job.count({ where: { status: 'processing' } }),
      prisma.job.count({ where: { status: 'completed' } }),
      prisma.job.count({ where: { status: 'failed' } })
    ]);
    
    // Get jobs processed by Upwork API yesterday (by processedAt)
    const processedJobsYesterday = await prisma.job.findMany({
      where: {
        status: 'completed',
        processedAt: { gte: yesterdayStart, lt: todayStart }
      },
      select: { processedAt: true, createdAt: true, result: true }
    });
    
    // Get jobs processed today (for comparison)
    const processedJobsToday = await prisma.job.findMany({
      where: {
        status: 'completed',
        processedAt: { gte: todayStart }
      },
      select: { processedAt: true, createdAt: true, result: true }
    });
    
    // Group yesterday's processed jobs by UTC hour
    const hourlyProcessedYesterday: Record<number, number> = {};
    for (let i = 0; i < 24; i++) {
      hourlyProcessedYesterday[i] = 0;
    }
    
    // Group today's processed jobs by UTC hour
    const hourlyProcessedToday: Record<number, number> = {};
    for (let i = 0; i < 24; i++) {
      hourlyProcessedToday[i] = 0;
    }
    
    // Calculate average processing time and country stats from ALL completed jobs
    let totalProcessingTime = 0;
    let processedWithTime = 0;
    const countryStats: Record<string, number> = {};
    
    // Process yesterday's jobs
    processedJobsYesterday.forEach(job => {
      if (job.processedAt) {
        const hour = job.processedAt.getUTCHours();
        hourlyProcessedYesterday[hour]++;
        
        // Calculate processing time
        if (job.createdAt) {
          const processingTime = job.processedAt.getTime() - job.createdAt.getTime();
          totalProcessingTime += processingTime;
          processedWithTime++;
        }
        
        // Count by country
        const result = job.result as any;
        if (result && result.client_country) {
          const country = result.client_country;
          countryStats[country] = (countryStats[country] || 0) + 1;
        }
      }
    });
    
    // Process today's jobs
    processedJobsToday.forEach(job => {
      if (job.processedAt) {
        const hour = job.processedAt.getUTCHours();
        hourlyProcessedToday[hour]++;
        
        // Calculate processing time
        if (job.createdAt) {
          const processingTime = job.processedAt.getTime() - job.createdAt.getTime();
          totalProcessingTime += processingTime;
          processedWithTime++;
        }
        
        // Count by country
        const result = job.result as any;
        if (result && result.client_country) {
          const country = result.client_country;
          countryStats[country] = (countryStats[country] || 0) + 1;
        }
      }
    });
    
    // Calculate success rate
    const successRate = (completedJobs + failedJobs) > 0 
      ? Math.round((completedJobs / (completedJobs + failedJobs)) * 100) 
      : 0;
    
    // Calculate average processing time in minutes
    const avgProcessingTime = processedWithTime > 0 
      ? Math.round((totalProcessingTime / processedWithTime) / 60000) 
      : 0;
    
    // Get top 5 countries
    const topCountries = Object.entries(countryStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([country, count]) => ({ country, count }));
    
    // Get LeadHack stats
    const [leadhackPending, leadhackSent, leadhackFailed] = await Promise.all([
      prisma.job.count({ where: { leadhackStatus: 'pending' } }),
      prisma.job.count({ where: { leadhackStatus: 'sent' } }),
      prisma.job.count({ where: { leadhackStatus: 'failed' } })
    ]);
    
    // Get next LeadHack send time
    const nextLeadhackJob = await prisma.job.findFirst({
      where: { leadhackStatus: 'pending', status: 'completed' },
      orderBy: { leadhackSendAt: 'asc' },
      select: { leadhackSendAt: true }
    });
    
    // Get API call stats for yesterday
    const [apiUpworkYesterday, apiVolnaYesterday, apiLeadhackYesterday, apiUpworkFailedYesterday, apiVolnaFailedYesterday, apiLeadhackFailedYesterday] = await Promise.all([
      prisma.apiCallLog.count({ where: { apiType: 'upwork', createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.apiCallLog.count({ where: { apiType: 'volna', createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.apiCallLog.count({ where: { apiType: 'leadhack', createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.apiCallLog.count({ where: { apiType: 'upwork', success: false, createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.apiCallLog.count({ where: { apiType: 'volna', success: false, createdAt: { gte: yesterdayStart, lt: todayStart } } }),
      prisma.apiCallLog.count({ where: { apiType: 'leadhack', success: false, createdAt: { gte: yesterdayStart, lt: todayStart } } })
    ]);
    
    // Get API call stats for today
    const [apiUpworkToday, apiVolnaToday, apiLeadhackToday, apiUpworkFailedToday, apiVolnaFailedToday, apiLeadhackFailedToday] = await Promise.all([
      prisma.apiCallLog.count({ where: { apiType: 'upwork', createdAt: { gte: todayStart } } }),
      prisma.apiCallLog.count({ where: { apiType: 'volna', createdAt: { gte: todayStart } } }),
      prisma.apiCallLog.count({ where: { apiType: 'leadhack', createdAt: { gte: todayStart } } }),
      prisma.apiCallLog.count({ where: { apiType: 'upwork', success: false, createdAt: { gte: todayStart } } }),
      prisma.apiCallLog.count({ where: { apiType: 'volna', success: false, createdAt: { gte: todayStart } } }),
      prisma.apiCallLog.count({ where: { apiType: 'leadhack', success: false, createdAt: { gte: todayStart } } })
    ]);
    
    // Get per-filter stats from database
    const perFilterStats: Record<string, { total: number; yesterday: number; today: number; completed: number }> = {};
    
    // Initialize stats for all configured filters
    for (const filterId of config.filterIds) {
      perFilterStats[filterId] = { total: 0, yesterday: 0, today: 0, completed: 0 };
    }
    
    // Get all jobs with sourceFilterId
    const jobsWithFilter = await prisma.job.findMany({
      where: {
        sourceFilterId: { not: null }
      },
      select: {
        sourceFilterId: true,
        createdAt: true,
        status: true
      }
    });
    
    // Count per filter
    for (const job of jobsWithFilter) {
      const filterId = job.sourceFilterId!;
      if (!perFilterStats[filterId]) {
        perFilterStats[filterId] = { total: 0, yesterday: 0, today: 0, completed: 0 };
      }
      perFilterStats[filterId].total++;
      if (job.status === 'completed') {
        perFilterStats[filterId].completed++;
      }
      if (job.createdAt >= yesterdayStart && job.createdAt < todayStart) {
        perFilterStats[filterId].yesterday++;
      }
      if (job.createdAt >= todayStart) {
        perFilterStats[filterId].today++;
      }
    }
    
    // Count jobs without filter ID (legacy jobs)
    const jobsWithoutFilter = totalJobs - jobsWithFilter.length;
    
    // Build filter stats array for response
    const filterStats = config.filterIds.map(filterId => ({
      filterId,
      total: perFilterStats[filterId]?.total || 0,
      yesterday: perFilterStats[filterId]?.yesterday || 0,
      today: perFilterStats[filterId]?.today || 0,
      completed: perFilterStats[filterId]?.completed || 0,
      status: 'active'
    }));
    
    // Add "unknown" entry for legacy jobs without filter tracking
    if (jobsWithoutFilter > 0) {
      filterStats.push({
        filterId: 'unknown (legacy)',
        total: jobsWithoutFilter,
        yesterday: 0,
        today: 0,
        completed: 0,
        status: 'legacy'
      });
    }
    
    // Format dates for display
    const yesterdayDateStr = yesterdayStart.toISOString().split('T')[0];
    const todayDateStr = todayStart.toISOString().split('T')[0];
    
    res.json({ 
      filters: filterStats,
      perFilterStats,
      database: {
        total: totalJobs,
        lastHour: lastHourJobs,
        yesterday: yesterdayJobs,
        today: todayJobs,
        byStatus: {
          queued: queuedJobs,
          processing: processingJobs,
          completed: completedJobs,
          failed: failedJobs
        },
        successRate,
        avgProcessingTimeMinutes: avgProcessingTime,
        topCountries
      },
      processed: {
        yesterday: processedJobsYesterday.length,
        today: processedJobsToday.length,
        byHourUTCYesterday: hourlyProcessedYesterday,
        byHourUTCToday: hourlyProcessedToday
      },
      leadhack: {
        pending: leadhackPending,
        sent: leadhackSent,
        failed: leadhackFailed,
        nextSendAt: nextLeadhackJob?.leadhackSendAt?.toISOString() || null
      },
      apiCalls: {
        yesterday: {
          upwork: { total: apiUpworkYesterday, failed: apiUpworkFailedYesterday },
          volna: { total: apiVolnaYesterday, failed: apiVolnaFailedYesterday },
          leadhack: { total: apiLeadhackYesterday, failed: apiLeadhackFailedYesterday }
        },
        today: {
          upwork: { total: apiUpworkToday, failed: apiUpworkFailedToday },
          volna: { total: apiVolnaToday, failed: apiVolnaFailedToday },
          leadhack: { total: apiLeadhackToday, failed: apiLeadhackFailedToday }
        }
      },
      filterIds: config.filterIds,
      timeRanges: {
        now: now.toISOString(),
        nowFormatted: now.toISOString().replace('T', ' ').substring(0, 19) + ' UTC',
        oneHourAgo: oneHourAgo.toISOString(),
        yesterdayStart: yesterdayStart.toISOString(),
        yesterdayDate: yesterdayDateStr,
        todayStart: todayStart.toISOString(),
        todayDate: todayDateStr
      }
    });
  } catch (error: any) {
    console.error('Volna stats error:', error.message);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// Debug endpoint - show raw dates from Volna
router.get('/debug-dates', authenticateToken, async (req: Request, res: Response) => {
  try {
    const config = await getVolnaConfig(req.app.get('prisma'));
    
    if (!config.apiKey || config.filterIds.length === 0) {
      return res.json({ error: 'No Volna config' });
    }
    
    const now = new Date();
    const results: any[] = [];
    
    for (const filterId of config.filterIds) {
      const projects = await getCachedOrFetch(config.apiKey, filterId);
      
      const dates = projects.map((p: any) => ({
        title: p.title?.substring(0, 50),
        published_at: p.published_at,
        url: p.url
      })).sort((a: any, b: any) => {
        const dateA = new Date(a.published_at || 0);
        const dateB = new Date(b.published_at || 0);
        return dateB.getTime() - dateA.getTime(); // Newest first
      });
      
      results.push({
        filterId,
        total: projects.length,
        serverTime: now.toISOString(),
        jobs: dates
      });
    }
    
    res.json(results);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
