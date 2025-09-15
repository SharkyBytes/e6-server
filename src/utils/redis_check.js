import { redisInstance } from '../config/redis_config.js';

/**
 * Check if Redis is available
 */
export async function checkRedisConnection() {
  try {
    await redisInstance.ping();
    return true;
  } catch (error) {
    console.warn('Redis not available:', error.message);
    return false;
  }
}

/**
 * Get Redis status for health checks
 */
export async function getRedisStatus() {
  try {
    const pong = await redisInstance.ping();
    return {
      status: 'connected',
      response: pong,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'disconnected',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
}