import { PrismaClient } from '@prisma/client';
import { sendToLeadHack } from './leadhackClient';

let prismaInstance: PrismaClient;
let isRunning = false;
let checkInterval: NodeJS.Timeout | null = null;

// Default delay in hours (can be overridden by settings)
let LEADHACK_DELAY_HOURS = 2;

// Check interval - every 5 minutes
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export function startLeadhackScheduler(prisma: PrismaClient) {
  prismaInstance = prisma;
  isRunning = true;
  
  console.log('LeadHack scheduler started');
  
  // Initial check after 30 seconds
  setTimeout(processLeadhackQueue, 30000);
  
  // Then check periodically
  checkInterval = setInterval(processLeadhackQueue, CHECK_INTERVAL_MS);
}

export function stopLeadhackScheduler() {
  isRunning = false;
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}

// Load delay setting from database
async function loadDelaySetting(): Promise<number> {
  try {
    const setting = await prismaInstance.settings.findUnique({
      where: { key: 'leadhack_delay_hours' }
    });
    
    if (setting) {
      const hours = parseFloat(setting.value);
      if (!isNaN(hours) && hours >= 0) {
        return hours;
      }
    }
  } catch (error) {
    console.error('Failed to load LeadHack delay setting:', error);
  }
  
  return LEADHACK_DELAY_HOURS; // Default
}

// Schedule a job for LeadHack sending
export async function scheduleLeadhackSend(jobId: string, processedAt: Date) {
  try {
    const delayHours = await loadDelaySetting();
    const sendAt = new Date(processedAt.getTime() + delayHours * 60 * 60 * 1000);
    
    await prismaInstance.job.update({
      where: { id: jobId },
      data: {
        leadhackStatus: 'pending',
        leadhackSendAt: sendAt
      }
    });
    
    console.log(`LeadHack: Job ${jobId} scheduled to send at ${sendAt.toISOString()} (${delayHours}h delay)`);
  } catch (error) {
    console.error(`Failed to schedule LeadHack send for job ${jobId}:`, error);
  }
}

// Process the LeadHack queue
async function processLeadhackQueue() {
  if (!isRunning) return;
  
  try {
    const now = new Date();
    
    // Find jobs ready to send
    const jobsToSend = await prismaInstance.job.findMany({
      where: {
        leadhackStatus: 'pending',
        leadhackSendAt: {
          lte: now
        },
        status: 'completed' // Only send completed jobs
      },
      take: 10, // Process in batches
      orderBy: { leadhackSendAt: 'asc' }
    });
    
    if (jobsToSend.length === 0) {
      return;
    }
    
    console.log(`LeadHack: Processing ${jobsToSend.length} jobs ready to send`);
    
    for (const job of jobsToSend) {
      try {
        const result = await sendToLeadHack(
          job.jobUrl,
          job.result as any,
          job.volnaData as any
        );
        
        if (result.success) {
          await prismaInstance.job.update({
            where: { id: job.id },
            data: {
              leadhackStatus: 'sent',
              leadhackSentAt: new Date()
            }
          });
          console.log(`LeadHack: Successfully sent job ${job.id}`);
        } else {
          await prismaInstance.job.update({
            where: { id: job.id },
            data: {
              leadhackStatus: 'failed',
              leadhackError: result.error
            }
          });
          console.error(`LeadHack: Failed to send job ${job.id}: ${result.error}`);
        }
      } catch (error: any) {
        await prismaInstance.job.update({
          where: { id: job.id },
          data: {
            leadhackStatus: 'failed',
            leadhackError: error.message
          }
        });
        console.error(`LeadHack: Error sending job ${job.id}:`, error.message);
      }
      
      // Small delay between sends to avoid overwhelming the API
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } catch (error) {
    console.error('LeadHack scheduler error:', error);
  }
}

// Get queue stats
export async function getLeadhackStats() {
  const pending = await prismaInstance.job.count({
    where: { leadhackStatus: 'pending' }
  });
  
  const sent = await prismaInstance.job.count({
    where: { leadhackStatus: 'sent' }
  });
  
  const failed = await prismaInstance.job.count({
    where: { leadhackStatus: 'failed' }
  });
  
  // Get next job to send
  const nextJob = await prismaInstance.job.findFirst({
    where: { 
      leadhackStatus: 'pending',
      status: 'completed'
    },
    orderBy: { leadhackSendAt: 'asc' },
    select: { leadhackSendAt: true }
  });
  
  return {
    pending,
    sent,
    failed,
    nextSendAt: nextJob?.leadhackSendAt || null
  };
}
