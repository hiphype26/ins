import { PrismaClient } from '@prisma/client';
import { fetchJobDetails } from './upworkClient';

// Default values (can be overridden by settings)
let MIN_INTERVAL = 90000;   // 90 seconds minimum
let MAX_INTERVAL = 180000;  // 180 seconds (3 min) - wider spread for randomness
let MAX_PER_HOUR = 50;

let isRunning = false;
let prismaInstance: PrismaClient;

// Load settings from database
async function loadSettings(): Promise<void> {
  try {
    const settings = await prismaInstance.settings.findMany({
      where: {
        key: {
          in: ['upwork_rate_limit', 'min_interval', 'max_interval', 'maintenance_mode', 'upwork_stopped']
        }
      }
    });
    
    let changed = false;
    for (const setting of settings) {
      switch (setting.key) {
        case 'upwork_rate_limit':
          const newMaxPerHour = parseInt(setting.value) || 50;
          if (newMaxPerHour !== MAX_PER_HOUR) {
            MAX_PER_HOUR = newMaxPerHour;
            changed = true;
          }
          break;
        case 'min_interval':
          const newMinInterval = (parseInt(setting.value) || 72) * 1000;
          if (newMinInterval !== MIN_INTERVAL) {
            MIN_INTERVAL = newMinInterval;
            changed = true;
          }
          break;
        case 'max_interval':
          const newMaxInterval = (parseInt(setting.value) || 120) * 1000;
          if (newMaxInterval !== MAX_INTERVAL) {
            MAX_INTERVAL = newMaxInterval;
            changed = true;
          }
          break;
      }
    }
    
    // Only log when settings actually change
    if (changed) {
      console.log(`Scheduler settings updated: MAX_PER_HOUR=${MAX_PER_HOUR}, MIN_INTERVAL=${MIN_INTERVAL/1000}s, MAX_INTERVAL=${MAX_INTERVAL/1000}s`);
    }
  } catch (error) {
    console.error('Failed to load scheduler settings:', error);
  }
}

// Check if maintenance mode is enabled
async function isMaintenanceMode(): Promise<boolean> {
  try {
    const setting = await prismaInstance.settings.findUnique({
      where: { key: 'maintenance_mode' }
    });
    return setting?.value === 'true';
  } catch (error) {
    return false;
  }
}

// Check if Upwork processing is stopped
async function isUpworkStopped(): Promise<boolean> {
  try {
    const setting = await prismaInstance.settings.findUnique({
      where: { key: 'upwork_stopped' }
    });
    return setting?.value === 'true';
  } catch (error) {
    return false;
  }
}

// Get random interval between min and max with occasional longer pauses
function getRandomInterval(): number {
  const baseInterval = Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL)) + MIN_INTERVAL;
  
  // 15% chance of taking an extra long pause (2x-3x the base interval)
  // This makes the pattern more random and human-like
  if (Math.random() < 0.15) {
    const multiplier = 2 + Math.random(); // 2x to 3x
    return Math.floor(baseInterval * multiplier);
  }
  
  return baseInterval;
}

// Get current hour key
function getCurrentHourKey(): string {
  return new Date().toISOString().slice(0, 13); // "2024-01-15T14"
}

// Check and update rate limit
async function checkRateLimit(): Promise<boolean> {
  const hourKey = getCurrentHourKey();
  
  const rateLimit = await prismaInstance.rateLimit.upsert({
    where: { hour: hourKey },
    update: {},
    create: { hour: hourKey, count: 0 }
  });
  
  return rateLimit.count < MAX_PER_HOUR;
}

// Increment rate limit counter
async function incrementRateLimit(): Promise<void> {
  const hourKey = getCurrentHourKey();
  
  await prismaInstance.rateLimit.upsert({
    where: { hour: hourKey },
    update: { count: { increment: 1 } },
    create: { hour: hourKey, count: 1 }
  });
}

// Track when we last loaded settings
let lastSettingsLoad = 0;
const SETTINGS_RELOAD_INTERVAL = 60000; // Reload settings every 60 seconds

// Process the next job in queue
async function processNextJob(): Promise<void> {
  if (!isRunning) return;
  
  try {
    // Check maintenance mode or if Upwork processing is stopped
    if (await isMaintenanceMode() || await isUpworkStopped()) {
      setTimeout(processNextJob, 30000); // Check again in 30 seconds
      return;
    }
    
    // Reload settings periodically (not every cycle)
    const now = Date.now();
    if (now - lastSettingsLoad > SETTINGS_RELOAD_INTERVAL) {
      await loadSettings();
      lastSettingsLoad = now;
    }
    
    // Check rate limit
    const canProcess = await checkRateLimit();
    if (!canProcess) {
      console.log('Rate limit reached, waiting...');
      setTimeout(processNextJob, 60000); // Check again in 1 minute
      return;
    }
    
    // Get next queued job
    const job = await prismaInstance.job.findFirst({
      where: { status: 'queued' },
      orderBy: { createdAt: 'asc' }
    });
    
    if (!job) {
      // No jobs in queue, check again later
      setTimeout(processNextJob, 10000);
      return;
    }
    
    console.log(`Processing job ${job.id}: ${job.jobUrl}`);
    
    // Update status to processing
    await prismaInstance.job.update({
      where: { id: job.id },
      data: { status: 'processing' }
    });
    
    try {
      // Fetch job details from Upwork
      const result = await fetchJobDetails(prismaInstance, job.userId, job.jobUrl);
      
      // Update job with result
      await prismaInstance.job.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          result: result as any,
          processedAt: new Date()
        }
      });
      
      // Increment rate limit
      await incrementRateLimit();
      
      console.log(`Job ${job.id} completed successfully`);
    } catch (error: any) {
      console.error(`Job ${job.id} failed:`, error.message);
      
      await prismaInstance.job.update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: error.message,
          processedAt: new Date()
        }
      });
    }
  } catch (error) {
    console.error('Scheduler error:', error);
  }
  
  // Schedule next job with random interval
  const nextInterval = getRandomInterval();
  console.log(`Next job in ${Math.round(nextInterval / 1000)} seconds`);
  setTimeout(processNextJob, nextInterval);
}

// Start the scheduler
export async function startScheduler(prisma: PrismaClient): Promise<void> {
  prismaInstance = prisma;
  isRunning = true;
  lastSettingsLoad = Date.now();
  
  // Load initial settings (force log on startup)
  const settings = await prismaInstance.settings.findMany({
    where: {
      key: {
        in: ['upwork_rate_limit', 'min_interval', 'max_interval']
      }
    }
  });
  
  for (const setting of settings) {
    switch (setting.key) {
      case 'upwork_rate_limit':
        MAX_PER_HOUR = parseInt(setting.value) || 50;
        break;
      case 'min_interval':
        MIN_INTERVAL = (parseInt(setting.value) || 72) * 1000;
        break;
      case 'max_interval':
        MAX_INTERVAL = (parseInt(setting.value) || 120) * 1000;
        break;
    }
  }
  
  // Clean up old rate limit records (older than 2 hours)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  prisma.rateLimit.deleteMany({
    where: { createdAt: { lt: twoHoursAgo } }
  }).catch(console.error);
  
  // Start processing
  processNextJob();
}

// Stop the scheduler
export function stopScheduler(): void {
  isRunning = false;
}
