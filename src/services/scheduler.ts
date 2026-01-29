import { PrismaClient } from '@prisma/client';
import { fetchJobDetails } from './upworkClient';

const MIN_INTERVAL = 72000;   // 72 seconds (50 per hour = 72 sec each)
const MAX_INTERVAL = 120000;  // 120 seconds (random spread)
const MAX_PER_HOUR = 50;

let isRunning = false;
let prismaInstance: PrismaClient;

// Get random interval between min and max
function getRandomInterval(): number {
  return Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL)) + MIN_INTERVAL;
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

// Process the next job in queue
async function processNextJob(): Promise<void> {
  if (!isRunning) return;
  
  try {
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
export function startScheduler(prisma: PrismaClient): void {
  prismaInstance = prisma;
  isRunning = true;
  
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
