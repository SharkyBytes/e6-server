import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pgPool from '../config/postgres_config.js';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Initialize the database by running the schema.sql file
 */
export async function initializeDatabase() {
  try {
    // Read the schema file
    const schemaFile = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaFile, 'utf8');
    
    // Execute the schema
    await pgPool.query(schema);
    console.log('Database schema initialized successfully');
    
    return true;
  } catch (error) {
    console.error('Error initializing database schema:', error);
    return false;
  }
}

/**
 * Save job data to the database
 * @param {Object} job - The job object
 * @param {string} status - The job status
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
export async function saveJob(job, status) {
  try {
    const {
      id,
      data: {
        submission_type,
        git_link,
        raw_code,
        runtime,
        memory_limit,
        timeout,
        submitted_at
      }
    } = job;
    
    // Check if job already exists
    const checkResult = await pgPool.query(
      'SELECT id FROM jobs WHERE id = $1',
      [id]
    );
    
    if (checkResult.rows.length > 0) {
      // Update existing job
      await pgPool.query(
        `UPDATE jobs 
         SET status = $1, updated_at = NOW()
         WHERE id = $2`,
        [status, id]
      );
    } else {
      // Insert new job
      await pgPool.query(
        `INSERT INTO jobs 
         (id, submission_type, git_link, raw_code, runtime, status, memory_limit, timeout, submitted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id, 
          submission_type || 'git_repo',
          git_link || null,
          raw_code || null,
          runtime || 'nodejs',
          status,
          memory_limit || '512MB',
          timeout || 180000,
          new Date(submitted_at)
        ]
      );
    }
    
    return true;
  } catch (error) {
    console.error('Error saving job to database:', error);
    return false;
  }
}

/**
 * Update job status in the database
 * @param {string} jobId - The job ID
 * @param {string} status - The job status
 * @param {Object} [result] - Optional result object with exit code and duration
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
export async function updateJobStatus(jobId, status, result = {}) {
  try {
   
    const safeResult = result || {};
    const { exitCode, duration } = safeResult;
    
    // Start building our SQL query step by step
    let query = 'UPDATE jobs SET status = $1';
    const params = [status];
    
    // Add different fields based on the job status
    if (status === 'completed' || status === 'failed') {
      query += ', end_time = NOW()';
      
      // Add exit code if we have it
      if (exitCode !== undefined) {
        query += ', exit_code = $' + (params.length + 1);
        params.push(exitCode);
      }
      
      // Add duration if we have it
      if (duration !== undefined) {
        query += ', duration = $' + (params.length + 1);
        params.push(duration);
      }
    } else if (status === 'active') {
      query += ', start_time = NOW()';
    }
    
    // Add the WHERE clause to specify which job to update
    query += ' WHERE id = $' + (params.length + 1);
    params.push(jobId);
    
    // Execute the query
    await pgPool.query(query, params);
    return true;
  } catch (error) {
    console.error('Error updating job status in database:', error);
    return false;
  }
}

/**
 * Save job log to the database
 * @param {string} jobId - The job ID
 * @param {string} logType - The log type (stdout or stderr)
 * @param {string} content - The log content
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
export async function saveJobLog(jobId, logType, content) {
  try {
    await pgPool.query(
      'INSERT INTO job_logs (job_id, log_type, content) VALUES ($1, $2, $3)',
      [jobId, logType, content]
    );
    return true;
  } catch (error) {
    console.error('Error saving job log to database:', error);
    return false;
  }
}

/**
 * Save system metrics to the database
 * @param {Object} metrics - The system metrics
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
export async function saveSystemMetrics(metrics) {
  try {
    const {
      totalMemory,
      freeMemory,
      cpuUsage,
      activeContainers,
      queuedJobs
    } = metrics;
    
    await pgPool.query(
      `INSERT INTO system_metrics 
       (total_memory, free_memory, cpu_usage, active_containers, queued_jobs)
       VALUES ($1, $2, $3, $4, $5)`,
      [totalMemory, freeMemory, cpuUsage, activeContainers, queuedJobs]
    );
    return true;
  } catch (error) {
    console.error('Error saving system metrics to database:', error);
    return false;
  }
}

/**
 * Get job statistics
 * @returns {Promise<Object>} - Job statistics
 */
export async function getJobStatistics() {
  try {
    const result = await pgPool.query(`
      SELECT 
        COUNT(*) AS total_jobs,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_jobs,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_jobs,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_jobs,
        SUM(CASE WHEN status = 'waiting' OR status = 'delayed' THEN 1 ELSE 0 END) AS queued_jobs,
        AVG(CASE WHEN duration IS NOT NULL THEN duration ELSE NULL END) AS avg_duration
      FROM jobs
    `);
    
    return result.rows[0];
  } catch (error) {
    console.error('Error getting job statistics from database:', error);
    return {
      total_jobs: 0,
      completed_jobs: 0,
      failed_jobs: 0,
      active_jobs: 0,
      queued_jobs: 0,
      avg_duration: 0
    };
  }
}

/**
 * Get latest system metrics
 * @returns {Promise<Object>} - Latest system metrics
 */
export async function getLatestSystemMetrics() {
  try {
    const result = await pgPool.query(`
      SELECT * FROM system_metrics
      ORDER BY timestamp DESC
      LIMIT 1
    `);
    
    return result.rows[0] || null;
  } catch (error) {
    console.error('Error getting latest system metrics from database:', error);
    return null;
  }
}

export default {
  pool: pgPool,
  initializeDatabase,
  saveJob,
  updateJobStatus,
  saveJobLog,
  saveSystemMetrics,
  getJobStatistics,
  getLatestSystemMetrics
};
