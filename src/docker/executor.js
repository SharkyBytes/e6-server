import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { getRuntimeConfig, isWindows } from './config.js';
import { queueLogUpdate, saveJobLogsToDatabase } from '../queue/status_queue.js';
import { publishJobLogs } from '../pubsub/redis_pubsub.js';
import { DOCKER_CONFIG, } from './config.js';

const execPromise = promisify(exec);

/**
 * Run a job in a Docker container
 * @param {Object} job - The job object from BullMQ
 * @param {string} workspaceDir - The workspace directory path
 * @param {Object} resourceManager - The resource manager instance
 * @returns {Promise<Object>} The execution result
 */
export async function runJobInContainer(job, workspaceDir, resourceManager) {
  const { 
    submission_type = "git_repo",
    git_link, 
    raw_code,
    dependencies = [],
    start_directory = "", 
    initial_cmds = ["npm install"], 
    env_file, 
    build_cmd = "node index.js",
    memory_limit = "512MB",
    timeout = 300000,
    runtime = "nodejs",
    docker_image = null,
    env = {}
  } = job.data;
  
  const jobId = job.id;
  const workDir = path.join(workspaceDir, jobId);
  
  try {
    // Create job directory
    await fs.mkdir(workDir, { recursive: true });
    console.log(`Created workspace for job ${jobId} at ${workDir}`);
    
    // Get runtime configuration or use custom Docker image
    let dockerImage;
    let runtimeConfig;
    
    if (submission_type === 'custom_image' && docker_image) {
      console.log(`[DOCKER] Using custom Docker image: ${docker_image}`);
      dockerImage = docker_image;
      runtimeConfig = {
        ...DOCKER_CONFIG.runtimes.custom,
        image: docker_image
      };
    } else {
      runtimeConfig = getRuntimeConfig(runtime);
      dockerImage = runtimeConfig.image;
      console.log(`[DOCKER] Using runtime ${runtime} with image: ${dockerImage}`);
    }
    
    // Increment active containers
    resourceManager.incrementContainers();
    
    // Prepare environment variables
    const envArgs = Object.entries(env).map(([key, value]) => `--env ${key}=${value}`).join(' ');
    
    // Format the path for Docker volume mounting (handle Windows paths)
    let formattedWorkDir = workDir;
    
    if (isWindows) {
      // Convert Windows path to Docker-compatible path (e.g., C:\path\to\dir -> /c/path/to/dir)
      formattedWorkDir = workDir
        .replace(/\\/g, '/')
        .replace(/^([A-Z]):/, (_, drive) => `/${drive.toLowerCase()}`);
    }
    
    // Prepare for raw code execution if needed
    if (submission_type === 'raw_code' && raw_code) {
      // Get appropriate filename from runtime config
      const filename = runtimeConfig.fileName;
      
      // Write the raw code to a file
      const sourceFilePath = path.join(workDir, filename);
      await fs.writeFile(sourceFilePath, raw_code);
      console.log(`[INFO] Created source file for job ${jobId}: ${filename}`);
    }
    
    // Build the Docker command
    let dockerCmd = buildDockerCommand({
      jobId,
      submission_type,
      git_link,
      start_directory,
      initial_cmds,
      build_cmd,
      memory_limit,
      workDir,
      envArgs,
      dockerImage
    });
    
    console.log(`[INFO] Running docker command for job ${jobId}:\n${dockerCmd}`);
    
    // Execute Docker command with streaming output and proper timeout handling
    const result = await executeDockerCommand(dockerCmd, jobId, timeout);
    
    return {
      status: 'success',
      output: result.output,
      exitCode: result.exitCode
    };
  } catch (error) {
    console.error(`[ERROR] Job ${jobId} failed:`, error);
    return {
      status: 'error',
      error: error.message
    };
  } finally {
    // Clean up and decrement active containers
    try {
      // Force remove container if it's still running
      await execPromise(`sudo docker rm -f e6data-${jobId} || true`);
      console.log(`[INFO] Removed container for job ${jobId}`);
      
      // Clean up workspace
      await fs.rm(workDir, { recursive: true, force: true });
      console.log(`[INFO] Cleaned up workspace for job ${jobId}`);
    } catch (cleanupError) {
      console.error(`[ERROR] Cleanup for job ${jobId} failed:`, cleanupError);
    }
    
    // Decrement active containers
    resourceManager.decrementContainers();
  }
}

/**
 * Build Docker command based on job parameters
 * @param {Object} params - Command parameters
 * @returns {string} The Docker command
 */
