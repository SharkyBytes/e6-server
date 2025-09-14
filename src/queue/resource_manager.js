import os from 'os';
import fs from 'fs/promises';
import { QUEUE_CONFIG } from './config.js';

class ResourceManager {
  constructor() {
    this.activeContainers = 0;
    this.maxConcurrentContainers = QUEUE_CONFIG.defaultMaxContainers;
    this.workspaceDir = QUEUE_CONFIG.workspaceDir;
    this.containerMemoryEstimate = QUEUE_CONFIG.containerMemoryEstimate;
  }

  /**
   * Calculate max concurrent containers based on available system resources
   * @returns {Promise<number>} The calculated maximum number of containers
   */
  async calculateMaxContainers() {
    try {
      const totalMemoryMB = Math.floor(os.totalmem() / (1024 * 1024));
      const freeMemoryMB = Math.floor(os.freemem() / (1024 * 1024));
      
      // Reserve 20% of total memory or 1GB (whichever is smaller) for the system
      const reservedMemoryMB = Math.min(totalMemoryMB * 0.2, 1024);
      
      // Calculate available memory for containers
      const availableMemoryMB = totalMemoryMB - reservedMemoryMB;
      
      // Calculate max containers based on memory
      const memoryBasedLimit = Math.floor(availableMemoryMB / this.containerMemoryEstimate);
      
      // Get CPU count and use 75% of available cores
      const cpuCount = os.cpus().length;
      const cpuBasedLimit = Math.max(1, Math.floor(cpuCount * 0.75));
      
      // Use the smaller of the two limits
      const calculatedLimit = Math.max(1, Math.min(memoryBasedLimit, cpuBasedLimit));
      
      console.log(`[RESOURCES] System has ${totalMemoryMB}MB total memory, ${freeMemoryMB}MB free memory`);
      console.log(`[RESOURCES] System has ${cpuCount} CPU cores`);
      console.log(`[RESOURCES] Calculated container limit: ${calculatedLimit} (memory: ${memoryBasedLimit}, CPU: ${cpuBasedLimit})`);
      
      return calculatedLimit;
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
    console.log(`Workspace directory created at ${this.workspaceDir}`);
  }

  /**
   * Check system resources and recalculate limits if needed
   * @returns {Promise<boolean>} True if resources are available, false otherwise
   */
  async checkResources() {
    // Recalculate max containers based on current system resources
    // Do this periodically (every 5 job checks) to adapt to changing system load
    if (this.activeContainers % 5 === 0) {
      this.maxConcurrentContainers = await this.calculateMaxContainers();
    }
    
    // Check if we have capacity for another container
    if (this.activeContainers >= this.maxConcurrentContainers) {
      console.log(`[RESOURCES] No capacity for new containers: ${this.activeContainers}/${this.maxConcurrentContainers} active`);
      return false;
    }
    
    // Check current system memory
    const freeMemoryMB = Math.floor(os.freemem() / (1024 * 1024));
    if (freeMemoryMB < this.containerMemoryEstimate * 1.5) {
      console.log(`[RESOURCES] Insufficient memory: ${freeMemoryMB}MB free, need ${this.containerMemoryEstimate * 1.5}MB`);
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
      
      // Calculate initial max containers
      this.maxConcurrentContainers = await this.calculateMaxContainers();
      console.log(`[INIT] System initialized with max ${this.maxConcurrentContainers} concurrent containers`);
      
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
    console.log(`Active containers: ${this.activeContainers}/${this.maxConcurrentContainers}`);
    return this.activeContainers;
  }

  /**
   * Decrement active containers count
   * @returns {number} The new active containers count
   */
  decrementContainers() {
    this.activeContainers--;
    console.log(`Active containers: ${this.activeContainers}/${this.maxConcurrentContainers}`);
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
}

// Create and export a singleton instance
export const resourceManager = new ResourceManager();