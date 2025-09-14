import { Router } from "express";
import { getLatestMetrics, collectMetrics } from "../monitoring/system_metrics.js";
import db from "../db/index.js";
import { jobQueue } from "../queue/index.js";
import { resourceManager } from "../queue/resource_manager.js";

const router = Router();

// Get system metrics
router.get("/system", async (req, res) => {
  try {
    const metrics = getLatestMetrics();
    
    if (!metrics) {
      return res.status(503).json({
        success: false,
        error: "Metrics collection not started or not available yet"
      });
    }
    
    res.status(200).json({
      success: true,
      metrics
    });
  } catch (err) {
    console.error("[ERROR] Failed to get system metrics:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to get system metrics"
    });
  }
});

// Get job statistics
router.get("/jobs", async (req, res) => {
  try {
    // Get job statistics from database
    const dbStats = await db.getJobStatistics();
    
    // Get queue statistics
    const waiting = await jobQueue.getWaitingCount();
    const active = await jobQueue.getActiveCount();
    const completed = await jobQueue.getCompletedCount();
    const failed = await jobQueue.getFailedCount();
    const delayed = await jobQueue.getDelayedCount();
    
    const stats = {
      queue: {
        waiting,
        active,
        completed,
        failed,
        delayed,
        total: waiting + active + completed + failed + delayed
      },
      overall: {
        total: parseInt(dbStats.total_jobs) || 0,
        completed: parseInt(dbStats.completed_jobs) || 0,
        failed: parseInt(dbStats.failed_jobs) || 0,
        active: parseInt(dbStats.active_jobs) || 0,
        queued: parseInt(dbStats.queued_jobs) || 0,
        avgDuration: parseFloat(dbStats.avg_duration) || 0
      }
    };
    
    res.status(200).json({
      success: true,
      statistics: stats
    });
  } catch (err) {
    console.error("[ERROR] Failed to get job statistics:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to get job statistics"
    });
  }
});

// Get dashboard data (combined metrics and statistics)
router.get("/dashboard", async (req, res) => {
  try {
    const metrics = getLatestMetrics();
    const dbStats = await db.getJobStatistics();
    
    if (!metrics) {
      return res.status(503).json({
        success: false,
        error: "Metrics collection not started or not available yet"
      });
    }
    
    const dashboard = {
      system: {
        cpu: metrics.cpu,
        memory: metrics.memory,
        containers: metrics.containers
      },
      jobs: {
        queue: metrics.queue,
        overall: {
          total: parseInt(dbStats.total_jobs) || 0,
          completed: parseInt(dbStats.completed_jobs) || 0,
          failed: parseInt(dbStats.failed_jobs) || 0,
          active: parseInt(dbStats.active_jobs) || 0,
          queued: parseInt(dbStats.queued_jobs) || 0,
          avgDuration: parseFloat(dbStats.avg_duration) || 0
        }
      },
      timestamp: metrics.timestamp
    };
    
    res.status(200).json({
      success: true,
      dashboard
    });
  } catch (err) {
    console.error("[ERROR] Failed to get dashboard data:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to get dashboard data"
    });
  }
});

// Force recalculation of max containers
router.post("/recalculate", async (req, res) => {
  try {
    // Recalculate max containers
    const maxContainers = await resourceManager.calculateMaxContainers();
    
    // Update the resource manager's max containers
    resourceManager.maxConcurrentContainers = maxContainers;
    
    // Collect fresh metrics
    const metrics = await collectMetrics();
    
    res.status(200).json({
      success: true,
      message: `Max containers recalculated: ${maxContainers}`,
      containers: {
        active: resourceManager.activeContainers,
        max: maxContainers,
        memoryPerContainer: resourceManager.containerMemoryEstimate,
        totalMemoryMB: resourceManager.totalMemoryMB,
        usageThreshold: resourceManager.memoryUsageThreshold
      }
    });
  } catch (err) {
    console.error("[ERROR] Failed to recalculate max containers:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to recalculate max containers"
    });
  }
});

// Clear all jobs in the queue
router.post("/clear-queue", async (req, res) => {
  try {
    // Get all jobs from different states
    const waitingJobs = await jobQueue.getWaiting();
    const activeJobs = await jobQueue.getActive();
    const delayedJobs = await jobQueue.getDelayed();

    const totalJobsBefore = waitingJobs.length + activeJobs.length + delayedJobs.length;

    console.log(`[QUEUE] Clearing queue: ${waitingJobs.length} waiting, ${activeJobs.length} active, ${delayedJobs.length} delayed jobs`);

    let clearedWaiting = 0;
    let clearedDelayed = 0;

    // Remove waiting jobs
    for (const job of waitingJobs) {
      try {
        await job.remove();
        clearedWaiting++;
      } catch (err) {
        console.error(`[QUEUE] Failed to remove waiting job ${job.id}:`, err);
      }
    }

    console.log(`[QUEUE] Skipped removing ${activeJobs.length} active jobs (still processing)`);

    // Remove delayed jobs
    for (const job of delayedJobs) {
      try {
        await job.remove();
        clearedDelayed++;
      } catch (err) {
        console.error(`[QUEUE] Failed to remove delayed job ${job.id}:`, err);
      }
    }

    // Get updated metrics
    const metrics = await collectMetrics();

    res.status(200).json({
      success: true,
      message: `Queue cleared: ${clearedWaiting + clearedDelayed} jobs removed (active jobs left running)`,
      jobsCleared: {
        waiting: clearedWaiting,
        active: 0, // kept running
        delayed: clearedDelayed,
        total: clearedWaiting + clearedDelayed
      },
      currentQueue: metrics.queue
    });
  } catch (err) {
    console.error("[ERROR] Failed to clear queue:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to clear queue"
    });
  }
});

// Clean up stale jobs in the database
router.post("/cleanup-jobs", async (req, res) => {
  try {
    // Clean up stale jobs in the database
    const cleanupResults = await db.cleanupStaleJobs();
    
    // Also clear any stale jobs from the queue
    const waitingJobs = await jobQueue.getWaiting();
    const activeJobs = await jobQueue.getActive();
    const delayedJobs = await jobQueue.getDelayed();
    
    // Count of jobs before clearing
    const totalQueueJobs = waitingJobs.length + activeJobs.length + delayedJobs.length;
    
    // Remove all jobs from queue to ensure sync with database
    for (const job of [...waitingJobs, ...activeJobs, ...delayedJobs]) {
      await job.remove();
    }
    
    // Get updated metrics
    const metrics = await collectMetrics();
    
    res.status(200).json({
      success: true,
      message: `Jobs cleaned up: ${cleanupResults.total} stale jobs in database, ${totalQueueJobs} jobs removed from queue`,
      cleanupResults: {
        database: cleanupResults,
        queue: {
          waiting: waitingJobs.length,
          active: activeJobs.length,
          delayed: delayedJobs.length,
          total: totalQueueJobs
        }
      },
      currentQueue: metrics.queue
    });
  } catch (err) {
    console.error("[ERROR] Failed to clean up jobs:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to clean up jobs"
    });
  }
});

export default router;
