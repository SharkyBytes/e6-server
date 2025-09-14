import { Router } from "express";
import { jobQueue } from "../queue/index.js";
import { calculateJobCost, calculateCostSavings } from '../utils/cost_calculator.js';

const router = Router();

// Get job status
router.get("/:jobId", async (req, res) => {
  try {
    const { jobId } = req.params;
    const job = await jobQueue.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({ 
        success: false, 
        error: "Job not found" 
      });
    }
    
    const state = await job.getState();
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
      costInfo: costInfo
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

export default router;
