// Enhanced retry mechanism for E6Data jobs
import { job_queue, dead_job_queue } from './job_queue.js';
import { publishJobStatus } from '../pubsub/redis_pubsub.js';
import db from '../db/index.js';

// Retry delay configuration (in milliseconds)
const RETRY_DELAYS = [
  1000,    // 1 second
  5000,    // 5 seconds
  15000,   // 15 seconds
  60000,   // 1 minute
  300000   // 5 minutes
];

// Maximum number of retries before considering job as failed
const MAX_RETRIES = RETRY_DELAYS.length;

/**
 * Handle job failure with exponential backoff retry
 * @param {Object} job - The failed job
 * @param {Error} error - The error that caused the failure
 */
export async function handleJobFailure(job, error) {
  try {
    const attempts = job.attemptsMade || 0;
    const jobId = job.id;
    
    console.log(`[RETRY] Job ${jobId} failed with error: ${error.message}`);
    console.log(`[RETRY] Attempt ${attempts + 1} of ${MAX_RETRIES + 1}`);
    
    // Update job status in database
    await db.updateJobStatus(jobId, 'failed', {
      exitCode: 1,
      error: error.message,
      retryAttempt: attempts
    });
    
    // Publish status update
    await publishJobStatus(jobId, 'failed', {
      error: error.message,
      retryAttempt: attempts
    });
    
    // Check if we should retry
    if (attempts <= MAX_RETRIES) {
      const delay = RETRY_DELAYS[attempts - 1] || RETRY_DELAYS[RETRY_DELAYS.length - 1];
      
      console.log(`[RETRY] Retrying job ${jobId} in ${delay}ms`);
      
      // Update status to retrying
      await db.updateJobStatus(jobId, 'retrying', {
        retryAttempt: attempts,
        nextRetryDelay: delay
      });
      
      // Publish retry status
      await publishJobStatus(jobId, 'retrying', {
        retryAttempt: attempts,
        nextRetryDelay: delay
      });
      
      // Add job back to queue with delay
      await job_queue.add(
        'process-repo',
        job.data,
        {
          jobId: jobId,
          delay: delay,
          attempts: attempts + 1
        }
      );
      
      return true;
    } else {
      console.log(`[RETRY] Job ${jobId} failed permanently after ${attempts} attempts`);
      
      // Move to dead letter queue
      await dead_job_queue.add('failed-job', {
        jobId: jobId,
        originalData: job.data,
        error: error.message,
        attempts: attempts,
        finalFailure: true
      });
      
      // Update final status
      await db.updateJobStatus(jobId, 'failed_permanently', {
        exitCode: 1,
        error: error.message,
        attempts: attempts
      });
      
      // Publish final failure status
      await publishJobStatus(jobId, 'failed_permanently', {
        error: error.message,
        attempts: attempts
      });
      
      return false;
    }
  } catch (err) {
    console.error(`[ERROR] Error handling job failure: ${err.message}`);
    return false;
  }
}

/**
 * Initialize the enhanced retry system
 * @param {Worker} worker - The BullMQ worker instance
 */
export function initializeRetrySystem(worker) {
  console.log('[RETRY] Initializing enhanced retry system');
  
  // Override the default failed event handler
  worker.on('failed', async (job, err) => {
    await handleJobFailure(job, err);
  });
  
  return worker;
}

export default {
  handleJobFailure,
  initializeRetrySystem,
  RETRY_DELAYS,
  MAX_RETRIES
};