function buildDockerCommand({
  jobId,
  submission_type,
  git_link,
  start_directory,
  initial_cmds,
  build_cmd,
  memory_limit,
  workDir,
  envArgs,
  dockerImage
}) {
  if (isWindows) {
    // For Windows, use a different volume mount syntax
    if (submission_type === 'raw_code') {
      // Raw code execution
      return `sudo docker run --rm ` +
        `--name e6data-${jobId} ` +
        `--memory=${memory_limit} ` +
        `--workdir=/app ` +
        `-v "${workDir}:/app" ` +
        `${envArgs} ` +
        `${dockerImage} ` +
        `/bin/sh -c "${initial_cmds.join(' && ')} && ` +
        `${build_cmd}"`;
    } else {
      // Git repo execution
      return `sudo docker run --rm ` +
        `--name e6data-${jobId} ` +
        `--memory=${memory_limit} ` +
        `--workdir=/app ` +
        `-v "${workDir}:/app" ` +
        `${envArgs} ` +
        `${dockerImage} ` +
        `/bin/sh -c "git clone ${git_link} . && ` +
        `${start_directory ? `cd ${start_directory} && ` : ''}` +
        `${initial_cmds.join(' && ')} && ` +
        `${build_cmd}"`;
    }
  } else {
    // For Unix systems
    if (submission_type === 'raw_code') {
      // Raw code execution
      return `sudo docker run --rm \
        --name e6data-${jobId} \
        --memory=${memory_limit} \
        --network=host \
        --workdir=/app \
        -v ${workDir}:/app \
        ${envArgs} \
        ${dockerImage} \
        /bin/sh -c "${initial_cmds.join(' && ')} && \
        ${build_cmd}"`;
    } else {
      // Git repo execution
      return `sudo docker run --rm \
        --name e6data-${jobId} \
        --memory=${memory_limit} \
        --network=host \
        --workdir=/app \
        -v ${workDir}:/app \
        ${envArgs} \
        ${dockerImage} \
        /bin/sh -c "git clone ${git_link} . && \
        ${start_directory ? `cd ${start_directory} && ` : ''} \
        ${initial_cmds.join(' && ')} && \
        ${build_cmd}"`;
    }
  }
}

/**
 * Execute Docker command with timeout
 * @param {string} dockerCmd - The Docker command to execute
 * @param {string} jobId - The job ID
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} The execution result
 */
async function executeDockerCommand(dockerCmd, jobId, timeout) {
  return new Promise((resolve, reject) => {
    // Use cmd.exe on Windows and sh on Unix-like systems
    const process = isWindows 
      ? spawn('cmd', ['/c', dockerCmd], { shell: true })
      : spawn('sh', ['-c', dockerCmd], { shell: true });
    let output = '';
    
    // Set timeout that will kill the process
    const timeoutId = setTimeout(() => {
      console.log(`[TIMEOUT] Job ${jobId} exceeded timeout of ${timeout}ms`);
      // Kill the process
      if (isWindows) {
        // On Windows, we need to kill the Docker container directly
        exec(`sudo docker kill e6data-${jobId}`);
      } else {
        process.kill('SIGTERM');
      }
      reject(new Error(`Execution timed out after ${timeout}ms`));
    }, timeout);
    
      process.stdout.on('data', async (data) => {
        const chunk = data.toString();
        output += chunk;
        const trimmedChunk = chunk.trim();
        console.log(`[Job ${jobId}] ${trimmedChunk}`);
        
        // Emit the output to WebSocket
        if (global.io) {
          global.io.to(`job-${jobId}`).emit('log', {
            jobId,
            type: 'stdout',
            data: trimmedChunk
          });
        }
        
        // Only publish to Redis, don't save to DB yet
        try {
          // Store in memory only, don't save to DB
          await queueLogUpdate(jobId, 'stdout', trimmedChunk, false);
          await publishJobLogs(jobId, 'stdout', trimmedChunk);
        } catch (error) {
          console.error(`[ERROR] Failed to queue/publish log update: ${error.message}`);
        }
      });
      
      process.stderr.on('data', async (data) => {
        const chunk = data.toString();
        output += chunk;
        const trimmedChunk = chunk.trim();
        console.error(`[Job ${jobId}] ${trimmedChunk}`);
        
        // Emit the error to WebSocket
        if (global.io) {
          global.io.to(`job-${jobId}`).emit('log', {
            jobId,
            type: 'stderr',
            data: trimmedChunk
          });
        }
        
        // Only publish to Redis, don't save to DB yet
        try {
          // Store in memory only, don't save to DB
          await queueLogUpdate(jobId, 'stderr', trimmedChunk, false);
          await publishJobLogs(jobId, 'stderr', trimmedChunk);
        } catch (error) {
          console.error(`[ERROR] Failed to queue/publish log update: ${error.message}`);
        }
      });
    
    process.on('close', async (code) => {
      // Clear the timeout since the process has completed
      clearTimeout(timeoutId);
      
      // Save all accumulated logs to database now that the job is complete
      try {
        console.log(`[DB] Saving all logs for job ${jobId} to database now that execution is complete`);
        await saveJobLogsToDatabase(jobId);
      } catch (error) {
        console.error(`[ERROR] Failed to save logs to database: ${error.message}`);
      }
      
      if (code === 0) {
        resolve({ output, exitCode: code });
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
    
    process.on('error', (err) => {
      // Clear the timeout on error
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}
