import path from 'path';
import os from 'os';
import IORedis from 'ioredis';
import { redis_connection_string } from '../config/redis_config.js';

// Redis connection
export const redisConnection = new IORedis(redis_connection_string, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// System configuration
export const QUEUE_CONFIG = {
  // Workspace directory for job files
  workspaceDir: path.join(os.tmpdir(), 'e6data-workspaces'),
  
  // Default container settings
  defaultMaxContainers: 10,
  containerMemoryEstimate: 512, // MB per container
  
  // Queue settings
  retryAttempts: 3,
  retryBackoffType: 'exponential',
  retryBackoffDelay: 5000,
  removeOnComplete: false,
  removeOnFail: false
};