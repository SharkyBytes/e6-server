import { exec, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { getRuntimeConfig, isWindows, DOCKER_CONFIG } from "./config.js";
import {
  queueLogUpdate,
  saveJobLogsToDatabase,
} from "../queue/status_queue.js";
import { publishJobLogs } from "../pubsub/redis_pubsub.js";

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
    env = {},
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

    if (submission_type === "custom_image" && docker_image) {
      console.log(`[DOCKER] Using custom Docker image: ${docker_image}`);
      dockerImage = docker_image;
      runtimeConfig = {
        ...DOCKER_CONFIG.runtimes.custom,
        image: docker_image,
      };
    } else {
      runtimeConfig = getRuntimeConfig(runtime);
      dockerImage = runtimeConfig.image;
      console.log(
        `[DOCKER] Using runtime ${runtime} with image: ${dockerImage}`
      );
    }

    // Increment active containers
    resourceManager.incrementContainers();

    // Prepare environment variables
    const envArgs = Object.entries(env)
      .map(([key, value]) => `--env ${key}=${value}`)
      .join(" ");

    // Prepare for raw code execution if needed
    if (submission_type === "raw_code" && raw_code) {
      // Get appropriate filename from runtime config
      const filename = runtimeConfig.fileName;

      // Write the raw code to a file
      const sourceFilePath = path.join(workDir, filename);
      await fs.writeFile(sourceFilePath, raw_code);
      console.log(`[INFO] Created source file for job ${jobId}: ${filename}`);

      // For raw code, create a simple package.json if it's a Node.js runtime and dependencies are provided
      if (runtime === "nodejs" && dependencies && dependencies.length > 0) {
        const packageJson = {
          name: `job-${jobId}`,
          version: "1.0.0",
          dependencies: {},
        };

        // Add dependencies to package.json
        dependencies.forEach((dep) => {
          packageJson.dependencies[dep] = "latest";
        });

        const packageJsonPath = path.join(workDir, "package.json");
        await fs.writeFile(
          packageJsonPath,
          JSON.stringify(packageJson, null, 2)
        );
        console.log(
          `[INFO] Created package.json for job ${jobId} with dependencies: ${dependencies.join(
            ", "
          )}`
        );
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
      dockerImage,
    });

    console.log(
      `[INFO] Running docker command for job ${jobId}:\n${dockerCmd}`
    );

    // Execute Docker command with streaming output and proper timeout handling
    const result = await executeDockerCommand(dockerCmd, jobId, timeout);

    return {
      status: "success",
      output: result.output,
      exitCode: result.exitCode,
    };
  } catch (error) {
    console.error(`[ERROR] Job ${jobId} failed:`, error);
    return {
      status: "error",
      error: error.message,
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
  dockerImage,
}) {
  if (isWindows) {
    // For Windows, use a different volume mount syntax
    if (submission_type === "raw_code") {
      // Raw code execution - only run initial_cmds if they're not the default npm install
      const shouldRunInitialCmds =
        initial_cmds &&
        initial_cmds.length > 0 &&
        !(initial_cmds.length === 1 && initial_cmds[0] === "npm install");

      const commandChain = shouldRunInitialCmds
        ? `${initial_cmds.join(" && ")} && ${build_cmd}`
        : build_cmd;

      return (
        `docker run --rm ` +
        `--name e6data-${jobId} ` +
        `--memory=${memory_limit} ` +
        `--workdir=/app ` +
        `-v "${workDir}:/app" ` +
        `${envArgs} ` +
        `${dockerImage} ` +
        `/bin/sh -c "${commandChain}"`
      );
    } else if (submission_type === "custom_image") {
      // Custom Docker image execution
      if (build_cmd && build_cmd !== "node index.js") {
        // If a custom build command is provided, use shell
        return (
          `docker run --rm ` +
          `--name e6data-${jobId} ` +
          `--memory=${memory_limit} ` +
          `--workdir=/app ` +
          `-v "${workDir}:/app" ` +
          `${envArgs} ` +
          `${dockerImage} ` +
          `/bin/sh -c "${build_cmd}"`
        );
      } else {
        // No custom command, let the image run its default command
        return (
          `docker run --rm ` +
          `--name e6data-${jobId} ` +
          `--memory=${memory_limit} ` +
          `${envArgs} ` +
          `${dockerImage}`
        );
      }
    } else {
      // Git repo execution
      return (
        `docker run --rm ` +
        `--name e6data-${jobId} ` +
        `--memory=${memory_limit} ` +
        `--workdir=/app ` +
        `-v "${workDir}:/app" ` +
        `${envArgs} ` +
        `${dockerImage} ` +
        `/bin/sh -c "git clone ${git_link} . && ` +
        `${start_directory ? `cd ${start_directory} && ` : ""}` +
        `${initial_cmds.join(" && ")} && ` +
        `${build_cmd}"`
      );
    }
  } else {
    // For Unix systems
    if (submission_type === "raw_code") {
      // Raw code execution - only run initial_cmds if they're not the default npm install
      const shouldRunInitialCmds =
        initial_cmds &&
        initial_cmds.length > 0 &&
        !(initial_cmds.length === 1 && initial_cmds[0] === "npm install");

      const commandChain = shouldRunInitialCmds
        ? `${initial_cmds.join(" && ")} && ${build_cmd}`
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
    } else if (submission_type === "custom_image") {
      // Custom Docker image execution
      if (build_cmd && build_cmd !== "node index.js") {
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
        ${start_directory ? `cd ${start_directory} && ` : ""} \
        ${initial_cmds.join(" && ")} && \
        ${build_cmd}"`;
    }
  }
}

/**
 * Parse a shell-style command string into tokens respecting single/double quotes.
 * This is a minimal parser suitable for turning long `docker run ...` strings
 * (with backslashes/newlines) into an array for spawn().
 *
 * Returns an array of tokens with quotes removed.
 */
function parseCommandString(cmdStr) {
  // normalize backslash-newline line continuations and collapse multiple spaces/newlines
  let normalized = cmdStr.replace(/\\\s*\n/g, " "); // remove backslash+newline used by multi-line strings
  normalized = normalized.replace(/\s+/g, " ").trim(); // collapse whitespace

  const tokens = [];
  const re =
    /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s'"]+)/g;
  let match;
  while ((match = re.exec(normalized)) !== null) {
    if (match[1] !== undefined) {
      // double-quoted token, unescape quotes/backslashes inside
      tokens.push(match[1].replace(/\\(.)/g, "$1"));
    } else if (match[2] !== undefined) {
      // single-quoted token
      tokens.push(match[2].replace(/\\(.)/g, "$1"));
    } else if (match[3] !== undefined) {
      tokens.push(match[3]);
    }
  }
  return tokens;
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
    if (!dockerCmd || typeof dockerCmd !== "string") {
      return reject(new Error("Invalid dockerCmd"));
    }

    // Decide whether this is a docker run invocation and can be spawned directly
    const trimmed = dockerCmd.trim();
    const isDockerInvocation = /^docker(\s|$)/i.test(trimmed);

    let proc;
    let spawnedDirectly = false;

    if (isDockerInvocation) {
      // Parse into tokens and spawn docker directly with args (no shell)
      const tokens = parseCommandString(trimmed);
      if (tokens.length === 0) {
        return reject(new Error("Failed to parse docker command"));
      }
      // first token should be 'docker'
      const [cmd, ...args] = tokens;
      try {
        proc = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
        spawnedDirectly = true;
        console.log(
          `[execute] Spawned docker directly: ${cmd} ${args.join(" ")}`
        );
      } catch (err) {
        return reject(err);
      }
    } else {
      // fallback: run via shell (preserves existing behavior for non-docker commands)
      if (isWindows) {
        proc = spawn("cmd", ["/c", dockerCmd], {
          stdio: ["ignore", "pipe", "pipe"],
        });
      } else {
        proc = spawn("sh", ["-c", dockerCmd], {
          stdio: ["ignore", "pipe", "pipe"],
        });
      }
      console.log(`[execute] Spawned shell for command`);
    }

    let output = "";
    let resolved = false;

    // Timeout: best-effort kill container and process
    const timeoutId = setTimeout(async () => {
      if (resolved) return;
      resolved = true;
      console.error(`[TIMEOUT] Job ${jobId} exceeded timeout of ${timeout}ms`);
      // best-effort: kill container by name (non-blocking)
      try {
        await execPromise(`docker kill e6data-${jobId} || true`);
        console.log(`[TIMEOUT] Issued docker kill for e6data-${jobId}`);
      } catch (err) {
        console.error(`[TIMEOUT] Error issuing docker kill: ${err.message}`);
      }
      try {
        proc.kill("SIGKILL");
      } catch (err) {
        /* ignore */
      }
      reject(new Error(`Execution timed out after ${timeout}ms`));
    }, timeout);

    // Stream stdout
    proc.stdout.on("data", async (data) => {
      const chunk = data.toString();
      output += chunk;
      const trimmedChunk = chunk.trim();
      if (trimmedChunk.length === 0) return;

      console.log(`[Job ${jobId} stdout] ${trimmedChunk}`);
      try {
        await queueLogUpdate(jobId, "stdout", trimmedChunk, false);
      } catch (err) {
        console.error(`[ERROR] queueLogUpdate stdout failed: ${err.message}`);
      }
      try {
        await publishJobLogs(jobId, "stdout", trimmedChunk);
      } catch (err) {
        console.error(`[ERROR] publishJobLogs stdout failed: ${err.message}`);
      }
    });

    // Stream stderr
    proc.stderr.on("data", async (data) => {
      const chunk = data.toString();
      output += chunk;
      const trimmedChunk = chunk.trim();
      if (trimmedChunk.length === 0) return;

      console.error(`[Job ${jobId} stderr] ${trimmedChunk}`);
      try {
        await queueLogUpdate(jobId, "stderr", trimmedChunk, false);
      } catch (err) {
        console.error(`[ERROR] queueLogUpdate stderr failed: ${err.message}`);
      }
      try {
        await publishJobLogs(jobId, "stderr", trimmedChunk);
      } catch (err) {
        console.error(`[ERROR] publishJobLogs stderr failed: ${err.message}`);
      }
    });

    proc.on("close", async (code) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);

      // Save all accumulated logs to database now that the job is complete
      try {
        console.log(
          `[DB] Saving all logs for job ${jobId} to database now that execution is complete`
        );
        await saveJobLogsToDatabase(jobId);
      } catch (error) {
        console.error(
          `[ERROR] Failed to save logs to database: ${error.message}`
        );
      }

      if (code === 0) {
        resolve({ output, exitCode: code });
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });

    proc.on("error", (err) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timeoutId);
      reject(err);
    });
  });
}
