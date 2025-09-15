import { Router } from "express";
import { jobQueue } from "../queue/index.js";
import { calculateJobCost, calculateCostSavings } from '../utils/cost_calculator.js';
import db from "../db/index.js";

const router = Router();

// Get job status
router.get("/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // First try to get job from queue
    let job = await jobQueue.getJob(jobId);
    let fromDatabase = false;
    
    if (!job) {
      // If not found in queue, check database as fallback
      try {
        const dbJob = await db.pool.query(
          'SELECT * FROM jobs WHERE job_id = $1',
          [jobId]
        );
        
        if (dbJob.rows.length > 0) {
          const dbJobData = dbJob.rows[0];
          fromDatabase = true;
          
          // Create a job-like object from database data
          job = {
            id: dbJobData.job_id,
            data: {
              git_link: dbJobData.git_link,
              raw_code: dbJobData.raw_code,
              docker_image: dbJobData.docker_image,
              runtime: dbJobData.runtime,
              memory_limit: dbJobData.memory_limit,
              timeout: dbJobData.timeout,
              submission_type: dbJobData.submission_type,
              submitted_at: dbJobData.submitted_at
            },
            timestamp: new Date(dbJobData.submitted_at).getTime(),
            processedOn: dbJobData.start_time ? new Date(dbJobData.start_time).getTime() : null,
            finishedOn: dbJobData.end_time ? new Date(dbJobData.end_time).getTime() : null,
            returnvalue: dbJobData.result ? JSON.parse(dbJobData.result) : null
          };
        }
      } catch (dbError) {
        console.error("[ERROR] Failed to check database for job:", dbError);
      }
    }
    
    if (!job) {
      return res.status(404).json({ 
        success: false, 
        error: "Job not found" 
      });
    }
    
    // Get job state
    let state;
    if (fromDatabase) {
      // Determine state from database data
      const dbJobData = await db.pool.query(
        'SELECT status FROM jobs WHERE job_id = $1',
        [jobId]
      );
      state = dbJobData.rows[0]?.status || 'waiting';
    } else {
      state = await job.getState();
    }
    
    const result = job.returnvalue;
    
    // Add cost calculation for completed or failed jobs
    let costInfo = null;
    if (state === 'completed' || state === 'failed') {
      costInfo = {
        cost: calculateJobCost(job),
        savings: calculateCostSavings(job)
      };
    }
    
    res.status(200).json({
      success: true,
      jobId: job.id,
      status: state,
      data: job.data,
      result: result || null,
      progress: job.progress || 0,
      createdAt: job.timestamp,
      processedAt: job.processedOn,
      finishedAt: job.finishedOn,
      costInfo: costInfo,
      source: fromDatabase ? 'database' : 'queue'
    });
  } catch (err) {
    console.error("[ERROR] Failed to get job status:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to get job status"
    });
  }
});

// Get job history
router.get("/", async (req, res) => {
  try {
    const jobs = await jobQueue.getJobs(['completed', 'failed', 'active', 'waiting', 'delayed']);
    
    const jobsData = await Promise.all(jobs.map(async (job) => {
      const state = await job.getState();
      return {
        jobId: job.id,
        status: state,
        data: {
          git_link: job.data.git_link,
          runtime: job.data.runtime,
          submitted_at: job.data.submitted_at
        },
        createdAt: job.timestamp,
        processedAt: job.processedOn,
        finishedAt: job.finishedOn
      };
    }));
    
    res.status(200).json({
      success: true,
      jobs: jobsData
    });
  } catch (err) {
    console.error("[ERROR] Failed to get job history:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to get job history"
    });
  }
});

// Get job logs
router.get("/:jobId/logs", async (req, res) => {
  try {
    const { jobId } = req.params;
    
    // Check if job exists
    const job = await jobQueue.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({ 
        success: false, 
        error: "Job not found" 
      });
    }
    
    // Fetch logs from database
    const logs = await db.pool.query(
      'SELECT log_type, content, timestamp FROM job_logs WHERE job_id = $1 ORDER BY timestamp ASC',
      [jobId]
    );
    
    // Format logs for frontend
    const formattedLogs = logs.rows.map(log => ({
      jobId,
      type: log.log_type,
      data: log.content,
      timestamp: log.timestamp
    }));
    
    res.status(200).json({
      success: true,
      jobId,
      logs: formattedLogs
    });
  } catch (err) {
    console.error("[ERROR] Failed to get job logs:", err);
    res.status(500).json({
      success: false,
      error: err.message || "Failed to get job logs"
    });
  }
});

export default router;
