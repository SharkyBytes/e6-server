/**
 * Simple cost calculator for E6Data jobs
 * 
 * This module provides functions to estimate the cost of job execution
 * based on resource usage and duration.
 */

// Base cost per second of compute (equivalent to $0.02 per hour)
const BASE_COST_PER_SECOND = 0.0000056; 

// Memory cost per GB-second (equivalent to $0.01 per GB-hour)
const MEMORY_COST_PER_GB_SECOND = 0.0000028;

// Additional cost factors
const RUNTIME_COST_FACTORS = {
  // Standard runtimes
  'nodejs': 1.0,
  'python': 1.0,
  'java': 1.2,
  'cpp': 0.9,
  'c': 0.9,
  
  // Specialized runtimes
  'nodejs-16': 1.0,
  'nodejs-14': 1.0,
  'typescript': 1.1,
  'deno': 1.1,
  'python-3.9': 1.0,
  'python-3.8': 1.0,
  'python-django': 1.2,
  'python-flask': 1.1,
  'java-11': 1.2,
  'java-spring': 1.3,
  'go': 0.9,
  'rust': 0.9,
  'ruby': 1.1,
  'php': 1.0,
  'dotnet': 1.2,
  
  // Default for custom Docker images
  'custom': 1.5
};

/**
 * Calculate the cost of a job based on its resource usage and duration
 * @param {Object} job - The job object
 * @returns {Object} Cost breakdown
 */
function calculateJobCost(job) {
  if (!job) {
    return {
      durationSeconds: 0,
      memoryGB: 0,
      baseCost: 0,
      memoryCost: 0,
      totalCost: 0,
      formattedCost: '$0.000000',
      currency: 'USD'
    };
  }
  
  // Calculate duration in seconds
  let durationSeconds = 0;
  try {
    // Use BullMQ's correct property names
    const startTime = job.processedOn ? 
      (typeof job.processedOn === 'number' ? job.processedOn : new Date(job.processedOn).getTime()) : 
      (typeof job.timestamp === 'number' ? job.timestamp : new Date(job.timestamp).getTime());
    
    const endTime = job.finishedOn ? 
      (typeof job.finishedOn === 'number' ? job.finishedOn : new Date(job.finishedOn).getTime()) : 
      Date.now();
    
    durationSeconds = Math.max(1, (endTime - startTime) / 1000);
  } catch (error) {
    console.error('Error calculating duration:', error);
    durationSeconds = 10; // Default to 10 seconds if calculation fails
  }

  // Parse memory limit
  let memoryGB = 0.5; // Default 512MB
  if (job.data && job.data.memory_limit) {
    if (job.data.memory_limit.endsWith('GB')) {
      memoryGB = parseFloat(job.data.memory_limit);
    } else if (job.data.memory_limit.endsWith('MB')) {
      memoryGB = parseFloat(job.data.memory_limit) / 1024;
    }
  }
  
  // Get runtime cost factor
  let runtimeFactor = 1.0;
  if (job.data && job.data.runtime) {
    runtimeFactor = RUNTIME_COST_FACTORS[job.data.runtime] || 1.0;
  } else if (job.data && job.data.docker_image) {
    runtimeFactor = RUNTIME_COST_FACTORS.custom;
  }
  
  // Calculate cost components
  const baseCost = BASE_COST_PER_SECOND * durationSeconds * runtimeFactor;
  const memoryCost = MEMORY_COST_PER_GB_SECOND * memoryGB * durationSeconds;
  
  // Total cost
  const totalCost = baseCost + memoryCost;
  
  return {
    durationSeconds,
    memoryGB,
    baseCost,
    memoryCost,
    totalCost,
    formattedCost: `$${totalCost.toFixed(6)}`,
    currency: 'USD',
    runtimeFactor,
    runtime: job.data ? job.data.runtime || 'custom' : 'unknown'
  };
}

/**
 * Calculate estimated monthly cost based on current usage pattern
 * @param {Object} job - The job object
 * @param {number} estimatedJobsPerMonth - Estimated number of similar jobs per month
 * @returns {Object} Monthly cost estimate
 */
function calculateMonthlyCost(job, estimatedJobsPerMonth = 1000) {
  const jobCost = calculateJobCost(job);
  const monthlyCost = jobCost.totalCost * estimatedJobsPerMonth;
  
  return {
    ...jobCost,
    estimatedJobsPerMonth,
    monthlyCost,
    formattedMonthlyCost: `$${monthlyCost.toFixed(2)}`
  };
}

/**
 * Calculate cost savings compared to traditional cloud providers
 * @param {Object} job - The job object
 * @returns {Object} Cost savings information
 */
function calculateCostSavings(job) {
  const e6dataCost = calculateJobCost(job);
  
  // Estimated costs for the same job on other platforms (60% higher)
  const traditionalCost = e6dataCost.totalCost * 2.5;
  const savings = traditionalCost - e6dataCost.totalCost;
  const savingsPercentage = (savings / traditionalCost) * 100;
  
  return {
    e6dataCost: e6dataCost.totalCost,
    traditionalCost,
    savings,
    savingsPercentage,
    formattedSavings: `$${savings.toFixed(6)}`,
    formattedSavingsPercentage: `${savingsPercentage.toFixed(0)}%`
  };
}

export {
  calculateJobCost,
  calculateMonthlyCost,
  calculateCostSavings,
  BASE_COST_PER_SECOND,
  MEMORY_COST_PER_GB_SECOND,
  RUNTIME_COST_FACTORS
};
