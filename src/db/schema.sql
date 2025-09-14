-- Database schema for E6Data

-- Jobs table to track all job executions
CREATE TABLE IF NOT EXISTS jobs (
  id VARCHAR(50) PRIMARY KEY,
  submission_type VARCHAR(20) NOT NULL,
  git_link TEXT,
  raw_code TEXT,
  runtime VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL,
  memory_limit VARCHAR(20) NOT NULL,
  timeout INTEGER NOT NULL,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  duration INTEGER, -- in milliseconds
  exit_code INTEGER,
  submitted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Job logs table to store execution logs
CREATE TABLE IF NOT EXISTS job_logs (
  id SERIAL PRIMARY KEY,
  job_id VARCHAR(50) NOT NULL REFERENCES jobs(id),
  log_type VARCHAR(10) NOT NULL, -- stdout or stderr
  content TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- System metrics table to track resource usage
CREATE TABLE IF NOT EXISTS system_metrics (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  total_memory BIGINT NOT NULL, -- in bytes
  free_memory BIGINT NOT NULL, -- in bytes
  cpu_usage FLOAT NOT NULL, -- percentage
  active_containers INTEGER NOT NULL,
  queued_jobs INTEGER NOT NULL
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_submitted_at ON jobs(submitted_at);
CREATE INDEX IF NOT EXISTS idx_job_logs_job_id ON job_logs(job_id);
CREATE INDEX IF NOT EXISTS idx_system_metrics_timestamp ON system_metrics(timestamp);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ LANGUAGE 'plpgsql';

-- Create trigger to update updated_at timestamp
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'update_jobs_updated_at'
    ) THEN
        CREATE TRIGGER update_jobs_updated_at
        BEFORE UPDATE ON jobs
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column();
    END IF;
END;
$$;