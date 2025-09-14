import Redis from 'ioredis';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Hardcoded Redis configuration
const redisConfig = {
  port: 6379,
  host: "10.147.201.102",
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy: (times) => {
    // Retry connection with exponential backoff
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

console.log(`Connecting to Redis at ${redisConfig.host}:${redisConfig.port}`);

// Create a Redis instance with the config
const redisInstance = new Redis(redisConfig);

// Handle connection events
redisInstance.on('connect', () => {
  console.log('Successfully connected to Redis');
});

redisInstance.on('error', (err) => {
  console.error('Redis connection error:', err);
});

// Export the Redis connection string for BullMQ
export const redis_connection_string = `redis://${redisConfig.host}:${redisConfig.port}`;

// Export the Redis instance and config
export { redisInstance, redisConfig };