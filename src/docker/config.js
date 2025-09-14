import os from 'os';

// Docker configuration
export const DOCKER_CONFIG = {
  // Runtime configurations for different languages
  runtimes: {
    // JavaScript/Node.js
    nodejs: {
      image: 'node:18',
      fileExtension: 'js',
      fileName: 'code.js',
      defaultBuildCmd: 'node code.js',
      dependencyInstallCmd: (deps) => `npm install ${deps.join(' ')}`,
      description: 'Node.js JavaScript runtime'
    },
    'nodejs-16': {
      image: 'node:16',
      fileExtension: 'js',
      fileName: 'code.js',
      defaultBuildCmd: 'node code.js',
      dependencyInstallCmd: (deps) => `npm install ${deps.join(' ')}`,
      description: 'Node.js 16 LTS'
    },
    'nodejs-14': {
      image: 'node:14',
      fileExtension: 'js',
      fileName: 'code.js',
      defaultBuildCmd: 'node code.js',
      dependencyInstallCmd: (deps) => `npm install ${deps.join(' ')}`,
      description: 'Node.js 14 LTS'
    },
    typescript: {
      image: 'node:18',
      fileExtension: 'ts',
      fileName: 'code.ts',
      defaultBuildCmd: 'npx ts-node code.ts',
      dependencyInstallCmd: (deps) => `npm install ts-node typescript ${deps.join(' ')}`,
      description: 'TypeScript with ts-node'
    },
    deno: {
      image: 'denoland/deno:latest',
      fileExtension: 'ts',
      fileName: 'code.ts',
      defaultBuildCmd: 'deno run code.ts',
      dependencyInstallCmd: () => '',
      description: 'Deno JavaScript/TypeScript runtime'
    },
    
    // Python
    python: {
      image: 'python:3.10',
      fileExtension: 'py',
      fileName: 'code.py',
      defaultBuildCmd: 'python code.py',
      dependencyInstallCmd: (deps) => `pip install ${deps.join(' ')}`,
      description: 'Python 3.10'
    },
    'python-3.9': {
      image: 'python:3.9',
      fileExtension: 'py',
      fileName: 'code.py',
      defaultBuildCmd: 'python code.py',
      dependencyInstallCmd: (deps) => `pip install ${deps.join(' ')}`,
      description: 'Python 3.9'
    },
    'python-3.8': {
      image: 'python:3.8',
      fileExtension: 'py',
      fileName: 'code.py',
      defaultBuildCmd: 'python code.py',
      dependencyInstallCmd: (deps) => `pip install ${deps.join(' ')}`,
      description: 'Python 3.8'
    },
    'python-django': {
      image: 'python:3.10',
      fileExtension: 'py',
      fileName: 'manage.py',
      defaultBuildCmd: 'python manage.py runserver 0.0.0.0:8000',
      dependencyInstallCmd: (deps) => `pip install django ${deps.join(' ')}`,
      description: 'Python with Django'
    },
    'python-flask': {
      image: 'python:3.10',
      fileExtension: 'py',
      fileName: 'app.py',
      defaultBuildCmd: 'flask run --host=0.0.0.0',
      dependencyInstallCmd: (deps) => `pip install flask ${deps.join(' ')}`,
      description: 'Python with Flask'
    },
    
    // Java
    java: {
      image: 'openjdk:17',
      fileExtension: 'java',
      fileName: 'Main.java',
      defaultBuildCmd: 'javac Main.java && java Main',
      dependencyInstallCmd: () => '',
      description: 'Java 17 (OpenJDK)'
    },
    'java-11': {
      image: 'openjdk:11',
      fileExtension: 'java',
      fileName: 'Main.java',
      defaultBuildCmd: 'javac Main.java && java Main',
      dependencyInstallCmd: () => '',
      description: 'Java 11 (OpenJDK)'
    },
    'java-spring': {
      image: 'openjdk:17',
      fileExtension: 'java',
      fileName: 'Application.java',
      defaultBuildCmd: './mvnw spring-boot:run',
      dependencyInstallCmd: () => '',
      description: 'Java with Spring Boot'
    },
    
    // C/C++
    cpp: {
      image: 'gcc:latest',
      fileExtension: 'cpp',
      fileName: 'code.cpp',
      defaultBuildCmd: 'g++ -o program code.cpp && ./program',
      dependencyInstallCmd: () => '',
      description: 'C++ with GCC'
    },
    c: {
      image: 'gcc:latest',
      fileExtension: 'c',
      fileName: 'code.c',
      defaultBuildCmd: 'gcc -o program code.c && ./program',
      dependencyInstallCmd: () => '',
      description: 'C with GCC'
    },
    
    // Go
    go: {
      image: 'golang:latest',
      fileExtension: 'go',
      fileName: 'main.go',
      defaultBuildCmd: 'go run main.go',
      dependencyInstallCmd: (deps) => deps.length ? `go get ${deps.join(' ')}` : '',
      description: 'Go language'
    },
    
    // Rust
    rust: {
      image: 'rust:latest',
      fileExtension: 'rs',
      fileName: 'main.rs',
      defaultBuildCmd: 'rustc main.rs && ./main',
      dependencyInstallCmd: () => '',
      description: 'Rust language'
    },
    
    // Ruby
    ruby: {
      image: 'ruby:latest',
      fileExtension: 'rb',
      fileName: 'code.rb',
      defaultBuildCmd: 'ruby code.rb',
      dependencyInstallCmd: (deps) => deps.length ? `gem install ${deps.join(' ')}` : '',
      description: 'Ruby language'
    },
    
    // PHP
    php: {
      image: 'php:8-apache',
      fileExtension: 'php',
      fileName: 'index.php',
      defaultBuildCmd: 'php -S 0.0.0.0:8000',
      dependencyInstallCmd: () => '',
      description: 'PHP 8'
    },
    
    // .NET
    dotnet: {
      image: 'mcr.microsoft.com/dotnet/sdk:7.0',
      fileExtension: 'cs',
      fileName: 'Program.cs',
      defaultBuildCmd: 'dotnet run',
      dependencyInstallCmd: (deps) => deps.length ? `dotnet add package ${deps.join(' ')}` : '',
      description: '.NET 7.0 with C#'
    },
    
    // Custom image (for user-provided Docker images)
    custom: {
      image: 'custom',  // Will be overridden by user input
      fileExtension: 'sh',
      fileName: 'script.sh',
      defaultBuildCmd: 'sh script.sh',
      dependencyInstallCmd: () => '',
      description: 'Custom Docker image'
    }
  },
  
  // Default container settings
  defaults: {
    memoryLimit: '512MB',
    timeout: 180000
  }
};

// Get runtime configuration
export function getRuntimeConfig(runtime) {
  return DOCKER_CONFIG.runtimes[runtime.toLowerCase()] || DOCKER_CONFIG.runtimes.nodejs;
}

// Platform detection
export const isWindows = os.platform() === 'win32';
