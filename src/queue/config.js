import path from 'path';
import os from 'os';
import { redisInstance } from '../config/redis_config.js';

// Use the existing Redis instance
export const redisConnection = redisInstance;

// System configuration
export const QUEUE_CONFIG = {
  // Workspace directory for job files
  workspaceDir: path.join(os.tmpdir(), 'e6data-workspaces'),
  
  // GCP server settings (8GB RAM)
  defaultMaxContainers: 12,
  containerMemoryEstimate: 512, // MB per container
  totalServerMemoryMB: 8192, // 8GB RAM on GCP server
  memoryUsageThreshold: 0.8, // Use 80% of available memory
  
  // Queue settings
  retryAttempts: 3,
  retryBackoffType: 'exponential',
  retryBackoffDelay: 5000,
  removeOnComplete: false,
  removeOnFail: false,
  
  // Supported runtimes for raw code execution
  runtimes: {
    'nodejs': {
      image: 'node:18-alpine',
      fileExtension: '.js',
      defaultCommand: 'node code.js'
    },
    'python': {
      image: 'python:3.9-alpine',
      fileExtension: '.py',
      defaultCommand: 'python code.py'
    },
    'java': {
      image: 'openjdk:11-alpine',
      fileExtension: '.java',
      defaultCommand: 'javac Main.java && java Main'
    },
    'cpp': {
      image: 'gcc:alpine',
      fileExtension: '.cpp',
      defaultCommand: 'g++ -o program code.cpp && ./program'
    }
  }
};