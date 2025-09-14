import os from 'os';
import { jobQueue } from '../queue/index.js';
import { resourceManager } from '../queue/resource_manager.js';
import { publishSystemMetrics } from '../pubsub/redis_pubsub.js';
import db from '../db/index.js';

// Metrics collection interval in milliseconds
const METRICS_INTERVAL = 10000; // 10 seconds

let metricsInterval = null;
let currentMetrics = null;

/**
 * Get memory usage based on fixed GCP server resources
 * @returns {Object} Memory usage in bytes
 */
function getMemoryUsage() {
  // Use resourceManager's memory stats instead of local system
  if (resourceManager.getMemoryStats) {
    return resourceManager.getMemoryStats();
  }
  
  // Fallback to fixed calculation if getMemoryStats is not available
  const totalMemory = resourceManager.totalMemoryMB * 1024 * 1024; // Convert MB to bytes
  const activeContainers = resourceManager.activeContainers || 0;
  const containerMemoryEstimate = resourceManager.containerMemoryEstimate * 1024 * 1024; // Convert MB to bytes
  const usedMemory = activeContainers * containerMemoryEstimate;
  
  return {
    total: totalMemory,
    free: totalMemory - usedMemory,
    used: usedMemory,
    percentUsed: Math.round((usedMemory / totalMemory) * 100)
  };
}

/**
 * Get queue statistics
 * @returns {Promise<Object>} Queue statistics
 */
async function getQueueStats() {
  try {
    const waiting = await jobQueue.getWaitingCount();
    const active = await jobQueue.getActiveCount();
    const completed = await jobQueue.getCompletedCount();
    const failed = await jobQueue.getFailedCount();
    const delayed = await jobQueue.getDelayedCount();
    
    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
      total: waiting + active + completed + failed + delayed
    };
  } catch (error) {
    console.error('Error getting queue stats:', error);
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      total: 0
    };
  }
}

/**
 * Collect system metrics
 * @returns {Promise<Object>} System metrics
 */
export async function collectMetrics() {
  // Get memory usage from resource manager
  const memory = getMemoryUsage();
  
  // Get queue statistics
  const queueStats = await getQueueStats();
  
  // Get container information
  const activeContainers = resourceManager.activeContainers || 0;
  const maxContainers = resourceManager.getMaxConcurrentContainers();
  
  // Get CPU stats from resource manager or use default
  const cpuStats = resourceManager.getCpuStats ? 
    resourceManager.getCpuStats() : 
    { cores: os.cpus().length, usage: 0 };
  
  const metrics = {
    timestamp: new Date(),
    cpu: cpuStats,
    memory: memory,
    containers: {
      active: activeContainers,
      max: maxContainers
    },
    queue: queueStats,
    system: {
      uptime: os.uptime(),
      platform: 'GCP Server (8GB RAM)',
      hostname: os.hostname(),
      loadavg: os.loadavg()
    }
  };
  
  // Save metrics to database and publish to Redis
  try {
    const metricsData = {
      totalMemory: memory.total,
      freeMemory: memory.free,
      cpuUsage: cpuStats.usage,
      activeContainers: activeContainers,
      queuedJobs: queueStats.waiting + queueStats.delayed
    };
    
    await db.saveSystemMetrics(metricsData);
    await publishSystemMetrics(metrics);
  } catch (error) {
    console.error('Error saving/publishing metrics:', error);
  }
  
  // Update current metrics
  currentMetrics = metrics;
  
  return metrics;
}

/**
 * Start metrics collection
 */
export function startMetricsCollection() {
  if (metricsInterval) {
    return;
  }
  
  console.log(`Starting metrics collection every ${METRICS_INTERVAL / 1000} seconds`);
  
  // Collect metrics immediately
  collectMetrics().then(metrics => {
    currentMetrics = metrics;
    console.log('Initial metrics collected');
  });
  
  // Set up interval for collecting metrics
  metricsInterval = setInterval(async () => {
    try {
      await collectMetrics();
    } catch (error) {
      console.error('Error collecting metrics:', error);
    }
  }, METRICS_INTERVAL);
}

/**
 * Stop metrics collection
 */
export function stopMetricsCollection() {
  if (metricsInterval) {
    clearInterval(metricsInterval);
    metricsInterval = null;
    console.log('Metrics collection stopped');
  }
}

/**
 * Get the latest metrics
 * @returns {Object} Latest metrics
 */
export function getLatestMetrics() {
  return currentMetrics;
}

export default {
  startMetricsCollection,
  stopMetricsCollection,
  getLatestMetrics,
  collectMetrics
};