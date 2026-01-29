import Bull from 'bull';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Create Redis connection
const redisClient = new Redis(REDIS_URL);

// Create Bull queue
export const jobQueue = new Bull('upwork-jobs', REDIS_URL, {
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 60000 // 1 minute
    }
  }
});

// Add job to queue
export async function addJobToQueue(jobId: string): Promise<void> {
  await jobQueue.add({ jobId }, { jobId });
}

// Get queue length
export async function getQueueLength(): Promise<number> {
  return await jobQueue.count();
}

export { redisClient };
