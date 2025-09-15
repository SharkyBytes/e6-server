// Import all the packages we need
import express from "express";
import cors from "cors";
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';

// Import our custom route handlers
import submitRouter from './routes/submit.js';
import jobsRouter from './routes/jobs.js';
import metricsRouter from './routes/metrics.js';

// Import background services
import { startMetricsCollection } from './monitoring/system_metrics.js';
import { initializeDatabase } from './db/index.js';
import { createDatabaseIfNotExists } from './db/create_database.js';
import { initPubSub } from './pubsub/redis_pubsub.js';

// Load environment variables from .env file
dotenv.config();

// Create our Express app
const app = express();

// Add middleware (these run before our routes)
app.use(cors()); // Allow requests from other domains
app.use(express.json()); // Parse JSON request bodies

// Set up our API routes
app.use("/api/submit", submitRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/metrics", metricsRouter);

// Simple health check endpoint - useful for testing if server is running
app.get("/health", async (_req, res) => {
  try {
    const { getRedisStatus } = await import('./utils/redis_check.js');
    const redisStatus = await getRedisStatus();

    res.status(200).json({
      status: "ok",
      message: "Server is running",
      timestamp: new Date().toISOString(),
      redis: redisStatus
    });
  } catch (error) {
    res.status(200).json({
      status: "ok",
      message: "Server is running",
      timestamp: new Date().toISOString(),
      redis: { status: 'unknown', error: error.message }
    });
  }
});

// Get the port from environment variables, or use 5000 as default
const PORT = process.env.PORT || 5000;

// Create HTTP server (needed for Socket.io)
const httpServer = createServer(app);

// Create Socket.io server for real-time communication
const io = new Server(httpServer, {
  cors: {
    origin: "*", // Allow connections from any domain (for development)
    methods: ["GET", "POST"]
  }
});

// Handle Socket.io connections
io.on('connection', (socket) => {
  console.log('A client connected to Socket.io');

  // When client wants to get updates for a specific job
  socket.on('subscribe', (jobId) => {
    console.log(`Client subscribed to job updates: ${jobId}`);
    socket.join(`job-${jobId}`); // Join a room for this job
  });

  // When client no longer wants updates for a job
  socket.on('unsubscribe', (jobId) => {
    console.log(`Client unsubscribed from job: ${jobId}`);
    socket.leave(`job-${jobId}`); // Leave the room
  });

  // When client disconnects
  socket.on('disconnect', () => {
    console.log('A client disconnected from Socket.io');
  });
});

// Make Socket.io available to other parts of our app
global.io = io;

// Initialize Redis pub/sub for real-time updates
initPubSub(io);

// Start the server initialization process
async function startServer() {
  try {
    console.log('Starting server initialization...');

    // Step 1: Create database if it doesn't exist
    console.log('Step 1: Checking database...');
    const dbCreated = await createDatabaseIfNotExists();
    if (!dbCreated) {
      console.error('❌ Failed to create database. Exiting...');
      process.exit(1);
    }
    console.log('✅ Database ready');

    // Step 2: Initialize database schema (create tables)
    console.log('Step 2: Setting up database tables...');
    const initialized = await initializeDatabase();
    if (!initialized) {
      console.warn('⚠️  Database schema initialization had issues, but continuing...');
    } else {
      console.log('✅ Database tables ready');
    }

    // Step 3: Initialize resource manager
    console.log('Step 3: Initializing resource manager...');
    try {
      const { resourceManager } = await import('./queue/resource_manager.js');
      await resourceManager.initialize();
      console.log('✅ Resource manager initialized');
    } catch (error) {
      console.warn('⚠️  Resource manager initialization failed, continuing...', error.message);
    }

    // Step 4: Start background services
    console.log('Step 4: Starting background services...');
    try {
      startMetricsCollection();
      console.log('✅ Background services started');
      
      // Test metrics collection after a short delay
      setTimeout(async () => {
        try {
          const { getLatestMetrics } = await import('./monitoring/system_metrics.js');
          const metrics = getLatestMetrics();
          if (metrics) {
            console.log('✅ Metrics collection working - CPU:', metrics.cpu.usage + '%', 'Memory:', metrics.memory.percentUsed + '%');
          } else {
            console.log('⚠️  No metrics available yet, still collecting...');
          }
        } catch (error) {
          console.error('❌ Metrics test failed:', error.message);
        }
      }, 2000);
    } catch (error) {
      console.error('❌ Failed to start background services:', error.message);
    }

    // Step 5: Start the HTTP server
    console.log('Step 5: Starting HTTP server...');

    // Try to start server with error handling
    httpServer.listen(PORT, 'localhost', () => {
      console.log('\n🚀 Server is running successfully!');
      console.log(`� Serverl URL: http://localhost:${PORT}`);
      console.log(`🏥 Health check: http://localhost:${PORT}/health`);
      console.log('\n📋 Available API endpoints:');
      console.log(`   • POST /api/submit - Submit new jobs`);
      console.log(`   • GET  /api/jobs - Get job list`);
      console.log(`   • GET  /api/metrics/system - System metrics`);
      console.log(`   • GET  /api/metrics/jobs - Job metrics`);
      console.log(`   • GET  /api/metrics/dashboard - Dashboard data`);
      console.log('\n✨ Ready to accept requests!');
    });

    // Handle server errors
    httpServer.on('error', (error) => {
      if (error.code === 'EACCES') {
        console.error(`❌ Permission denied on port ${PORT}`);
        console.log('💡 Try one of these solutions:');
        console.log('   1. Run as administrator');
        console.log('   2. Use a different port (change PORT in .env file)');
        console.log('   3. Try port 3000, 8000, or 8080');
        process.exit(1);
      } else if (error.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use`);
        console.log('💡 Try these solutions:');
        console.log('   1. Change PORT in .env file to a different number');
        console.log('   2. Stop other applications using this port');
        console.log('   3. Try ports: 3000, 8000, 8080, 5001');
        process.exit(1);
      } else {
        console.error('❌ Server error:', error);
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server
startServer();

