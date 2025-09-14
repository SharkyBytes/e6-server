import { Queue, Worker, QueueEvents } from "bullmq";
import { redisInstance } from "../config/redis_config.js";

// Use the existing Redis instance with BullMQ options
const connection = redisInstance;

const job_queue = new Queue("job_queue", { connection,});

const dead_job_queue = new Queue("dead_job_queue",{
    connection})

export { job_queue,dead_job_queue };
