// Simple in-memory job queue (no Redis required)
// Jobs are stored in the database with status, processed by the scheduler

// Add job to queue (job is already in database with 'queued' status)
// This function is kept for API compatibility but does nothing since
// the scheduler picks up jobs directly from the database
export async function addJobToQueue(jobId: string): Promise<void> {
  // No-op: jobs are managed in the database by the scheduler
  console.log(`Job ${jobId} added to processing queue`);
}

// Get queue length - this would need a database query
// but is not used in the current implementation
export async function getQueueLength(): Promise<number> {
  return 0;
}
