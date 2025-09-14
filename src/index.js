import express from "express";
import cors from "cors";
import { v4 as uuidv4 } from 'uuid';
import { createServer } from 'http';
import { Server } from 'socket.io';
import dotenv from 'dotenv';
import submitRouter from './routes/submit.js';
import jobsRouter from './routes/jobs.js';
import metricsRouter from './routes/metrics.js';
import { jobWorker } from './queue/index.js';
import { startMetricsCollection } from './monitoring/system_metrics.js';
import { initializeDatabase } from './db/index.js';
import { createDatabaseIfNotExists } from './db/create_database.js';
import { initPubSub } from './pubsub/redis_pubsub.js';

// Load environment variables
dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// API routes
app.use("/api/submit", submitRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/metrics", metricsRouter);

// Health check endpoint
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", message: "Server is running" });
});

const PORT = process.env.PORT || 5001; // Changed from 5000 to avoid conflicts
const httpServer = createServer(app);

// Create Socket.io server
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Socket.io setup
io.on('connection', (socket) => {
  console.log('Client connected');
  
  socket.on('subscribe', (jobId) => {
    console.log(`Client subscribed to job ${jobId}`);
    socket.join(`job-${jobId}`);
  });
  
  socket.on('unsubscribe', (jobId) => {
    console.log(`Client unsubscribed from job ${jobId}`);
    socket.leave(`job-${jobId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Make io available globally for job_processor.js
global.io = io;

// Initialize Redis pub/sub
initPubSub(io);

// First create database if it doesn't exist, then initialize schema
createDatabaseIfNotExists()
  .then(dbCreated => {
    if (!dbCreated) {
      console.error('Failed to create database. Exiting...');
      process.exit(1);
    }
    
    // Now initialize database schema
    return initializeDatabase();
  })
  .then(initialized => {
    if (!initialized) {
      console.warn('Database schema initialization had issues, but we will continue...');
    } else {
      console.log('Database initialized successfully');
    }
    
    // Start metrics collection
    startMetricsCollection();
    
    // Start server
    httpServer.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
      console.log(`API endpoints available at:`);
      console.log(`- http://localhost:${PORT}/api/submit`);
      console.log(`- http://localhost:${PORT}/api/jobs`);
      console.log(`- http://localhost:${PORT}/api/metrics/system`);
      console.log(`- http://localhost:${PORT}/api/metrics/jobs`);
      console.log(`- http://localhost:${PORT}/api/metrics/dashboard`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });

