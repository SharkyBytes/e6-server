import Redis from 'ioredis'

const redisConfig = {
  port: 6379,
  host: "127.0.0.1",
};
export const redis_connection_string = new Redis(redisConfig);

// console.log(redis_connection_string)