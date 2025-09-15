import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import { getRuntimeConfig, isWindows, DOCKER_CONFIG } from './config.js';
import { queueLogUpdate, saveJobLogsToDatabase } from '../queue/status_queue.js';
import { publishJobLogs } from '../pubsub/redis_pubsub.js';

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
    
    // Prepare for raw code execution if needed
    if (submission_type === 'raw_code' && raw_code) {
      // Get appropriate filename from runtime config
      const filename = runtimeConfig.fileName;
      
      // Write the raw code to a file
      const sourceFilePath = path.join(workDir, filename);
      await fs.writeFile(sourceFilePath, raw_code);
      console.log(`[INFO] Created source file for job ${jobId}: ${filename}`);
      
      // For raw code, create a simple package.json if it's a Node.js runtime and dependencies are provided
      if (runtime === 'nodejs' && dependencies && dependencies.length > 0) {
        const packageJson = {
          name: `job-${jobId}`,
          version: "1.0.0",
          dependencies: {}
        };
        
        // Add dependencies to package.json
        dependencies.forEach(dep => {
          packageJson.dependencies[dep] = "latest";
        });
        
        const packageJsonPath = path.join(workDir, 'package.json');
        await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
        console.log(`[INFO] Created package.json for job ${jobId} with dependencies: ${dependencies.join(', ')}`);
      }
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
      await execPromise(`docker rm -f e6data-${jobId} || true`);
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
      // Raw code execution - only run initial_cmds if they're not the default npm install
      const shouldRunInitialCmds = initial_cmds && 
        initial_cmds.length > 0 && 
        !(initial_cmds.length === 1 && initial_cmds[0] === 'npm install');
      
      const commandChain = shouldRunInitialCmds 
        ? `${initial_cmds.join(' && ')} && ${build_cmd}`
        : build_cmd;
      
      return `docker run --rm ` +
        `--name e6data-${jobId} ` +
        `--memory=${memory_limit} ` +
        `--workdir=/app ` +
        `-v "${workDir}:/app" ` +
        `${envArgs} ` +
        `${dockerImage} ` +
        `/bin/sh -c "${commandChain}"`;
    } else if (submission_type === 'custom_image') {
      // Custom Docker image execution
      if (build_cmd && build_cmd !== 'node index.js') {
        // If a custom build command is provided, use shell
        return `docker run --rm ` +
          `--name e6data-${jobId} ` +
          `--memory=${memory_limit} ` +
          `--workdir=/app ` +
          `-v "${workDir}:/app" ` +
          `${envArgs} ` +
          `${dockerImage} ` +
          `/bin/sh -c "${build_cmd}"`;
      } else {
        // No custom command, let the image run its default command
        return `docker run --rm ` +
          `--name e6data-${jobId} ` +
          `--memory=${memory_limit} ` +
          `${envArgs} ` +
          `${dockerImage}`;
      }
    } else {
      // Git repo execution
      return `docker run --rm ` +
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
      // Raw code execution - only run initial_cmds if they're not the default npm install
      const shouldRunInitialCmds = initial_cmds && 
        initial_cmds.length > 0 && 
        !(initial_cmds.length === 1 && initial_cmds[0] === 'npm install');
      
      const commandChain = shouldRunInitialCmds 
        ? `${initial_cmds.join(' && ')} && ${build_cmd}`
        : build_cmd;
      
      return `docker run --rm \
        --name e6data-${jobId} \
        --memory=${memory_limit} \
        --network=host \
        --workdir=/app \
        -v ${workDir}:/app \
        ${envArgs} \
        ${dockerImage} \
        /bin/sh -c "${commandChain}"`;
    } else if (submission_type === 'custom_image') {
      // Custom Docker image execution
      if (build_cmd && build_cmd !== 'node index.js') {
        // If a custom build command is provided, use shell
        return `docker run --rm \
          --name e6data-${jobId} \
          --memory=${memory_limit} \
          --network=host \
          --workdir=/app \
          -v ${workDir}:/app \
          ${envArgs} \
          ${dockerImage} \
          /bin/sh -c "${build_cmd}"`;
      } else {
        // No custom command, let the image run its default command
        return `docker run --rm \
          --name e6data-${jobId} \
          --memory=${memory_limit} \
          --network=host \
          ${envArgs} \
          ${dockerImage}`;
      }
    } else {
      // Git repo execution
      return `docker run --rm \
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
        exec(`docker kill e6data-${jobId}`);
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
        
        // Only publish to Redis (which will then emit to WebSocket via pubsub)
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
        
        // Only publish to Redis (which will then emit to WebSocket via pubsub)
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
