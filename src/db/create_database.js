import pg from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Create the database if it doesn't exist
 * @returns {Promise<boolean>} True if successful, false otherwise
 */
export async function createDatabaseIfNotExists() {
  // Create a client connected to 'postgres' database instead of our target database
  const pgConfig = {
    host: process.env.POSTGRES_HOST || 'localhost',
    port: process.env.POSTGRES_PORT || 5432,
    database: 'postgres', // Connect to default postgres database
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    connectionTimeoutMillis: 5000,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };

  const targetDb = process.env.POSTGRES_DB || 'e6data';
  console.log(`Checking if database "${targetDb}" exists...`);

  const client = new pg.Client(pgConfig);
  
  try {
    await client.connect();
    
    // Check if database exists
    const checkResult = await client.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [targetDb]
    );
    
    // Create database if it doesn't exist
    if (checkResult.rows.length === 0) {
      console.log(`Database "${targetDb}" does not exist. Creating...`);
      
      // Create database - need to escape the identifier to handle special characters
      await client.query(`CREATE DATABASE "${targetDb}"`);
      
      console.log(`Database "${targetDb}" created successfully`);
      return true;
    } else {
      console.log(`Database "${targetDb}" already exists`);
      return true;
    }
  } catch (error) {
    console.error('Error creating database:', error);
    return false;
  } finally {
    await client.end();
  }
}
