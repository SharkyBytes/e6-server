import fs from 'fs/promises';
import { QUEUE_CONFIG } from './config.js';
import { job_queue } from './job_queue.js';

class ResourceManager {
  constructor() {
    // GCP VM Specs - use fixed values instead of checking local system
    this.totalMemoryMB = QUEUE_CONFIG.totalServerMemoryMB || 8192; // 8GB
    this.activeContainers = 0;
    this.maxConcurrentContainers = QUEUE_CONFIG.defaultMaxContainers;
    this.containerMemoryEstimate = QUEUE_CONFIG.containerMemoryEstimate;
    this.memoryUsageThreshold = QUEUE_CONFIG.memoryUsageThreshold || 0.8; // 80%
    this.workspaceDir = QUEUE_CONFIG.workspaceDir;
  }

  /**
   * Calculate max concurrent containers based on fixed GCP resources
   * @returns {Promise<number>} The calculated maximum number of containers
   */
  async calculateMaxContainers() {
    try {
      // Use fixed GCP server memory (8GB) instead of checking local system
      const totalMemoryMB = this.totalMemoryMB;
      
      // Calculate available memory for containers (80% of total)
      const availableMemoryMB = totalMemoryMB * this.memoryUsageThreshold;
      
      // Calculate max containers based on memory
      const maxContainers = Math.floor(availableMemoryMB / this.containerMemoryEstimate);
      
      console.log(`[RESOURCES] GCP server has ${totalMemoryMB}MB total memory`);
      console.log(`[RESOURCES] Using ${this.memoryUsageThreshold * 100}% (${availableMemoryMB}MB) for containers`);
      console.log(`[RESOURCES] Each container needs ${this.containerMemoryEstimate}MB memory`);
      console.log(`[RESOURCES] Max containers: ${maxContainers}`);
      
      return maxContainers;
    } catch (error) {
      console.error('[ERROR] Failed to calculate max containers:', error);
      return QUEUE_CONFIG.defaultMaxContainers;
    }
  }

  /**
   * Create workspace directory if it doesn't exist
   */
  async ensureWorkspaceDir() {
    await fs.mkdir(this.workspaceDir, { recursive: true });
    console.log(`[RESOURCES] Workspace directory created at ${this.workspaceDir}`);
  }

  /**
   * Check resources based on fixed GCP server capacity
   * @returns {Promise<boolean>} True if resources are available, false otherwise
   */
  async checkResources() {
    // Check if we have capacity for another container based on our fixed limit
    if (this.activeContainers >= this.maxConcurrentContainers) {
      console.log(`[RESOURCES] No capacity for new containers: ${this.activeContainers}/${this.maxConcurrentContainers} active`);
      return false;
    }
    
    // Calculate memory usage based on active containers
    const estimatedUsedMemoryMB = this.activeContainers * this.containerMemoryEstimate;
    const maxUsableMemoryMB = this.totalMemoryMB * this.memoryUsageThreshold;
    
    // Check if adding another container would exceed our memory threshold
    if (estimatedUsedMemoryMB + this.containerMemoryEstimate > maxUsableMemoryMB) {
      const usedPercent = (estimatedUsedMemoryMB / this.totalMemoryMB) * 100;
      console.log(`[RESOURCES] Insufficient memory: ${usedPercent.toFixed(1)}% used, exceeds ${this.memoryUsageThreshold * 100}% threshold with new container`);
      return false;
    }
    
    return true;
  }

  /**
   * Initialize the resource manager
   */
  async initialize() {
    try {
      // Ensure workspace directory exists
      await this.ensureWorkspaceDir();
      
      // Calculate initial max containers based on fixed GCP resources
      this.maxConcurrentContainers = await this.calculateMaxContainers();
      console.log(`[INIT] GCP server initialized with max ${this.maxConcurrentContainers} concurrent containers`);
      
      return this.maxConcurrentContainers;
    } catch (err) {
      console.error('[ERROR] Failed to initialize resource manager:', err);
      throw err;
    }
  }

  /**
   * Increment active containers count
   * @returns {number} The new active containers count
   */
  incrementContainers() {
    this.activeContainers++;
    console.log(`[RESOURCES] Active containers: ${this.activeContainers}/${this.maxConcurrentContainers}`);
    return this.activeContainers;
  }

  /**
   * Decrement active containers count
   * @returns {number} The new active containers count
   */
  decrementContainers() {
    this.activeContainers--;
    console.log(`[RESOURCES] Active containers: ${this.activeContainers}/${this.maxConcurrentContainers}`);
    return this.activeContainers;
  }

  /**
   * Get current max concurrent containers
   * @returns {number} The current max concurrent containers
   */
  getMaxConcurrentContainers() {
    return this.maxConcurrentContainers;
  }
  
  /**
   * Get workspace directory
   * @returns {string} The workspace directory path
   */
  getWorkspaceDir() {
    return this.workspaceDir;
  }

  /**
   * Clear pending jobs in the queue when there are too many active jobs
   * @returns {Promise<number>} Number of jobs cleared
   */
  async clearPendingJobs() {
    try {
      // Get waiting jobs
      const waitingJobs = await job_queue.getWaiting();
      console.log(`[QUEUE] Found ${waitingJobs.length} pending jobs`);
      
      if (waitingJobs.length === 0) {
        return 0;
      }
      
      // Clear jobs if we have too many active containers
      if (this.activeContainers >= this.maxConcurrentContainers * 0.8) {
        console.log(`[QUEUE] Clearing ${waitingJobs.length} pending jobs due to high resource usage`);
        
        // Remove jobs from queue
        for (const job of waitingJobs) {
          await job.remove();
          console.log(`[QUEUE] Removed job ${job.id} from queue`);
        }
        
        return waitingJobs.length;
      }
      
      return 0;
    } catch (error) {
      console.error('[ERROR] Failed to clear pending jobs:', error);
      return 0;
    }
  }

  /**
   * Get memory stats based on fixed GCP resources
   * @returns {Object} Memory usage in bytes
   */
  getMemoryStats() {
    const usedMemoryMB = this.activeContainers * this.containerMemoryEstimate;
    const freeMemoryMB = this.totalMemoryMB - usedMemoryMB;
    return {
      total: this.totalMemoryMB * 1024 * 1024,
      used: usedMemoryMB * 1024 * 1024,
      free: freeMemoryMB * 1024 * 1024,
      percentUsed: Math.round((usedMemoryMB / this.totalMemoryMB) * 100)
    };
  }

  /**
   * Get CPU info for GCP VM
   * @returns {Object} CPU information
   */
  getCpuStats() {
    return {
      cores: 2, // GCP VM has 2 cores
      usage: Math.min(100, this.activeContainers * 10) // Estimate usage based on active containers
    };
  }
}

// Create and export a singleton instance
export const resourceManager = new ResourceManager();