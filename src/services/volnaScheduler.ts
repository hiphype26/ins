import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const VOLNA_API_BASE = 'https://api.vollna.com/v1';

let isRunning = false;
let prismaInstance: PrismaClient;
let fetchTimeoutId: NodeJS.Timeout | null = null;

// Simple cache for scheduler
const schedulerCache: Map<string, { data: any[], timestamp: number }> = new Map();
const CACHE_TTL = 60000; // 60 seconds

// Get Volna configuration from settings
async function getVolnaConfig() {
  const settings = await prismaInstance.settings.findMany({
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
          'volna_auto_add',
          'maintenance_mode'
        ]
      }
    }
  });
  
  const getVal = (key: string) => settings.find(s => s.key === key)?.value || '';
  
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
    autoAdd: getVal('volna_auto_add') === 'true',
    maintenanceMode: getVal('maintenance_mode') === 'true'
  };
}

// Fetch projects from a single filter (with caching)
async function fetchFromFilter(apiKey: string, filterId: string): Promise<any[]> {
  // Check cache first
  const cached = schedulerCache.get(filterId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  try {
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
    schedulerCache.set(filterId, { data, timestamp: Date.now() });
    
    return data;
  } catch (error: any) {
    console.error(`Volna: Failed to fetch from filter ${filterId}:`, error.message);
    return [];
  }
}

// Add a job URL to the queue (if not already exists)
async function addJobToQueue(userId: string, jobUrl: string): Promise<boolean> {
  try {
    // Check if job already exists
    const existing = await prismaInstance.job.findFirst({
      where: { jobUrl }
    });
    
    if (existing) {
      return false; // Already in queue
    }
    
    // Extract job ID from URL
    const jobIdMatch = jobUrl.match(/~([a-zA-Z0-9]+)/);
    const jobId = jobIdMatch ? `~${jobIdMatch[1]}` : null;
    
    // Create job record
    await prismaInstance.job.create({
      data: {
        userId,
        jobUrl,
        jobId,
        status: 'queued'
      }
    });
    
    return true;
  } catch (error) {
    console.error('Volna: Failed to add job to queue:', error);
    return false;
  }
}

// Get a user ID for auto-adding jobs (uses first user with Upwork connected)
async function getAutoAddUserId(): Promise<string | null> {
  const token = await prismaInstance.upworkToken.findFirst();
  return token?.userId || null;
}

// Main fetch cycle
async function runFetchCycle(): Promise<void> {
  if (!isRunning) return;
  
  try {
    const config = await getVolnaConfig();
    
    // Check if auto-fetch is enabled and not in maintenance mode
    if (!config.autoFetch || config.maintenanceMode) {
      schedulNextFetch(config.fetchInterval);
      return;
    }
    
    // Check if configured
    if (!config.apiKey || config.filterIds.length === 0) {
      schedulNextFetch(config.fetchInterval);
      return;
    }
    
    // Fetch from all filters
    const allProjects: any[] = [];
    const seenUrls = new Set<string>();
    
    for (const filterId of config.filterIds) {
      const projects = await fetchFromFilter(config.apiKey, filterId);
      
      for (const project of projects) {
        if (project.url && !seenUrls.has(project.url)) {
          seenUrls.add(project.url);
          allProjects.push(project);
        }
      }
    }
    
    // Auto-add to queue if enabled
    if (config.autoAdd && allProjects.length > 0) {
      const userId = await getAutoAddUserId();
      
      if (userId) {
        let addedCount = 0;
        
        for (const project of allProjects) {
          if (project.url) {
            const added = await addJobToQueue(userId, project.url);
            if (added) addedCount++;
          }
        }
        
        // Only log when jobs are actually added
        if (addedCount > 0) {
          console.log(`Volna: Added ${addedCount} new jobs to queue`);
        }
      }
    }
    
  } catch (error) {
    console.error('Volna auto-fetch error:', error);
  }
  
  // Schedule next fetch
  const config = await getVolnaConfig();
  schedulNextFetch(config.fetchInterval);
}

// Schedule the next fetch
function schedulNextFetch(intervalMinutes: number): void {
  if (!isRunning) return;
  
  const intervalMs = intervalMinutes * 60 * 1000;
  fetchTimeoutId = setTimeout(runFetchCycle, intervalMs);
}

// Start the Volna scheduler
export function startVolnaScheduler(prisma: PrismaClient): void {
  prismaInstance = prisma;
  isRunning = true;
  
  console.log('Volna scheduler started');
  
  // Run first fetch after 30 seconds (to let the app initialize)
  setTimeout(runFetchCycle, 30000);
}

// Stop the Volna scheduler
export function stopVolnaScheduler(): void {
  isRunning = false;
  
  if (fetchTimeoutId) {
    clearTimeout(fetchTimeoutId);
    fetchTimeoutId = null;
  }
  
  console.log('Volna scheduler stopped');
}
