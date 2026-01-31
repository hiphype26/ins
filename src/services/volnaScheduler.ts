import { PrismaClient } from '@prisma/client';
import axios from 'axios';
import { logApiCall } from './apiLogger';

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
          'maintenance_mode',
          'volna_stopped',
          'working_hours_enabled',
          'working_hours_start',
          'working_hours_end',
          'working_days'
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
    maintenanceMode: getVal('maintenance_mode') === 'true',
    volnaStopped: getVal('volna_stopped') === 'true',
    workingHoursEnabled: getVal('working_hours_enabled') === 'true',
    workingHoursStart: getVal('working_hours_start') || '09:00',
    workingHoursEnd: getVal('working_hours_end') || '18:00',
    workingDays: getVal('working_days') || '1,2,3,4,5'
  };
}

// Check if current time is within working hours
function isWithinWorkingHours(config: any): boolean {
  if (!config.workingHoursEnabled) {
    return true;
  }
  
  const workingDays = config.workingDays.split(',').map((d: string) => parseInt(d));
  
  const now = new Date();
  const currentDay = now.getDay();
  
  // Check if today is a working day
  if (!workingDays.includes(currentDay)) {
    return false;
  }
  
  // Check if current time is within working hours
  const currentTime = now.getHours() * 60 + now.getMinutes();
  const [startHour, startMin] = config.workingHoursStart.split(':').map((n: string) => parseInt(n));
  const [endHour, endMin] = config.workingHoursEnd.split(':').map((n: string) => parseInt(n));
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  // Handle overnight hours (e.g., 22:00 - 06:00)
  if (startMinutes > endMinutes) {
    // Overnight: valid if time >= start OR time < end
    return currentTime >= startMinutes || currentTime < endMinutes;
  }
  
  // Normal hours: valid if time >= start AND time < end
  return currentTime >= startMinutes && currentTime < endMinutes;
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
        timeout: 60000
      }
    );
    
    // Log successful Volna API call with filter ID
    await logApiCall('volna', true, `filters/${filterId}/projects`, undefined, filterId);
    
    const data = response.data.data || [];
    
    // Cache the result
    schedulerCache.set(filterId, { data, timestamp: Date.now() });
    
    return data;
  } catch (error: any) {
    console.error(`Volna: Failed to fetch from filter ${filterId}:`, error.message);
    // Log failed Volna API call with filter ID
    await logApiCall('volna', false, `filters/${filterId}/projects`, error.message, filterId);
    return [];
  }
}

// Add a job URL to the queue (if not already exists)
async function addJobToQueue(userId: string, jobUrl: string, volnaData?: any, sourceFilterId?: string): Promise<boolean> {
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
    
    // Create job record with Volna metadata for fallback and source filter ID
    await prismaInstance.job.create({
      data: {
        userId,
        jobUrl,
        jobId,
        status: 'queued',
        volnaData: volnaData || null,
        sourceFilterId: sourceFilterId || null
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
    
    // Check if auto-fetch is enabled and not in maintenance mode or stopped
    if (!config.autoFetch || config.maintenanceMode || config.volnaStopped) {
      schedulNextFetch(config.fetchInterval);
      return;
    }
    
    // Check working hours
    if (!isWithinWorkingHours(config)) {
      schedulNextFetch(config.fetchInterval);
      return;
    }
    
    // Check if configured
    if (!config.apiKey || config.filterIds.length === 0) {
      schedulNextFetch(config.fetchInterval);
      return;
    }
    
    // Fetch from all filters - track which filter each project came from
    const allProjects: Array<{ project: any; filterId: string }> = [];
    const seenUrls = new Set<string>();
    
    for (const filterId of config.filterIds) {
      const projects = await fetchFromFilter(config.apiKey, filterId);
      
      for (const project of projects) {
        if (project.url && !seenUrls.has(project.url)) {
          seenUrls.add(project.url);
          allProjects.push({ project, filterId });
        }
      }
    }
    
    // Auto-add to queue if enabled
    if (config.autoAdd && allProjects.length > 0) {
      const userId = await getAutoAddUserId();
      
      if (userId) {
        let addedCount = 0;
        
        for (const { project, filterId } of allProjects) {
          if (project.url) {
            // Extract Volna metadata to store as fallback
            const volnaData = {
              title: project.title,
              client_country: project.clientDetails?.country,
              client_rating: project.clientDetails?.rating,
              client_reviews: project.clientDetails?.reviews,
              client_total_spent: project.clientDetails?.totalSpent,
              client_total_hires: project.clientDetails?.totalHires,
              client_verified: project.clientDetails?.paymentMethodVerified,
              budget_type: project.budget?.type,
              budget_amount: project.budget?.amount
            };
            
            const added = await addJobToQueue(userId, project.url, volnaData, filterId);
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
