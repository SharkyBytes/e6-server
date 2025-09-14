import { redisInstance } from '../config/redis_config.js';

// Use the existing Redis instance for publisher
const publisher = redisInstance;
// Create a duplicate connection for subscriber
const subscriber = redisInstance.duplicate();

// Define channels
const CHANNELS = {
  JOB_STATUS: 'job:status',
  JOB_LOGS: 'job:logs',
  SYSTEM_METRICS: 'system:metrics'
};

/**
 * Initialize Redis pub/sub
 * @param {Object} io - Socket.io instance
 */
export function initPubSub(io) {
  // Subscribe to channels
  subscriber.subscribe(CHANNELS.JOB_STATUS);
  subscriber.subscribe(CHANNELS.JOB_LOGS);
  subscriber.subscribe(CHANNELS.SYSTEM_METRICS);

  // Handle messages
  subscriber.on('message', (channel, message) => {
    try {
      const data = JSON.parse(message);
      
      switch (channel) {
        case CHANNELS.JOB_STATUS:
          // Emit job status update to all clients
          io.emit('job_status', data);
          
          // Also emit to job-specific room
          if (data.jobId) {
            io.to(`job-${data.jobId}`).emit('status', data);
          }
          break;
          
        case CHANNELS.JOB_LOGS:
          // Emit job logs to job-specific room
          if (data.jobId) {
            io.to(`job-${data.jobId}`).emit('log', data);
          }
          break;
          
        case CHANNELS.SYSTEM_METRICS:
          // Emit system metrics to all clients
          io.emit('metrics', data);
          break;
          
        default:
          console.log(`Received message on unknown channel: ${channel}`);
      }
    } catch (error) {
      console.error(`Error handling Redis message on channel ${channel}:`, error);
    }
  });

  console.log('Redis pub/sub initialized');
}

/**
 * Publish job status update
 * @param {string} jobId - Job ID
 * @param {string} status - Job status
 * @param {Object} data - Additional data
 */
export async function publishJobStatus(jobId, status, data = {}) {
  try {
    await publisher.publish(CHANNELS.JOB_STATUS, JSON.stringify({
      jobId,
      status,
      ...data,
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.error('Error publishing job status:', error);
  }
}

/**
 * Publish job logs
 * @param {string} jobId - Job ID
 * @param {string} type - Log type (stdout or stderr)
 * @param {string} content - Log content
 */
export async function publishJobLogs(jobId, type, content) {
  try {
    await publisher.publish(CHANNELS.JOB_LOGS, JSON.stringify({
      jobId,
      type,
      data: content,
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.error('Error publishing job logs:', error);
  }
}

/**
 * Publish system metrics
 * @param {Object} metrics - System metrics
 */
export async function publishSystemMetrics(metrics) {
  try {
    await publisher.publish(CHANNELS.SYSTEM_METRICS, JSON.stringify({
      ...metrics,
      timestamp: new Date().toISOString()
    }));
  } catch (error) {
    console.error('Error publishing system metrics:', error);
  }
}

export default {
  initPubSub,
  publishJobStatus,
  publishJobLogs,
  publishSystemMetrics,
  CHANNELS
};
