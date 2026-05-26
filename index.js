require('dotenv').config();
const { startBot } = require('./bot');
const { startServer } = require('./server');

// เริ่มบอท Discord
startBot();

// เริ่ม API Server (Express)
startServer();