import { Router } from "express";
import { getLatestMetrics } from "../monitoring/system_metrics.js";
import db from "../db/index.js";
import { jobQueue } from "../queue/index.js";

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

export default router;
