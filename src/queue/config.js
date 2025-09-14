import path from 'path';
import os from 'os';
import { redisInstance } from '../config/redis_config.js';

// Use the existing Redis instance
export const redisConnection = redisInstance;

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