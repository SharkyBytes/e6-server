import { Worker } from 'bullmq';
import { redisConnection, QUEUE_CONFIG } from './config.js';
import { resourceManager } from './resource_manager.js';
import { runJobInContainer } from '../docker/index.js';
import { queueStatusUpdate, queueLogUpdate } from './status_queue.js';
import { publishJobStatus } from '../pubsub/redis_pubsub.js';
import { initializeRetrySystem } from './enhanced_retries.js';
import db from '../db/index.js';

// Initialize the system
resourceManager.initialize().catch(err => {
  console.error('[ERROR] Failed to initialize system:', err);
  process.exit(1);
});

// Create a worker to process jobs
const worker = new Worker(
  'job_queue',
  async (job) => {
    console.log(`Processing job ${job.id}`);
    console.log('Job data:', job.data);
    
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
    concurrency: resourceManager.getMaxConcurrentContainers() 
  }
);

// Worker event handlers
worker.on('completed', async (job, result) => {
  console.log(`Job ${job.id} has been completed`);
  
  try {
    // Calculate duration using BullMQ's built-in timestamps
    // processedOn is when the job started processing, finishedOn is when it completed
    const startTime = job.processedOn || Date.now();
    const endTime = job.finishedOn || Date.now();
    
    const jobResult = {
      exitCode: result.exitCode || 0,
      duration: Math.max(0, endTime - startTime) // Ensure non-negative duration
    };
    
    console.log(`Job ${job.id} duration: ${jobResult.duration}ms`);
    
    await queueStatusUpdate(job.id, 'completed', jobResult);
    await publishJobStatus(job.id, 'completed', jobResult);
  } catch (error) {
    console.error(`[ERROR] Failed to queue status update: ${error.message}`);
  }
});

// Initialize enhanced retry system (replaces the default failed handler)
initializeRetrySystem(worker);

// Keep original error handler
worker.on('error', err => {
  console.error('[ERROR] Worker error:', err);
});

worker.on('error', err => {
  console.error('Worker error:', err);
});

console.log('Job processor worker started');

export default worker;