import { Queue, Worker } from 'bullmq';
import { redisConnection } from './config.js';
import db from '../db/index.js';

// In-memory log storage for each job
const jobLogs = {};

// Log deduplication tracking
const processedLogs = {};

// Create a queue for job status updates
export const statusQueue = new Queue('status_queue', { connection: redisConnection });

// Create a worker to process job status updates
const statusWorker = new Worker(
  'status_queue',
  async (job) => {
    const { jobId, status, result, log, finalLogs } = job.data;
    
    try {
      // Update job status in database
      if (status) {
        await db.updateJobStatus(jobId, status, result);
        
        // If job is completed or failed, save consolidated logs to database
        if ((status === 'completed' || status === 'failed') && jobLogs[jobId]) {
          console.log(`[DB] Saving consolidated logs for job ${jobId} to PostgreSQL`);
          
          // Group logs by type (stdout/stderr)
          const stdout = [];
          const stderr = [];
          
          for (const logEntry of jobLogs[jobId]) {
            if (logEntry.type === 'stdout') {
              stdout.push(logEntry.content);
            } else if (logEntry.type === 'stderr') {
              stderr.push(logEntry.content);
            }
          }
          
          // Save consolidated logs (one entry per type)
          if (stdout.length > 0) {
            await db.saveJobLog(jobId, 'stdout', stdout.join('\n'));
          }
          
          if (stderr.length > 0) {
            await db.saveJobLog(jobId, 'stderr', stderr.join('\n'));
          }
          
          // Clear the in-memory logs
          delete jobLogs[jobId];
          delete processedLogs[jobId];
        }
      }
      
      // If finalLogs is provided, save them directly to database
      if (finalLogs) {
        for (const logEntry of finalLogs) {
          await db.saveJobLog(jobId, logEntry.type, logEntry.content);
        }
      }
      
      // For individual logs, just accumulate them in memory
      // Only save to database if explicitly requested or job is complete
      if (log && !finalLogs) {
        if (!jobLogs[jobId]) {
          jobLogs[jobId] = [];
        }
        jobLogs[jobId].push(log);
      }
      
      return { success: true };
    } catch (error) {
      console.error(`[ERROR] Failed to update job status in database: ${error.message}`);
      throw error;
    }
  },
  { connection: redisConnection }
);

// Handle worker events
statusWorker.on('completed', job => {
  console.log(`Status update for job ${job.data.jobId} completed`);
});

statusWorker.on('failed', (job, error) => {
  console.error(`Status update for job ${job.data.jobId} failed: ${error.message}`);
});

/**
 * Add a job status update to the queue
 * @param {string} jobId - The job ID
 * @param {string} status - The job status
 * @param {Object} [result] - Optional result object
 * @returns {Promise<Object>} - The added job
 */
export async function queueStatusUpdate(jobId, status, result = null) {
  return await statusQueue.add('status-update', { 
    jobId, 
    status, 
    result,
    timestamp: new Date().toISOString()
  });
}

/**
 * Add a job log to the queue
 * @param {string} jobId - The job ID
 * @param {string} type - The log type (stdout or stderr)
 * @param {string} content - The log content
 * @param {boolean} saveToDb - Whether to save this log to the database immediately
 * @returns {Promise<Object>} - The added job
 */
export async function queueLogUpdate(jobId, type, content, saveToDb = false) {
  // Initialize tracking structures if needed
  if (!jobLogs[jobId]) {
    jobLogs[jobId] = [];
  }
  if (!processedLogs[jobId]) {
    processedLogs[jobId] = new Set();
  }
  
  // Create a hash of the content to detect duplicates
  const contentHash = `${type}:${content}`;
  
  // Only add to memory if we haven't seen this exact log before
  if (!processedLogs[jobId].has(contentHash)) {
    jobLogs[jobId].push({ type, content });
    processedLogs[jobId].add(contentHash);
  }
  
  // Only queue for DB if explicitly requested
  if (saveToDb) {
    return await statusQueue.add('log-update', { 
      jobId, 
      log: { type, content },
      saveToDb,
      timestamp: new Date().toISOString()
    });
  }
  
  return null;
}

/**
 * Save all accumulated logs for a job to the database
 * @param {string} jobId - The job ID 
 * @returns {Promise<Object>} - The added job
 */
export async function saveJobLogsToDatabase(jobId) {
  if (!jobLogs[jobId] || jobLogs[jobId].length === 0) {
    return null;
  }
  
  // Group logs by type (stdout/stderr)
  const stdout = [];
  const stderr = [];
  
  for (const logEntry of jobLogs[jobId]) {
    if (logEntry.type === 'stdout') {
      stdout.push(logEntry.content);
    } else if (logEntry.type === 'stderr') {
      stderr.push(logEntry.content);
    }
  }
  
  console.log(`[DB] Saving consolidated logs for job ${jobId} (${stdout.length} stdout lines, ${stderr.length} stderr lines)`);
  
  // Create final logs array with one entry per type
  const finalLogs = [];
  if (stdout.length > 0) {
    finalLogs.push({ type: 'stdout', content: stdout.join('\n') });
  }
  if (stderr.length > 0) {
    finalLogs.push({ type: 'stderr', content: stderr.join('\n') });
  }
  
  return await statusQueue.add('final-logs', {
    jobId,
    finalLogs,
    timestamp: new Date().toISOString()
  });
}

export default {
  statusQueue,
  statusWorker,
  queueStatusUpdate,
  queueLogUpdate
};
