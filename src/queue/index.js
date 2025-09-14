// Queue module exports with clear naming
import { redisConnection, QUEUE_CONFIG } from './config.js';
import { resourceManager } from './resource_manager.js';
import { job_queue, dead_job_queue } from './job_queue.js';
import worker from './job_processor.js';

export {
  // Queue components
  job_queue as jobQueue,
  dead_job_queue as deadJobQueue,
  worker as jobWorker,
  
  // Resource management
  resourceManager,
  
  // Configuration
  redisConnection,
  QUEUE_CONFIG
};