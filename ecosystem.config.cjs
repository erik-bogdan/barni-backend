module.exports = {
    apps: [{
      name      : 'elysia',
      script    : './server',
      env_file  : '.env',
      env: {
        NODE_ENV: 'production'
      }
    }]
  }