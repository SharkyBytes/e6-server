import IORedis from "ioredis";
import { Queue, Worker, QueueEvents } from "bullmq";
import { redis_connection_string } from "../config/redis_config.js";

const connection = new IORedis(redis_connection_string, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

const job_queue = new Queue("job_queue", { connection,});

const dead_job_queue = new Queue("dead_job_queue",{
    connection})

export { job_queue,dead_job_queue };
