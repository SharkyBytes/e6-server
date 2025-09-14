import Redis from 'ioredis';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Redis configuration using environment variables
const redisConfig = {
  port: process.env.REDIS_PORT || 6379,
  host: process.env.REDIS_HOST || "127.0.0.1",
  retryStrategy: (times) => {
    // Retry connection with exponential backoff
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
};

console.log(`Connecting to Redis at ${redisConfig.host}:${redisConfig.port}`);
export const redis_connection_string = new Redis(redisConfig);

// Handle connection events
redis_connection_string.on('connect', () => {
  console.log('Successfully connected to Redis');
});

redis_connection_string.on('error', (err) => {
  console.error('Redis connection error:', err);
});