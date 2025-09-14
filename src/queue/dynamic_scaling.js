// Dynamic worker scaling for E6Data
import { Worker } from 'bullmq';
import { job_queue } from './job_queue.js';
import { redisConnection, QUEUE_CONFIG } from './config.js';
import { resourceManager } from './resource_manager.js';
import { runJobInContainer } from '../docker/index.js';
import { publishJobStatus } from '../pubsub/redis_pubsub.js';

// Default configuration
const DEFAULT_MAX_WORKERS = 10;
const DEFAULT_MIN_WORKERS = 1;
const DEFAULT_SCALE_INTERVAL = 30000; // 30 seconds
const DEFAULT_JOBS_PER_WORKER = 2;

// Environment variables
const MAX_WORKERS = parseInt(process.env.MAX_WORKERS || DEFAULT_MAX_WORKERS);
const MIN_WORKERS = parseInt(process.env.MIN_WORKERS || DEFAULT_MIN_WORKERS);
const SCALE_INTERVAL = parseInt(process.env.SCALE_INTERVAL || DEFAULT_SCALE_INTERVAL);
const JOBS_PER_WORKER = parseInt(process.env.JOBS_PER_WORKER || DEFAULT_JOBS_PER_WORKER);

// Worker pool
const workers = new Map();
let scaling = false;

/**
 * Create a new worker
 * @returns {Worker} The created worker
 */
function createWorker() {
  const workerId = `worker-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  
  console.log(`[SCALING] Creating new worker: ${workerId}`);
  
  const worker = new Worker(
    'job_queue',
    async (job) => {
      console.log(`[Worker ${workerId}] Processing job ${job.id}`);
      
      // The actual job processing logic (copied from job_processor.js)
      // This would typically be imported from a shared module
      try {
        // Save job to database
        await db.saveJob(job, 'waiting');
        
        // Queue status update and publish to Redis
        await queueStatusUpdate(job.id, 'waiting');
        await publishJobStatus(job.id, 'waiting');
      } catch (dbError) {
        console.error(`[ERROR] Failed to save job to database: ${dbError.message}`);
      }
      
      // Check if we have resources to run this job
      if (!await resourceManager.checkResources()) {
        console.log(`[INFO] Job ${job.id} delayed due to resource constraints`);
        // Requeue the job with a delay
        await job.moveToDelayed(Date.now() + 10000);
        
        // Queue status update and publish to Redis
        await queueStatusUpdate(job.id, 'delayed');
        await publishJobStatus(job.id, 'delayed');
        
        return { status: 'delayed', message: 'Job delayed due to resource constraints' };
      }
      
      // Queue status update - job is now active
      await queueStatusUpdate(job.id, 'active');
      await publishJobStatus(job.id, 'active');
      
      // Run the job in Docker
      const result = await runJobInContainer(
        job, 
        resourceManager.getWorkspaceDir(), 
        resourceManager
      );
      
      if (result.status === 'success') {
        console.log(`Job ${job.id} completed successfully`);
        return { 
          status: 'success', 
          message: 'Job processed successfully',
          output: result.output,
          exitCode: result.exitCode
        };
      } else {
        throw new Error(result.error || 'Job failed');
      }
    },
    { 
      connection: redisConnection,
      concurrency: 1, // Each worker handles one job at a time for better isolation
    }
  );
  
  // Store the worker in our pool
  workers.set(workerId, worker);
  
  // Add event handlers
  worker.on('completed', (job, result) => {
    console.log(`[Worker ${workerId}] Job ${job.id} completed`);
  });
  
  worker.on('failed', (job, error) => {
    console.error(`[Worker ${workerId}] Job ${job.id} failed: ${error.message}`);
  });
  
  return worker;
}

/**
 * Stop a worker
 * @param {string} workerId - The ID of the worker to stop
 */
async function stopWorker(workerId) {
  const worker = workers.get(workerId);
  
  if (worker) {
    console.log(`[SCALING] Stopping worker: ${workerId}`);
    
    try {
      await worker.close();
      workers.delete(workerId);
      console.log(`[SCALING] Worker ${workerId} stopped successfully`);
      return true;
    } catch (error) {
      console.error(`[ERROR] Failed to stop worker ${workerId}: ${error.message}`);
      return false;
    }
  }
  
  return false;
}

/**
 * Adjust the worker count based on queue depth
 */
async function adjustWorkerCount() {
  if (scaling) {
    return;
  }
  
  scaling = true;
  
  try {
    // Get current queue depth
    const queueCounts = await job_queue.getJobCounts();
    const waitingJobs = (queueCounts.waiting || 0) + (queueCounts.delayed || 0);
    const currentWorkerCount = workers.size;
    
    console.log(`[SCALING] Queue status: ${waitingJobs} waiting jobs, ${currentWorkerCount} workers`);
    
    // Calculate desired worker count
    const desiredWorkerCount = Math.min(
      MAX_WORKERS,
      Math.max(
        MIN_WORKERS,
        Math.ceil(waitingJobs / JOBS_PER_WORKER)
      )
    );
    
    console.log(`[SCALING] Desired worker count: ${desiredWorkerCount}`);
    
    // Adjust worker count
    if (desiredWorkerCount > currentWorkerCount) {
      // Scale up
      console.log(`[SCALING] Scaling up from ${currentWorkerCount} to ${desiredWorkerCount} workers`);
      
      for (let i = currentWorkerCount; i < desiredWorkerCount; i++) {
        createWorker();
      }
    } else if (desiredWorkerCount < currentWorkerCount) {
      // Scale down
      console.log(`[SCALING] Scaling down from ${currentWorkerCount} to ${desiredWorkerCount} workers`);
      
      // Get the oldest workers to stop
      const workersToStop = Array.from(workers.keys())
        .slice(0, currentWorkerCount - desiredWorkerCount);
      
      for (const workerId of workersToStop) {
        await stopWorker(workerId);
      }
    }
  } catch (error) {
    console.error(`[ERROR] Error adjusting worker count: ${error.message}`);
  } finally {
    scaling = false;
  }
}

/**
 * Initialize the dynamic scaling system
 */
export function initializeDynamicScaling() {
  console.log('[SCALING] Initializing dynamic scaling system');
  console.log(`[SCALING] Configuration: MIN=${MIN_WORKERS}, MAX=${MAX_WORKERS}, INTERVAL=${SCALE_INTERVAL}ms, JOBS_PER_WORKER=${JOBS_PER_WORKER}`);
  
  // Create initial workers
  for (let i = 0; i < MIN_WORKERS; i++) {
    createWorker();
  }
  
  // Set up periodic scaling
  setInterval(adjustWorkerCount, SCALE_INTERVAL);
  
  return {
    getWorkerCount: () => workers.size,
    getMaxWorkers: () => MAX_WORKERS,
    getMinWorkers: () => MIN_WORKERS,
    forceScaling: adjustWorkerCount
  };
}

export default {
  initializeDynamicScaling
};
