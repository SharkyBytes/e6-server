import { Router } from "express";
import { jobQueue, QUEUE_CONFIG } from "../queue/index.js";
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Handle both GET and POST requests
const handleSubmit = async (req, res) => {
    try {
        // Get data from either query params (GET) or request body (POST)
        const data = req.method === 'GET' ? req.query : req.body;
        
        // Parse the data properly
        const git_link = data.git_link;
        const raw_code = data.raw_code;
        const dependencies = data.dependencies || [];
        const start_directory = data.start_directory || "";
        const initial_cmds = Array.isArray(data.initial_cmds) 
            ? data.initial_cmds 
            : (data.initial_cmds ? [data.initial_cmds] : ["npm install"]);
        const env_file = data.env_file; // Optional, no default
        const build_cmd = data.build_cmd || "node index.js";
        const memory_limit = data.memory_limit || "512MB";
        // Parse timeout with a maximum of 5 minutes (300000ms)
        let timeout = parseInt(data.timeout) || 180000;
        const MAX_TIMEOUT = 300000; // 300 second maximum
        
        // Validate timeout
        if (timeout > MAX_TIMEOUT) {
            return res.status(400).json({
                success: false,
                error: `Timeout cannot exceed ${MAX_TIMEOUT/1000} seconds `
            });
        }
        
        // Get runtime and Docker image options
        const runtime = data.runtime || "nodejs";
        const custom_docker_image = data.docker_image || null;
        const env = data.env || {};
        
        // Determine submission type and validate required fields
        const isRawCode = raw_code && raw_code.trim().length > 0;
        const isGitRepo = git_link && git_link.trim().length > 0;
        const isDockerImage = custom_docker_image && custom_docker_image.trim().length > 0;
        
        if (!isRawCode && !isGitRepo && !isDockerImage) {
            return res.status(400).json({ 
                success: false, 
                error: "Either GitHub repository URL, raw code, or Docker image is required" 
            });
        }
        
        // Validate runtime for raw code submissions
        if (isRawCode && !custom_docker_image) {
            const supportedRuntimes = Object.keys(QUEUE_CONFIG.runtimes);
            if (!supportedRuntimes.includes(runtime)) {
                return res.status(400).json({
                    success: false,
                    error: `Runtime '${runtime}' is not supported for raw code execution. Supported runtimes: ${supportedRuntimes.join(', ')}`
                });
            }
        }

        // Generate a unique job ID (ensure it's a string with a letter prefix)
        const jobId = 'job_' + uuidv4().substring(0, 8);

        // Determine submission type
        let submission_type = 'git_repo';
        if (isRawCode) {
            submission_type = 'raw_code';
        } else if (custom_docker_image) {
            submission_type = 'custom_image';
        }
        
        // Create job payload
        const jobPayload = {
            submission_type,
            start_directory,
            memory_limit,
            timeout,
            runtime,
            submitted_at: new Date().toISOString(),
            env
        };
        
        // Add custom Docker image if provided
        if (custom_docker_image) {
            jobPayload.docker_image = custom_docker_image;
            console.log(`[INFO] Using custom Docker image: ${custom_docker_image}`);
        }
        
        // Add submission-specific fields
        if (submission_type === 'raw_code') {
            jobPayload.raw_code = raw_code;
            jobPayload.dependencies = dependencies;
            
            // Set appropriate build command based on runtime if not provided
            if (!data.build_cmd) {
                switch(runtime) {
                    case 'nodejs':
                        jobPayload.build_cmd = 'node code.js';
                        break;
                    case 'python':
                        jobPayload.build_cmd = 'python code.py';
                        break;
                    case 'java':
                        jobPayload.build_cmd = 'javac Main.java && java Main';
                        break;
                    case 'cpp':
                        jobPayload.build_cmd = 'g++ -o program code.cpp && ./program';
                        break;
                    default:
                        jobPayload.build_cmd = build_cmd;
                }
            } else {
                jobPayload.build_cmd = build_cmd;
            }
            
            // Adjust initial commands based on dependencies
            if (dependencies && dependencies.length > 0) {
                switch(runtime) {
                    case 'nodejs':
                        jobPayload.initial_cmds = [`npm install ${dependencies.join(' ')}`];
                        break;
                    case 'python':
                        jobPayload.initial_cmds = [`pip install ${dependencies.join(' ')}`];
                        break;
                    default:
                        jobPayload.initial_cmds = initial_cmds;
                }
            } else {
                jobPayload.initial_cmds = initial_cmds;
            }
        } else {
            // Git repo submission
            jobPayload.git_link = git_link;
            jobPayload.initial_cmds = initial_cmds;
            jobPayload.build_cmd = build_cmd;
        }
        
        // Only add env_file if it's provided
        if (env_file) {
            jobPayload.env_file = env_file;
        }

        console.log(`[INFO] Submitting job: ${jobId}`);
        
        try {
            // Add job to queue
            const job = await jobQueue.add('process-repo', jobPayload, {
                jobId,
                attempts: QUEUE_CONFIG.retryAttempts,
                backoff: {
                    type: QUEUE_CONFIG.retryBackoffType,
                    delay: QUEUE_CONFIG.retryBackoffDelay
                },
                removeOnComplete: QUEUE_CONFIG.removeOnComplete,
                removeOnFail: QUEUE_CONFIG.removeOnFail
            });

            console.log(`[SUCCESS] Job added to queue with ID: ${job.id}`);
            
            // Immediately save job to database to avoid "job not found" issues
            try {
                await db.saveJob(job, 'waiting');
                console.log(`[SUCCESS] Job ${job.id} saved to database`);
            } catch (dbError) {
                console.error(`[ERROR] Failed to save job to database: ${dbError.message}`);
                // Don't fail the request if database save fails
            }

            res.status(200).json({
                success: true,
                jobId: job.id,
                message: "Job submitted successfully",
                status: "queued"
            });
        } catch (queueError) {
            console.error('[ERROR] Queue error:', queueError);
            
            // If Redis/Queue is not available, still accept the job but save to database
            console.log('[FALLBACK] Redis not available, saving job to database only');
            
            try {
                // Create a minimal job object for database storage
                const fallbackJob = {
                    id: jobId,
                    data: jobPayload,
                    timestamp: Date.now()
                };
                
                await db.saveJob(fallbackJob, 'pending');
                console.log(`[SUCCESS] Fallback job ${jobId} saved to database`);
            } catch (dbError) {
                console.error(`[ERROR] Failed to save fallback job to database: ${dbError.message}`);
            }
            
            res.status(200).json({
                success: true,
                jobId: jobId,
                message: "Job submitted successfully (Redis unavailable - job will be processed when Redis is available)",
                status: "pending"
            });
        }
    } catch (err) {
        console.error("[ERROR] Failed to submit job:", err);
        res.status(500).json({
            success: false,
            error: err.message || "Failed to submit job"
        });
    }
};

// Register both GET and POST handlers
router.get("/", handleSubmit);
router.post("/", handleSubmit);

export default router;