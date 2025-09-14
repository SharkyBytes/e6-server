import path from 'path';
import os from 'os';
import { redisInstance } from '../config/redis_config.js';

export const redisConnection = redisInstance;

// Auto-detect server resources
const totalMemoryMB = Math.floor(os.totalmem() / (1024 * 1024));
const freeMemoryMB = Math.floor(os.freemem() / (1024 * 1024));
const cpuCores = os.cpus().length;

// Estimate how many containers we can run safely (80% of total memory)
const containerMemoryEstimate = 512; // MB
const memoryUsageThreshold = 0.8;
const maxContainers = Math.floor((totalMemoryMB * memoryUsageThreshold) / containerMemoryEstimate);

export const QUEUE_CONFIG = {
  workspaceDir: path.join(os.tmpdir(), 'e6data-workspaces'),

  defaultMaxContainers: maxContainers,   // auto-calculated
  containerMemoryEstimate,
  totalServerMemoryMB: totalMemoryMB,
  freeMemoryMB,
  cpuCores,
  memoryUsageThreshold,

  retryAttempts: process.env.QUEUE_RETRY_ATTEMPTS || 3,
  retryBackoffType: 'exponential',
  retryBackoffDelay: process.env.QUEUE_RETRY_DELAY || 5000,
  removeOnComplete: false,
  removeOnFail: false
};