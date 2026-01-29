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
  
  // Fetch fresh data
  const response = await axios.get(
    `${VOLNA_API_BASE}/filters/${filterId}/projects`,
    {
      headers: {
        'X-API-TOKEN': apiKey,
        'Content-Type': 'application/json'
      },
      params: {
        limit: 100
      },
      timeout: 60000
    }
  );
  
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
        
        // Transform projects
        return rawProjects.map((project: any) => ({
          filter_id: filterId,
          title: project.title,
          description: project.description,
          skills: project.skills,
          url: project.url,
          published_at: project.publishedAt,
          budget_type: project.budget?.type,
          budget_amount: project.budget?.amount,
          client_country: project.clientDetails?.country,
          client_total_spent: project.clientDetails?.totalSpent,
          client_total_hires: project.clientDetails?.totalHires,
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
    
    // Test connection with first filter
    const response = await axios.get(
      `${VOLNA_API_BASE}/filters/${config.filterIds[0]}/projects`,
      {
        headers: {
          'X-API-TOKEN': config.apiKey
        },
        params: {
          limit: 1
        },
        timeout: 10000
      }
    );
    
    if (response.data.data) {
      res.json({ 
        connected: true, 
        message: `Connected to ${config.filterIds.length} filter(s)`,
        filters: config.filterIds,
        total_projects: response.data.pagination?.total || 0
      });
    } else {
      res.json({
        connected: false,
        message: 'API responded but filter may be invalid'
      });
    }
  } catch (error: any) {
    res.json({ 
      connected: false, 
      message: error.response?.data?.error || error.message 
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

// Get stats for all filters (jobs in last 1hr and 24hr)
router.get('/stats', authenticateToken, async (req: Request, res: Response) => {
  const prisma: PrismaClient = req.app.get('prisma');
  
  try {
    const config = await getVolnaConfig(prisma);
    
    if (!config.apiKey || config.filterIds.length === 0) {
      return res.json({ filters: [] });
    }
    
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    // Fetch all filters in parallel using cache
    const statsPromises = config.filterIds.map(async (filterId) => {
      try {
        const projects = await getCachedOrFetch(config.apiKey, filterId);
        
        // Count jobs by time period
        let lastHour = 0;
        let last24Hours = 0;
        
        for (const project of projects) {
          // Volna API uses snake_case: published_at
          const publishedAtStr = project.published_at || project.publishedAt;
          if (publishedAtStr) {
            const publishedDate = new Date(publishedAtStr);
            if (publishedDate >= oneHourAgo) {
              lastHour++;
            }
            if (publishedDate >= twentyFourHoursAgo) {
              last24Hours++;
            }
          }
        }
        
        return {
          filterId,
          total: projects.length,
          lastHour,
          last24Hours,
          status: 'active'
        };
      } catch (filterError: any) {
        return {
          filterId,
          total: 0,
          lastHour: 0,
          last24Hours: 0,
          status: 'error',
          error: filterError.message
        };
      }
    });
    
    const filterStats = await Promise.all(statsPromises);
    
    // Include time ranges in response
    res.json({ 
      filters: filterStats,
      timeRanges: {
        now: now.toISOString(),
        oneHourAgo: oneHourAgo.toISOString(),
        twentyFourHoursAgo: twentyFourHoursAgo.toISOString()
      }
    });
  } catch (error: any) {
    console.error('Volna stats error:', error.message);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

export default router;
