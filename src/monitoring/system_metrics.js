import os from 'os';
import { jobQueue } from '../queue/index.js';
import { resourceManager } from '../queue/resource_manager.js';
import { publishSystemMetrics } from '../pubsub/redis_pubsub.js';
import db from '../db/index.js';

// Metrics collection interval in milliseconds
const METRICS_INTERVAL = 10000; // 10 seconds

let lastCpuUsage = null;
let lastCpuTime = null;

/**
 * Calculate CPU usage percentage
 * @returns {Promise<number>} CPU usage percentage
 */
async function getCpuUsage() {
  const cpus = os.cpus();
  
  // Calculate the current CPU times
  const currentCpuTime = Date.now();
  let totalIdle = 0;
  let totalTick = 0;
  
  for (const cpu of cpus) {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }
  
  // Calculate CPU usage if we have previous measurements
  if (lastCpuUsage !== null && lastCpuTime !== null) {
    const idleDifference = totalIdle - lastCpuUsage.idle;
    const totalDifference = totalTick - lastCpuUsage.total;
    const timeDifference = currentCpuTime - lastCpuTime;
    
    // Calculate the CPU usage as a percentage
    const cpuUsage = 100 - Math.round(idleDifference / totalDifference * 100);
    
    // Update the last CPU usage
    lastCpuUsage = { idle: totalIdle, total: totalTick };
    lastCpuTime = currentCpuTime;
    
    return cpuUsage;
  }
  
  // First run, store the values and return 0
  lastCpuUsage = { idle: totalIdle, total: totalTick };
  lastCpuTime = currentCpuTime;
  
  return 0;
}

/**
 * Get memory usage
 * @returns {Object} Memory usage in bytes
 */
function getMemoryUsage() {
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  const usedMemory = totalMemory - freeMemory;
  
  return {
    total: totalMemory,
    free: freeMemory,
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
  const cpuUsage = await getCpuUsage();
  const memory = getMemoryUsage();
  const queueStats = await getQueueStats();
  const activeContainers = resourceManager.activeContainers || 0;
  const maxContainers = resourceManager.getMaxConcurrentContainers();
  
  const metrics = {
    timestamp: new Date(),
    cpu: {
      usage: cpuUsage,
      cores: os.cpus().length
    },
    memory: {
      total: memory.total,
      free: memory.free,
      used: memory.used,
      percentUsed: memory.percentUsed
    },
    containers: {
      active: activeContainers,
      max: maxContainers
    },
    queue: queueStats,
    system: {
      uptime: os.uptime(),
      platform: os.platform(),
      hostname: os.hostname(),
      loadavg: os.loadavg()
    }
  };
  
  // Save metrics to database and publish to Redis
  try {
    const metricsData = {
      totalMemory: memory.total,
      freeMemory: memory.free,
      cpuUsage: cpuUsage,
      activeContainers: activeContainers,
      queuedJobs: queueStats.waiting + queueStats.delayed
    };
    
    await db.saveSystemMetrics(metricsData);
    await publishSystemMetrics(metrics);
  } catch (error) {
    console.error('Error saving/publishing metrics:', error);
  }
  
  return metrics;
}

// Start collecting metrics periodically
let metricsInterval = null;
let currentMetrics = null;

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
      currentMetrics = await collectMetrics();
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
